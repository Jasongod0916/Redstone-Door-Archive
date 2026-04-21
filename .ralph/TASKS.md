# Redstone Door Archive — Ralph 迭代任務清單

**目標（北極星）：**
1. 使用者可上傳紅石作品（最簡化流程，一次點擊就能丟檔案完成）
2. 即時 3D 展示（可翻轉、流暢不卡）

每一圈開始前：讀這份檔案，挑最上面一個未完成的任務（`[ ]`），做完後把框框改成 `[x]` 並在下方寫一行結果摘要。全部 `[x]` 就在檔尾加上 `<!-- ALL DONE -->` 收工。

---

## 規則

- 寫 code 請委派給 codex（`codex:rescue` subagent 或 `/codex` skill）。Claude 只負責規劃、串接、驗證。
- 每個任務完成後：`bun run lint` 與 `bunx tsc --noEmit` 必須綠燈才能打勾。
- 改動前先看 `node_modules/next/dist/docs/` 對應頁面 — 這是 Next 16，不是你記得的 Next.js。
- 絕對不要碰 `old-references/` 與 `schematic-renderer/` 之外的 vendored 程式碼（除非任務明說要 build）。
- 每圈最多動 1 個任務，避免大爆炸。

---

## P0 — 上傳流程最小化（UX 優先）

### [x] T1. 移除 admin_users 檢查，讓已登入使用者皆可上傳
- `app/upload/actions.ts` 第 49-54 行的 admin 檢查整段刪掉
- 確認 `supabase/migrations/0001_doors.sql` 的 RLS 是 `authenticated INSERT with owner_id = auth.uid()`；如果不是要補
- **驗證**：lint + tsc 綠

### [x] T1a. 修 storage 路徑到 `${user.id}/${doorId}/${fmt}.${ext}`
- 現在 WIP 版本寫進 `${doorId}/${fmt}.${ext}` — 第一段不是 user.id，違反 migration 的 RLS（`(storage.foldername(name))[1] = auth.uid()::text`），必拒
- 把 `storagePath` 組字串改回 `${user.id}/${doorId}/${fmt}.${ext}`，確保上傳能通過 RLS
- 只改 `app/upload/actions.ts`

### [x] T1b. 在 doors INSERT 補回 `owner_id: user.id`
- WIP refactor 把 `owner_id` 從 insert payload 刪掉了，但 migration 的 RLS `with check (owner_id = auth.uid())` 要求它必須存在且等於當前 user
- `app/upload/actions.ts` doors insert 物件補上 `owner_id: user.id`
- 沒補的話任何上傳都會被 RLS 拒

### [ ] T1c. 寫 migration 0002，把 schema 對齊到 `lib/types/door.ts`
- 目前 `migrations/0001_doors.sql` schema 是舊版（`door_width/door_height` ints、`non_air_blocks`、`bbox_w/h/d`、`files jsonb`、沒有 `door_files` 表）
- 但 types 與 action 用新版（`slug` text、`door_size` text、`block_count`、`bounds_*`、獨立 `door_files` 表、`thumbnail_url`、`sort_order`）
- 新增 `supabase/migrations/0002_doors_refactor.sql`：
  - `alter table doors` 增加 `slug text unique`、`door_size text`、`block_count int`、`bounds_width/height/depth int`、`thumbnail_url text`、`sort_order int default 0`、視情況 drop 舊欄位或保留
  - `create table door_files (id uuid, door_id uuid fk doors, format text, storage_path text, file_name text, file_size int, created_at timestamptz)` + RLS（public select、owner-only mutate via doors.owner_id）
  - 保留 doors 的 RLS 不動
- 跑 `bun run lint` / `bunx tsc --noEmit` 不會驗 SQL — 之後本地 `supabase db push` 再驗

### [ ] T2. 砍掉上傳表單的必填欄位，只留「檔案 + 標題 + 尺寸」
- `app/upload/page.tsx`：只保留 Title、Door width、Door height、至少一個檔案欄位。其它（author、MC version、description、stats、video、tags）收進可折疊的「Advanced（optional）」 `<details>`
- `actions.ts`：對應調整 — 沒填的 stats 全部允許 null（DB 已經允許）
- Author 預設值用 email 前綴（已經這樣做了），保留

