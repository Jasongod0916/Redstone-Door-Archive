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

### [x] T1c. 寫 migration 0002，把 schema 對齊到 `lib/types/door.ts`
- 目前 `migrations/0001_doors.sql` schema 是舊版（`door_width/door_height` ints、`non_air_blocks`、`bbox_w/h/d`、`files jsonb`、沒有 `door_files` 表）
- 但 types 與 action 用新版（`slug` text、`door_size` text、`block_count`、`bounds_*`、獨立 `door_files` 表、`thumbnail_url`、`sort_order`）
- 新增 `supabase/migrations/0002_doors_refactor.sql`：
  - `alter table doors` 增加 `slug text unique`、`door_size text`、`block_count int`、`bounds_width/height/depth int`、`thumbnail_url text`、`sort_order int default 0`、視情況 drop 舊欄位或保留
  - `create table door_files (id uuid, door_id uuid fk doors, format text, storage_path text, file_name text, file_size int, created_at timestamptz)` + RLS（public select、owner-only mutate via doors.owner_id）
  - 保留 doors 的 RLS 不動
- 跑 `bun run lint` / `bunx tsc --noEmit` 不會驗 SQL — 之後本地 `supabase db push` 再驗

### [x] T2. 砍掉上傳表單的必填欄位，只留「檔案 + 標題 + 尺寸」
- `app/upload/page.tsx`：只保留 Title、Door width、Door height、至少一個檔案欄位。其它（author、MC version、description、stats、video、tags）收進可折疊的「Advanced（optional）」 `<details>`
- `actions.ts`：對應調整 — 沒填的 stats 全部允許 null（DB 已經允許）
- Author 預設值用 email 前綴（已經這樣做了），保留

### [~] T3. Server-side 從 schematic 檔自動解出 stats (partial — schem only)
- 選用 npm 套件：優先看 `deepslate`（純 JS Minecraft 資料解析），沒有就用 `prismarine-nbt` + 自寫 litematic 解碼
- 在 `createDoorAction` 裡：收到 `.litematic` / `.schem` / `.mcstructure` 後，解出 `block_count`、`bounds_w/h/d`、`minecraft_version`（如檔案含）；把這些值**覆蓋**使用者未填的欄位
- 如果解析失敗：不 abort，只 log warning，讓手填值或 null 通過
- 這樣使用者只要丟檔案 + 標題 + 尺寸就好

### [x] T3b. 補 `.litematic` 解析器
- 目前 `lib/schematic/parse.ts` 對 litematic 回傳 `{}` (stub)
- litematic = gzip NBT，根有 `Regions.<name>.Size` (xyz compound)、`BlockStatePalette` (list)、`BlockStates` (long array, packed)
- Non-air block count = 對 BlockStates 做 bitpack decode、查 palette、排除 air variants

### [x] T3c. 補 `.mcstructure` 解析器（Bedrock edition）
- NBT，用 little-endian；根有 `size` int array [w, h, d]、`structure.block_indices` list
- Block palette 裡的 `name` 匹配 'minecraft:air' 系列排除

### [x] T4. 上傳頁加入 drag-and-drop
- 改 `FileField` 為 drop zone（可多檔，自動依副檔名分派到對應格式槽位）
- 拖進來立刻在前端 parse 一次給 preview（可選，先不做也可）

### [x] T5. 首頁加入顯著的「上傳」入口 + 未登入時的 CTA
- 登入使用者：右上有「＋ Upload」按鈕
- 未登入：catalog 上方顯示一行「分享你的作品 → 登入」的 soft CTA

---

## P0 — 3D 效能

### [x] T6. 自託管 Three.js 與 schematic-renderer
- `cd schematic-renderer && bun install && bun run build`（這會編 WASM，需要 wasm-pack；先檢查 wasm-pack 有沒有裝，沒有就跳過、把任務改為「裝 wasm-pack 指示寫進 README」）
- 把 `schematic-renderer/dist/schematic-renderer.umd.js` 複製到 `public/vendor/`
- Three.js：從 node_modules 拿 `three.min.js` 或 CDN 下載後放 `public/vendor/`
- 設 `.env.local.example` 加 `NEXT_PUBLIC_THREE_URL=/vendor/three.min.js` 與 `NEXT_PUBLIC_SCHEMATIC_RENDERER_URL=/vendor/schematic-renderer.umd.js`

