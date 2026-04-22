# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Versioning warning

`package.json` pins `next@16.2.4` and `react@19.2.4` — both ahead of most training data. Two big breaking changes bite you immediately:

- **`middleware.ts` is gone.** Next 16 renamed it to `proxy.ts` and the exported function is `proxy`, not `middleware`. See `proxy.ts` at the repo root.
- **`ssr: false` on `next/dynamic` only works inside Client Components** — using it in a Server Component throws. That's why the 3D viewer is loaded via `components/schematic-viewer-lazy.tsx` (a thin client wrapper) instead of directly from the view page.

Before writing any Next.js code, consult `node_modules/next/dist/docs/` (the canonical docs for *this* install). Treat any memory of older App Router conventions as suspect until confirmed against that tree.

React 19's `react-hooks/set-state-in-effect` rule treats `setState` inside a `useEffect` body as an error, not a warning. Defer state updates with `queueMicrotask` / promise callbacks, or rethink the effect.

## Commands

Package manager is **bun** (see `bun.lock`). `scripts.dev` uses `bunx next dev`.

- `bun dev` — start the dev server
- `bun run build` — production build (`next build`)
- `bun start` — serve the production build
- `bun run lint` — ESLint (flat config via `eslint.config.mjs`)
- `bunx tsc --noEmit` — typecheck; root `tsconfig.json` excludes `schematic-renderer/` and `old-references/`

There is no test runner wired into the Next app. The vendored `schematic-renderer/` is a separate Vite/Vitest project with its own `package.json` and `bun.lock` — run its scripts from inside that directory.

## Architecture

Next.js App Router app archiving Minecraft redstone doors. Public catalog; sign-in required to upload.

### Routes

