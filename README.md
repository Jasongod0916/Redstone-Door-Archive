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

Two migrations live under `supabase/migrations/`:

- `0001_doors.sql` — initial table, RLS, and `schematics` storage bucket.
- `0002_doors_refactor.sql` — adds `slug`, `door_size`, `block_count`,
  `bounds_*`, `thumbnail_url`, `sort_order` columns, a `door_files` table,
  and a `gen_random_uuid()` default for `doors.id`. Idempotent.

With the project linked (`bun run db:link` after editing the ref in
`package.json`):

```bash
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

## Architecture highlights

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