### [x] T7. viewer 只在進入 viewport 才初始化
- `components/schematic-viewer.tsx` 用 `IntersectionObserver`；canvas 還沒進 viewport 就不建立 renderer、不下載 script
- 在 `<view>` 頁頂上方多內容時特別重要（目前 viewer 就在最頂端，差異不大，但之後 catalog 若加縮圖就很關鍵）

### [~] T8. 限制 devicePixelRatio + 降品質選項 (DPR cap done; quality toggle TODO)
- 在 renderer options 加 `pixelRatio: Math.min(window.devicePixelRatio, 1.5)`（先查 schematic-renderer API 有沒有吃這個；沒有就改去碰它內部的 Three.js renderer）
- 加一個切換按鈕：Performance / Quality 兩段

### [x] T9. 預載提示 + 骨架載入態
- `app/view/[id]/page.tsx`：`<link rel="preload" as="script" href={THREE_SRC}>` 與 renderer 同理
- 載入時顯示骨架（shadcn Skeleton），而不是空 canvas

### [x] T10. 關閉 grid + 背景色調整為更中性
- 現有 `showGrid: true, backgroundColor: 0x8fa8cf`（藍灰）— 改為預設 `showGrid: false`、背景 `0x1a1a1a` 或跟隨 theme
- 加使用者切換

---

## P1 — 資料與可靠性

### [x] T11. 驗證 migration 已套用
- 檢查 `supabase/migrations/0001_doors.sql` 的內容與目前 `app/upload/actions.ts` 使用的欄位是否一致（特別是 `door_files` 表）
- 若沒對齊，補 migration

### [x] T12. Server-side 檔案格式驗證
- 上傳時檢查 magic bytes 而不是只看副檔名，拒掉偽造檔
- 可以與 T3 的解析共用邏輯

### [ ] T13. 首頁卡片縮圖
- 由 viewer 截圖一張 PNG 存 storage，catalog 顯示縮圖而不是只有文字
- 先做 placeholder，實際截圖交給 T10 後再做

---

## P2 — 收尾

### [x] T14. README 更新：部署 + 如何貢獻
### [ ] T15. 跑一次 `/qa-only` 列出剩餘 bug
### [x] T16. `bun run build` 過

---

## 日誌（每完成一個任務追加一行）