| Route | Kind | Purpose |
|---|---|---|
| `/` | Server Component | Catalog. Size pill filter, sort dropdown (`recent` / `blocks` / `ticks`), text search via `searchParams`. Shows an admin-curated "Featured" section above the main grid **only** when no filter is active (no size, empty search, default sort); featured doors are excluded from the main grid to avoid duplicates. |
| `/view/[id]` | Server Component | Door detail + 3D viewer. Imports `components/schematic-viewer-lazy` (client wrapper around `next/dynamic` with `ssr: false`). |
| `/upload` | Server Component + Server Action | Auth-gated upload. Page re-checks `supabase.auth.getUser()` on entry; `app/upload/actions.ts` re-checks again inside the action (proxy doesn't cover Server Actions). Door size is two numeric inputs `[w] x [h]`. |
| `/auth/login` | Server Component | Email+password; two submit buttons route to `signInAction` / `signUpAction` via `formAction`. Reads `?next=` to round-trip after login. |
| `/auth/callback` | Route Handler | OAuth / magic-link code exchange. |
| `/admin` | Server Component | Admin dashboard (stats + recent audit). Requires membership in `admin_users`; 404s otherwise. Gated by `lib/admin/guard.ts#requireAdmin` in the layout. |
| `/admin/users` | Server Component | User & permission management. Admin-only listing of all registered users (`admin_users_list` view) with inline promote/demote. Last admin cannot be demoted. |
| `/admin/doors` | Server Component | All-doors moderation list (includes soft-deleted when `?deleted=1`). Soft-delete from here. |
| `/admin/doors/[id]/edit` | Server Component + Server Action | Text-metadata edit only (`updateDoorMeta` in `app/admin/_actions/doors.ts`). File attachments are not admin-editable by design. |
| `/admin/trash` | Server Component | Soft-deleted doors. `restoreDoor` + `hardDeleteDoor` live in `app/admin/_actions/doors.ts`; hard delete removes storage files and cannot be undone. |
| `/admin/audit` | Server Component | Append-only admin audit log viewer with filters + cursor pagination. |
| `/admin/curation` | Server Component | Mark any door `is_featured`, unfeature, and reorder with up/down arrow buttons. Atomic swap via `swap_featured_sort_order` RPC. |

### Data & auth boundary

- **`proxy.ts`** (repo root) is the Next 16 middleware replacement. It calls `lib/supabase/middleware.ts#updateSession` to refresh session cookies on every request, then redirects only when `pathname` starts with `/upload` or `/admin` and there's no user. Everything else stays public. Static assets and `/vendor/**` are excluded via `config.matcher`.
- **`lib/supabase/server.ts`** — `createClient()` for Server Components, Server Actions, Route Handlers. Uses `next/headers` cookies (async).
- **`lib/supabase/client.ts`** — browser `createBrowserClient`. Only in Client Components.
- **`lib/supabase/middleware.ts`** — proxy helper only. Returns `{ response, user }`; `proxy.ts` decides whether to redirect.
- **Server Action auth note**: Next 16 proxy does **not** cover Server Actions. Every mutating action must re-verify `auth.getUser()` itself. See `app/upload/actions.ts`. Admin actions use `lib/admin/guard.ts#requireAdmin()` for the equivalent re-check.

### Admin role

- `public.admin_users(user_id uuid)` is the single source of truth for admin membership. Existing RLS on `doors` / `door_files` / `storage.objects` grants admins an override via `auth.uid() in (select user_id from public.admin_users)`.
- `lib/admin/guard.ts#requireAdmin()` is the gate. Every Server Component under `app/admin/**` and every Server Action in `app/admin/_actions/**` MUST call it first — 404s for non-admins (not 403; don't leak that `/admin` exists).
- **Bootstrap**: `admin_users` has no INSERT policy for authenticated users, so the first admin is minted via the `public.bootstrap_admin(text)` SECURITY DEFINER RPC. If `admin_users` is empty and the caller's `auth.users.email` matches `process.env.ADMIN_BOOTSTRAP_EMAIL` (case-insensitive, trimmed), the RPC inserts them. Once the table has any row, the RPC always returns false. Phase 2 will add a UI to manage admins.
- `public.admin_audit_log` is append-only (RLS admin-read / admin-insert, no update / delete). All admin mutations call `lib/admin/audit.ts#logAdminAction`. For `door.update`, `details` stores a `{ before, after }` diff of only changed fields.
- Soft-deleted doors (`deleted_at is not null`) are hidden from non-admins via the `doors_select_public` policy; admins see everything.
- `public.admin_users_with_email` is a SECURITY DEFINER view exposing `(user_id, email)` to admin callers only — used to render actor emails in the audit and trash pages without needing a service-role client.
- **Admin CRUD on `admin_users` goes through two SECURITY DEFINER RPCs**: `public.promote_admin(uuid)` and `public.demote_admin(uuid)`. Both reject non-admin callers (`raise exception 'not_admin'`); `demote_admin` also refuses to remove the last remaining admin (`raise exception 'last_admin'`) — this invariant is server-enforced, independent of the UI. Phase 2's `/admin/users` page is the first-class path for managing admins; `ADMIN_BOOTSTRAP_EMAIL` stays as a zero-admin recovery fallback.
- **`public.admin_users_list` view** (SECURITY DEFINER, admin-only): one row per `auth.users` entry with join stats (`live_doors`, `deleted_doors`) and an `is_admin` flag. Consumed by `/admin/users`. Returns zero rows to non-admin callers.
- **`admin_users.user_id` FK cascades** on `auth.users` delete — deleting a user automatically removes their admin membership, rather than blocking the delete.
- **Curation lives on `doors` itself**, not a separate table. `doors.is_featured boolean` flags a door for homepage promotion; `doors.sort_order int` (dormant before Phase 3) is the relative order among featured doors, ascending. Partial index `doors_featured_idx` covers `(sort_order, created_at desc) WHERE is_featured = true AND deleted_at IS NULL` for fast public lookup.
- **Admin reorder goes through `public.swap_featured_sort_order(uuid, uuid)`** — a SECURITY DEFINER RPC that locks both rows (`FOR UPDATE`) and swaps their `sort_order`. Raises `not_admin` / `not_featured` on misuse. The server actions find the immediate up/down neighbor and call swap; boundary presses (first row ↑, last row ↓) are UI-disabled AND action-level no-ops (no audit entry).

### Supabase schema

Tracked migrations in `supabase/migrations/`. The initial `doors` schema and `admin_users` baseline were applied on the remote dashboard before this repo started tracking migrations — see the note in `20260421152421_open_uploads_to_all_users.sql` for the `supabase migration repair` invocation you need to realign a fresh clone. Apply newer migrations with `supabase db push` when the project is linked, or via the Supabase MCP `apply_migration`.

- Table `public.doors` stores one row per door. Key columns: `id uuid`, `slug text`, `title text`, `author text`, `description text`, `minecraft_version text`, `door_size text` (single `"WxH"` string — NOT split into `door_width`/`door_height`), `tags text[]`, `block_count int`, `bounds_width/height/depth int`, `open_ticks/close_ticks/total_ticks int`, `video_url text`, `thumbnail_url text`, `sort_order int`, `owner_id uuid` (FK auth.users), `deleted_at timestamptz`, `deleted_by uuid` (FK auth.users), standard `created_at` / `updated_at`.
- Child table `public.door_files(id, door_id, format, storage_path, file_name, file_size, created_at)` — `door_id` FK is `ON DELETE CASCADE`, so hard-deleting a door wipes its file rows.
- Table `public.admin_audit_log(id, actor_id, action, target_type, target_id, details jsonb, created_at)` — append-only, admin-only access.
- Storage bucket `schematics` (public). Upload paths are scoped to the uploader: RLS requires `(storage.foldername(name))[1] = auth.uid()::text`, with admin override for update/delete. The upload action writes to `{userId}/{doorId}/{kind}.{ext}`.
- RLS: public SELECT on doors hides soft-deleted from non-admins (`deleted_at is null` or caller is admin); authenticated INSERT with `owner_id = auth.uid()`; owner-or-admin UPDATE/DELETE.

### 3D viewer integration

- `components/schematic-viewer.tsx` is a Client Component that loads Three.js and schematic-renderer via `next/script`. URLs come from `NEXT_PUBLIC_THREE_URL` / `NEXT_PUBLIC_SCHEMATIC_RENDERER_URL` with unpkg as the default — self-host by dropping built files in `public/vendor/` and overriding those env vars.
- `components/schematic-viewer-lazy.tsx` is the client-side `next/dynamic` wrapper with `ssr: false`. Server Components import **this** file, not the raw viewer.
- The vendored `schematic-renderer/` has no prebuilt `dist/`. To self-host: `cd schematic-renderer && bun install && bun run build`, then copy `dist/schematic-renderer.umd.js` into `public/vendor/`. The build compiles Rust/WASM — it needs `wasm-pack` and is slow.

### Legacy reference

`old-references/` holds the original static prototype (`doors.json`, `door-admin.html`, `door-catalog-viewer.html`) and its schematic samples. Use it as a spec for UX/data details being rebuilt, not as code to import.

## UI conventions

- shadcn/ui is configured in `components.json` with style `radix-lyra`, `baseColor: neutral`, CSS variables, and **Phosphor icons** (`@phosphor-icons/react`) — not Lucide. Components land in `components/ui/` via the shadcn CLI.
- Tailwind v4 with `@tailwindcss/postcss`; global styles live in `app/globals.css` (no separate `tailwind.config`).
- Path alias `@/*` maps to the repo root (`tsconfig.json`). Aliases: `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`.
- `cn()` from `@/lib/utils` is the standard class merger (`clsx` + `tailwind-merge`).
- `app/layout.tsx` loads Geist Sans, Geist Mono, and JetBrains Mono as CSS variables and sets `font-mono` as the default body font.

## Gotchas

- A security hook in this environment false-positives on regex `.e` + `xec(` calls (reads them as `child_process.exec`). Prefer `String.prototype.match` or `RegExp.prototype.test` in new code.
- `@supabase/ssr` cookie setters throw from Server Components — `lib/supabase/server.ts` swallows that with a try/catch on `cookieStore.set`. Don't remove it.
- Don't run any code between `createServerClient()` and the first `supabase.auth.getClaims()` / `getUser()` call inside the proxy helper — mixing cookie ops with auth refresh can desync sessions.
