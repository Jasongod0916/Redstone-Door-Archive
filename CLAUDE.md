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
| `/` | Server Component | Catalog. Size pill filter, sort dropdown (`recent` / `blocks` / `ticks`), text search via `searchParams`. |
| `/view/[id]` | Server Component | Door detail + 3D viewer. Imports `components/schematic-viewer-lazy` (client wrapper around `next/dynamic` with `ssr: false`). |
| `/upload` | Server Component + Server Action | Auth-gated upload. Page re-checks `supabase.auth.getUser()` on entry; `app/upload/actions.ts` re-checks again inside the action (proxy doesn't cover Server Actions). Door size is two numeric inputs `[w] x [h]`. |
| `/auth/login` | Server Component | Email+password; two submit buttons route to `signInAction` / `signUpAction` via `formAction`. Reads `?next=` to round-trip after login. |
| `/auth/callback` | Route Handler | OAuth / magic-link code exchange. |

### Data & auth boundary

- **`proxy.ts`** (repo root) is the Next 16 middleware replacement. It calls `lib/supabase/middleware.ts#updateSession` to refresh session cookies on every request, then redirects only when `pathname` starts with `/upload` or `/admin` and there's no user. Everything else stays public. Static assets and `/vendor/**` are excluded via `config.matcher`.
- **`lib/supabase/server.ts`** — `createClient()` for Server Components, Server Actions, Route Handlers. Uses `next/headers` cookies (async).
- **`lib/supabase/client.ts`** — browser `createBrowserClient`. Only in Client Components.
- **`lib/supabase/middleware.ts`** — proxy helper only. Returns `{ response, user }`; `proxy.ts` decides whether to redirect.
- **Server Action auth note**: Next 16 proxy does **not** cover Server Actions. Every mutating action must re-verify `auth.getUser()` itself. See `app/upload/actions.ts`.

### Supabase schema

Migration lives at `supabase/migrations/0001_doors.sql` — apply with `supabase db push` when the project is linked.

- Table `public.doors` mirrors the old `doors.json` shape (flat columns: `door_width` / `door_height` ints replacing the `"3x3"` string, plus `non_air_blocks`, `bbox_w/h/d`, `open_ticks`, `close_ticks`, `total_ticks`, `tags text[]`, `files jsonb`). `owner_id uuid` references `auth.users`. `updated_at` trigger included.
- Storage bucket `schematics` (public). Upload paths are scoped to the uploader: RLS requires `(storage.foldername(name))[1] = auth.uid()::text`. The upload action writes to `{userId}/{doorId}/{kind}.{ext}`.
- RLS: public SELECT on doors; authenticated INSERT with `owner_id = auth.uid()`; owner-only UPDATE/DELETE.

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