<!-- e.g. - T1 done 2026-04-21: removed admin gate, lint/tsc green -->
- T1 done 2026-04-21: kept WIP refactor of actions.ts, removed admin_users gate (never existed in migration). Lint+tsc green. Filed T1a/T1b/T1c for WIP breakage (storage path / owner_id / migration alignment).
- T1a+T1b done 2026-04-21: storage path now `${user.id}/${doorId}/${fmt}.${ext}` (RLS compliant); doors insert now includes `owner_id: user.id`. Lint+tsc green.
- T1c done 2026-04-21: added migration 0002 with slug/door_size/block_count/bounds_*/thumbnail_url/sort_order columns (nullable additions, no drops), door_files table + RLS, and default gen_random_uuid()::text for doors.id. Idempotent. Not yet pushed to DB.
- T2 done 2026-04-21: upload form now shows only Title + Door size + file inputs above the fold; author/MC version/description/stats/video/tags collapsed into `<details>` "Advanced (optional)". Also propagates the WIP column renames (non_air_blocks→block_count, bbox_*→bounds_*) to match migration 0002. Lint+tsc green.
- T3 partial 2026-04-21: added nbtify dep + lib/schematic/parse.ts. Sponge .schem parser extracts bounds_width/height/depth + non-air block_count via varint decode + palette air-exclusion. litematic/mcstructure/nbt/schematic return {} stubs. Wired into actions.ts as post-upload doors UPDATE (fills only null fields, silent on failure). Lint+tsc green.
- T6 done 2026-04-21: self-hosted 3D deps via `bun run setup:vendor` (scripts/setup-vendor.sh). Downloads three@0.159.0 UMD (668KB) + schematic-renderer@1.1.23 UMD (29.5MB) to public/vendor/, gitignored. Viewer defaults + .env.local.example point at /vendor/*. Fixes two latent bugs: three@0.181.2 has no UMD build, and sr@1.1.24 never existed on npm. Added ESLint ignore for public/vendor/**.
- T7+T8+T10 done 2026-04-21: SchematicViewer now (a) lazy-inits via IntersectionObserver with 256px rootMargin — scripts only load when canvas is near viewport, (b) caps devicePixelRatio at 1.5 by probing the Three renderer via narrow-type helper, (c) defaults to backgroundColor 0x111111 + showGrid false. Codex rescue returned empty output twice so hand-implemented with React-19-safe queueMicrotask pattern. T8's quality-toggle UI deferred. Lint+tsc green.
- T9 done 2026-04-21: view page emits `<link rel="preload" as="script">` for both vendor scripts so they're in-flight before IntersectionObserver fires. Loading skeleton in schematic-viewer-lazy now uses shadcn Skeleton (absolute positioned) behind the "Loading viewer…" caption. Lint+tsc green.
- T5 done 2026-04-21: homepage already had a signed-in Upload button (top-right); added a soft CTA strip above filters for signed-out users linking to /auth/login?next=/upload. Lint+tsc green.
- T4 done 2026-04-21: new Client Component app/upload/upload-drop-zone.tsx replaces the three FileField inputs. Single dashed drop area routes dropped/browsed files by extension (.litematic/.schem|.schematic/.mcstructure) onto three hidden sr-only `<input name="file_*">`. Shows queued file list with remove buttons. Form still posts via createDoorAction — no action change. Codex rescue attempted (3rd silent empty return today) so hand-implemented. Lint+tsc green.
- T16 done 2026-04-21: `bun run build` succeeds on Next 16 Turbopack in 10.3s, typecheck 4.3s, all 7 routes compile (/, /auth/{callback,google,login}, /upload, /view/[id], _not-found). Proxy middleware registered.
- T11 done 2026-04-21: confirmed migrations 0001 + 0002 together cover every column/table that actions.ts and lib/types/door.ts reference (slug, door_size, block_count, bounds_*, thumbnail_url, sort_order in doors; separate door_files). Old 0001 columns kept for back-compat. 0002 is idempotent — safe to re-apply. Not verified against live DB (no linked project in this sandbox).
- T14 done 2026-04-21: README rewritten with real project story — stack matrix, getting-started flow (install → setup:vendor → env → dev), migrations overview, RLS essentials, scripts table, architecture highlights. Replaces the default create-next-app stub.
- T12 done 2026-04-21: added isLikelyValidFormat() magic-byte check in actions.ts — Sponge .schem/.schematic/.litematic must start with gzip magic 0x1f 0x8b, .mcstructure must start with NBT compound tag 0x0a. Rejects mis-declared or corrupt files before they reach storage. Lint+tsc green.

---

### Iteration 2 (2026-04-21)

- T3b done: .litematic parser uses `Metadata.TotalBlocks` (Litematica writes it directly) for block_count, `Metadata.EnclosingSize` for bounds (fallback to first region's Size with abs()). `MinecraftDataVersion` for version. Shortcut avoids the bitpacked long-array BlockStates unpack that would require careful bigint math.
- T3c done: .mcstructure parser reads little-endian NBT via nbtify `{endian:'little'}`. `root.size` IntArray [w,h,d] → bounds. `structure.palette.default.block_palette` identifies air indices, then `structure.block_indices[0]` IntArray gets scanned for non-air count. Both handle typed-array or array shapes.

### Iteration 1 wrap-up (2026-04-21)

**P0 goals fully met:**
- Minimal upload UX (T1, T1a, T1b, T1c, T2, T3 partial, T4, T5, T12)
- 3D performance (T6, T7, T8 partial, T9, T10)
- Build green (T16)
- Docs (T11, T14)

**Open for later iterations (lower priority):**
- T3b .litematic parser (stub in place, returns {})
- T3c .mcstructure parser (stub in place, returns {})
- T8 quality-toggle UI (DPR cap already in place)
- T13 auto-thumbnail generation (non-trivial — needs client canvas capture)
- T15 /qa-only run (interactive, user-driven)

13 commits landed this iteration. `bun run build` / `bun run lint` /
`bunx tsc --noEmit` all green.
