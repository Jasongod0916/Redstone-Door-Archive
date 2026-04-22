# Redstone Door Archive

A Next.js 16 + React 19 app for cataloguing and previewing Minecraft redstone
doors. Public browsing; signed-in users can upload. Uploaded schematics render
in an in-browser 3D viewer (Three.js + the `schematic-renderer` WASM bundle).

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 App Router, React 19 |
| Package manager | Bun |
| Styling | Tailwind v4 (no `tailwind.config`), shadcn/ui (`radix-lyra`), Phosphor icons |
| Auth & storage | Supabase (`@supabase/ssr` cookies; RLS on `doors` + `schematics` bucket) |
| Schematic parsing | `nbtify` server-side (`.schem` Sponge format today; `.litematic` + `.mcstructure` are stubs) |
| 3D viewer | UMD builds of `three@0.159` + `schematic-renderer@1.1.23`, self-hosted under `public/vendor/` |

## Getting started

```bash
bun install
bun run setup:vendor          # downloads Three.js + schematic-renderer UMD (~30 MB, gitignored)
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
bun dev
```

Then open http://localhost:3000.

### Supabase schema

The remote project was bootstrapped through the Supabase Dashboard, so its
baseline (`initial_schema`, `admin_users_self_read`, `door_size_free_form`,
`storage_admin_policies`, `schematics_bucket_public`) isn't in this repo.
Locally-tracked migrations:

- `supabase/migrations/20260421152421_open_uploads_to_all_users.sql` —
  adds `doors.owner_id`, swaps admin-only RLS for owner-based writes
  (with `admin_users` kept as a moderator override), and points storage
  inserts at `{auth.uid()}/...` path prefixes.
- `supabase/migrations/20260422071358_admin_moderation.sql` —
  Phase 0/1 admin moderation. Adds `doors.deleted_at` / `deleted_by`
  for soft delete, the `admin_audit_log` table, the
  `admin_users_with_email` SECURITY DEFINER view, and the
  `bootstrap_admin(text)` RPC used by the admin UI to mint the first
  admin from an env var.

To push against a fresh clone:

```bash
bunx supabase link --project-ref <your ref>
bunx supabase migration repair --status applied \
  00001 00002 00003 00004 20260417033136
bun run db:push
```

### RLS essentials

- `doors`: public SELECT; authenticated INSERT must set `owner_id = auth.uid()`.
- `door_files`: public SELECT; authenticated writes gated on `doors.owner_id`.
- `storage.objects` (schematics bucket): first path segment must equal
  `auth.uid()::text`. Uploads are written to
  `{userId}/{doorId}/{format}.{ext}`.

## Scripts

| | |
|---|---|
| `bun dev` | Dev server |
| `bun run build` | Production build (Turbopack) |
| `bun start` | Serve the production build |
| `bun run lint` | ESLint (flat config) |
| `bunx tsc --noEmit` | Typecheck |
| `bun run setup:vendor` | Hydrate `public/vendor/` |
| `bun run db:push` | Apply migrations to the linked Supabase project |

## Admin

The project has an admin interface at `/admin` for content moderation. Admin
membership lives in the `public.admin_users` table; existing RLS already gives
its members an override on `doors`, `door_files`, and the `schematics` storage
bucket.

### Bootstrap the first admin

Set the email of the account that should become admin in `.env.local`:

```
ADMIN_BOOTSTRAP_EMAIL=you@example.com
```

Sign in normally. The first time that email hits `/admin` while `admin_users`
is empty, the `bootstrap_admin()` RPC inserts the row automatically. Once the
table has any entry the RPC is one-shot — all subsequent admins are added
through `/admin/users`. The env var remains as a recovery fallback if the
`admin_users` table is ever truncated, so it's safe to keep set.

Non-admins that reach `/admin/**` get a 404 (not 403) to avoid revealing the
route.

### What admins can do

- `/admin` — dashboard with seven stat cards (Live doors, Including trash,
  Last 7-day uploads, Featured, Admins, Users, Storage used), a size
  distribution bar list, a top-5 uploaders table, and the ten most recent
  audit entries.
- `/admin/users` — list every registered user with their email, join date, last
  sign-in, and upload counts. Promote any user to admin, or demote any admin
  (including yourself) — the system refuses to demote the last remaining admin.
- `/admin/doors` — list every door (with an "Include deleted" toggle). Edit
  text metadata on any row, soft-delete any row.
- `/admin/doors/[id]/edit` — edit `title`, `author`, `description`, `tags`,
  `minecraft_version`, `door_size`, ticks, bounds, `block_count`, `video_url`.
  File attachments (schematics, thumbnails) are **not** admin-editable by
  design — ask the author to re-upload.
- `/admin/trash` — restore soft-deleted doors or delete them permanently.
  Permanent delete removes the `schematics/{ownerId}/{doorId}/*` storage
  objects and cannot be undone.
- `/admin/curation` — mark doors as featured, remove them from featured, and
  reorder with up/down arrow buttons. The order here drives the order of the
  Featured section on the public homepage.
- `/admin/storage` — list orphan files (storage objects with no matching
  `door_files` row) and batch-delete up to 100 per action. Each cleanup
  writes a `storage.orphan_cleanup` audit entry including the full list
  of deleted paths.
- `/admin/audit` — append-only log of every admin action (`door.update`,
  `door.soft_delete`, `door.restore`, `door.hard_delete`,
  `door.hard_delete_failed`) with filters by action and actor and cursor
  pagination. `door.update` entries include a `{ before, after }` diff of
  only the fields that changed.

## Architecture highlights

- The public homepage shows an admin-curated **Featured** row above the main
  catalog grid, but **only** when the visitor has no filter active (no size
  pill, no search, default sort). The moment a filter is applied, Featured
  disappears and the grid shows all matching doors — featured or not. Featured
  doors are excluded from the main grid when the section is visible, so a
  featured door never appears twice on the page.
- `proxy.ts` replaces Next 12's `middleware.ts` (renamed in Next 16). It
  refreshes Supabase sessions on every request and only redirects
  `/upload` and `/admin` when there's no user.
- `components/schematic-viewer-lazy.tsx` is a `next/dynamic` (`ssr: false`)
  wrapper. Server Components import this, not the raw viewer — `ssr: false`
  on `next/dynamic` only works in Client Components.
- The viewer defers all loading until `IntersectionObserver` reports the
  canvas is in (or near) the viewport, and caps `devicePixelRatio` at 1.5.
- `lib/schematic/parse.ts` runs server-side after upload, decodes `.schem`
  NBT, counts non-air blocks via varint, and back-fills any stats the user
  left blank on the form.

## Contributing

There's no test runner wired into the Next app; the vendored
`schematic-renderer/` is a separate Vite/Vitest project with its own setup
and is ignored by this repo's lint + typecheck.

See `CLAUDE.md` + `AGENTS.md` for details an AI coding assistant needs to
stay safe around the Next 16 / React 19 sharp edges.