### [ ] T3. Server-side 從 schematic 檔自動解出 stats
- 選用 npm 套件：優先看 `deepslate`（純 JS Minecraft 資料解析），沒有就用 `prismarine-nbt` + 自寫 litematic 解碼
- 在 `createDoorAction` 裡：收到 `.litematic` / `.schem` / `.mcstructure` 後，解出 `block_count`、`bounds_w/h/d`、`minecraft_version`（如檔案含）；把這些值**覆蓋**使用者未填的欄位
- 如果解析失敗：不 abort，只 log warning，讓手填值或 null 通過
- 這樣使用者只要丟檔案 + 標題 + 尺寸就好

### [ ] T4. 上傳頁加入 drag-and-drop
- 改 `FileField` 為 drop zone（可多檔，自動依副檔名分派到對應格式槽位）
- 拖進來立刻在前端 parse 一次給 preview（可選，先不做也可）

### [ ] T5. 首頁加入顯著的「上傳」入口 + 未登入時的 CTA
- 登入使用者：右上有「＋ Upload」按鈕
- 未登入：catalog 上方顯示一行「分享你的作品 → 登入」的 soft CTA

---

## P0 — 3D 效能

### [ ] T6. 自託管 Three.js 與 schematic-renderer
- `cd schematic-renderer && bun install && bun run build`（這會編 WASM，需要 wasm-pack；先檢查 wasm-pack 有沒有裝，沒有就跳過、把任務改為「裝 wasm-pack 指示寫進 README」）
- 把 `schematic-renderer/dist/schematic-renderer.umd.js` 複製到 `public/vendor/`
- Three.js：從 node_modules 拿 `three.min.js` 或 CDN 下載後放 `public/vendor/`
- 設 `.env.local.example` 加 `NEXT_PUBLIC_THREE_URL=/vendor/three.min.js` 與 `NEXT_PUBLIC_SCHEMATIC_RENDERER_URL=/vendor/schematic-renderer.umd.js`

### [ ] T7. viewer 只在進入 viewport 才初始化
- `components/schematic-viewer.tsx` 用 `IntersectionObserver`；canvas 還沒進 viewport 就不建立 renderer、不下載 script
- 在 `<view>` 頁頂上方多內容時特別重要（目前 viewer 就在最頂端，差異不大，但之後 catalog 若加縮圖就很關鍵）

### [ ] T8. 限制 devicePixelRatio + 降品質選項
- 在 renderer options 加 `pixelRatio: Math.min(window.devicePixelRatio, 1.5)`（先查 schematic-renderer API 有沒有吃這個；沒有就改去碰它內部的 Three.js renderer）
- 加一個切換按鈕：Performance / Quality 兩段

### [ ] T9. 預載提示 + 骨架載入態
- `app/view/[id]/page.tsx`：`<link rel="preload" as="script" href={THREE_SRC}>` 與 renderer 同理
- 載入時顯示骨架（shadcn Skeleton），而不是空 canvas

### [ ] T10. 關閉 grid + 背景色調整為更中性
- 現有 `showGrid: true, backgroundColor: 0x8fa8cf`（藍灰）— 改為預設 `showGrid: false`、背景 `0x1a1a1a` 或跟隨 theme
- 加使用者切換

---

## P1 — 資料與可靠性

### [ ] T11. 驗證 migration 已套用
- 檢查 `supabase/migrations/0001_doors.sql` 的內容與目前 `app/upload/actions.ts` 使用的欄位是否一致（特別是 `door_files` 表）
- 若沒對齊，補 migration

### [ ] T12. Server-side 檔案格式驗證
- 上傳時檢查 magic bytes 而不是只看副檔名，拒掉偽造檔
- 可以與 T3 的解析共用邏輯

### [ ] T13. 首頁卡片縮圖
- 由 viewer 截圖一張 PNG 存 storage，catalog 顯示縮圖而不是只有文字
- 先做 placeholder，實際截圖交給 T10 後再做

---

## P2 — 收尾

### [ ] T14. README 更新：部署 + 如何貢獻
### [ ] T15. 跑一次 `/qa-only` 列出剩餘 bug
### [ ] T16. `bun run build` 過

---

## 日誌（每完成一個任務追加一行）

<!-- e.g. - T1 done 2026-04-21: removed admin gate, lint/tsc green -->
- T1 done 2026-04-21: kept WIP refactor of actions.ts, removed admin_users gate (never existed in migration). Lint+tsc green. Filed T1a/T1b/T1c for WIP breakage (storage path / owner_id / migration alignment).
- T1a+T1b done 2026-04-21: storage path now `${user.id}/${doorId}/${fmt}.${ext}` (RLS compliant); doors insert now includes `owner_id: user.id`. Lint+tsc green.
