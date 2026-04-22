# Admin interface — Phase 0 (foundation) + Phase 1 (content moderation)

**Status:** approved, ready for implementation plan
**Date:** 2026-04-22
**Scope:** Phase 0 + Phase 1 only. Phase 2 (user/permission management), Phase 3 (curation), Phase 4 (ops dashboard) are each their own future spec.

## Context

The repo already has half the admin infrastructure at the database layer (inherited from a remote Supabase baseline that predates tracked migrations):

- `public.admin_users(user_id uuid)` table exists.
- `doors` / `door_files` / `storage.objects` RLS policies already grant an admin override via `auth.uid() in (select user_id from public.admin_users)`.
- `proxy.ts:4` protects the `/admin` path prefix (redirects unauthenticated users to `/auth/login`).

What is missing: any `/admin` page, server action, UI, or user-visible mechanism for granting admin. The only way to mint an admin today is a manual `insert into admin_users` via SQL.

This spec covers the minimum UI + workflow to make admin usable for content moderation. It intentionally defers user management, curation, and analytics.

## Goals

1. A single admin can sign in and moderate any user's uploaded door through a web UI, without touching SQL.
2. Admin actions are reversible where possible (soft delete + trash) and fully auditable (append-only log).
3. The first admin is bootstrapped via env var, so the project is usable out of the box without manual SQL.
4. Regular users' upload and browsing experience is unchanged (post-moderation, not pre-moderation).

## Non-goals

- No moderation queue for new uploads. Uploads remain instantly public.
- No report / flag button for regular users. (Can be added later if spam becomes a real issue.)
- No editing of schematic files, thumbnails, or video URLs via admin. Text metadata only. If a file is wrong: soft delete, ask the author to re-upload.
- No bulk operations. Single-item actions only for v1.
- No ownership reassignment (`owner_id` is not editable).
- No Phase 2/3/4 features (user promotion UI, feature/pin doors, stats).

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Moderation model | **A1 — post-moderation** | Current migration opens uploads to all signed-in users; adding a pending queue would reverse that trust direction. Simpler schema. |
| Delete behavior | **D2 — soft delete with trash** | Admin acts on other users' content; hard delete without undo is too risky. Storage cost is trivial. |
| Audit log | **AL2 — single audit table** | Phase 2 brings multiple admins where accountability becomes necessary; low cost to add now. |
| Edit scope | **E1 — text metadata only** | Covers ~95% of moderation needs; avoids reusing the upload file-parsing pipeline. |
| Bootstrap | **Auto via `ADMIN_BOOTSTRAP_EMAIL`** | Zero-touch setup. One-shot: only fires when `admin_users` is empty. |

## Architecture

### Routes & file layout

```
app/admin/
  layout.tsx              Shared shell: left-hand nav + requireAdmin() gate
  page.tsx                Dashboard landing (Phase 1: recent audit activity + total counts)
  doors/
    page.tsx              All-doors table (includes soft-deleted, filterable)
    [id]/
      edit/page.tsx       Single-door edit form (E1 scope: text metadata)
  trash/
    page.tsx              Soft-deleted doors + Restore / Delete permanently
  audit/
    page.tsx              Paginated audit log viewer

lib/admin/
  guard.ts                requireAdmin() / isAdmin(userId) / getActiveAdmin()
  audit.ts                logAdminAction({ actor, action, targetType, targetId, details })
  queries.ts              listAllDoors / listDeletedDoors / listAuditLog

app/admin/_actions/
  doors.ts                updateDoorMeta / softDeleteDoor / restoreDoor / hardDeleteDoor
```

`proxy.ts` stays as-is — the existing `/admin` prefix redirect handles unauthenticated access. The admin-membership check happens inside `requireAdmin()`, called from every Server Component under `app/admin/**` and from every Server Action in `app/admin/_actions/**`. **Next 16's proxy does not cover Server Actions**, so the Server-Action-side re-check is mandatory, not redundant.

### Auth & bootstrap flow

`requireAdmin()` logic:

1. `const { data: { user } } = await supabase.auth.getUser()`. If null → redirect to `/auth/login?next=<current>`.
2. `select user_id from admin_users where user_id = user.id limit 1`. If found → return user.
3. Bootstrap path: if `admin_users` is **empty** AND `user.email === process.env.ADMIN_BOOTSTRAP_EMAIL` (case-insensitive, trimmed) → `insert into admin_users (user_id) values (user.id)`, then return user.
4. Otherwise → `notFound()` (404). 403 would reveal that `/admin` exists.

Bootstrap is intentionally one-shot: once the table has any row, step 3 can never fire again. Rotating the env var later has no effect; subsequent admins will be added via Phase 2's UI.

### Data model

Single migration: `supabase/migrations/<timestamp>_admin_moderation.sql`.

```sql
-- Soft delete + actor tracking on doors
alter table public.doors
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists doors_deleted_at_idx
  on public.doors (deleted_at)
  where deleted_at is not null;

-- Public catalog must hide soft-deleted rows; admins see everything.
-- Implementer: list existing select policies on public.doors before running this block
-- and adjust the drop target to match the actual policy name in the remote baseline
-- (likely `doors_select_public` or `doors_select_all`).
drop policy if exists "doors_select_public" on public.doors;
create policy "doors_select_public"
  on public.doors for select
  using (
    deleted_at is null
    or auth.uid() in (select user_id from public.admin_users)
  );

-- Audit log: append-only
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_actor_idx      on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

create policy "admin_audit_log_select_admin"
  on public.admin_audit_log for select to authenticated
  using (auth.uid() in (select user_id from public.admin_users));

create policy "admin_audit_log_insert_admin"
  on public.admin_audit_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and auth.uid() in (select user_id from public.admin_users)
  );
-- No update/delete policies: audit rows are immutable.
```

**Implementer note for codex:** before writing the migration, run `supabase migration list` (or query `pg_policies`) to confirm the exact name of the current public-catalog SELECT policy on `doors`. The drop target above is a best guess based on naming conventions in `20260421152421_open_uploads_to_all_users.sql`.

### Server Actions

All live in `app/admin/_actions/doors.ts`. Each begins with `const actor = await requireAdmin()`. Each wraps the mutation and the audit log insert; audit failures are logged but do not roll back the primary mutation (observability > strict consistency for the log table).

| Action | Pre-condition | DB effect | Audit `action` | Path revalidation |
|---|---|---|---|---|
| `updateDoorMeta(doorId, fields)` | — | `update doors set ...` (only E1 fields whitelisted server-side) | `door.update` with `{ before, after }` diff | `/admin/doors`, `/admin/doors/[id]/edit`, `/view/[id]`, `/` |
| `softDeleteDoor(doorId)` | `deleted_at is null` | `update doors set deleted_at = now(), deleted_by = actor` | `door.soft_delete` | `/admin/doors`, `/admin/trash`, `/view/[id]`, `/` |
| `restoreDoor(doorId)` | `deleted_at is not null` | `update doors set deleted_at = null, deleted_by = null` | `door.restore` | `/admin/doors`, `/admin/trash`, `/view/[id]`, `/` |
| `hardDeleteDoor(doorId)` | `deleted_at is not null` **on the server**, regardless of UI state | `delete from doors` + delete all storage objects under `schematics/{owner_id}/{door_id}/*` | `door.hard_delete` | `/admin/trash`, `/` |

The `deleted_at is not null` guard on `hardDeleteDoor` is a server-side safety rail: the UI only exposes the button on `/admin/trash`, but the action itself rejects any call on a non-trashed door. This prevents a "delete → permanent delete" flow from being accidentally stitched together.

**E1 edit whitelist** (enforced on the server, do not trust the form):

```
title, author, description, tags, minecraft_version, door_size,
door_width, door_height, block_count, open_ticks, close_ticks, total_ticks,
bounds_width, bounds_height, bounds_depth, video_url
```

NOT editable by admin: `id`, `slug`, `owner_id`, `thumbnail_url`, `sort_order` (Phase 3), `created_at`, `updated_at`, `deleted_at`, `deleted_by`, the `door_files` child table.

### Audit `details` conventions

- `door.update` → `{ before: { title: "A", tags: ["x"] }, after: { title: "B", tags: ["x", "y"] } }`. Store only changed fields, not the whole row. Enforce this server-side by diffing the pre-update snapshot against the update payload.
- `door.soft_delete`, `door.restore`, `door.hard_delete` → `{}`. `target_id` already identifies the door; no extra context needed.
- `door.hard_delete_failed` (storage cleanup failure) → `{ doorId, storageError: "<message>" }`. Row is not hard-deleted in this case.

Future actions (Phase 2+) will extend `action` values but not this pattern: `admin.promote`, `admin.demote`, `door.feature`, etc.

### UI pages

**`/admin` (dashboard, Phase 1 minimum)**
- Three stat cards: total doors (live), total doors (including trash), uploads in last 7 days
- "Recent activity" panel: last 10 audit log entries
- Left-hand nav: Dashboard · Doors · Trash · Audit (active), Users · Curation (greyed out, labelled "Phase 2/3")

**`/admin/doors` (all-doors table)**
- Columns: thumbnail (64×36) · Title · Author · Size · Uploaded · Actions
- Filters: search (title + author, server-side `ilike`), size pill row (reuse `listAvailableSizes()` from `lib/doors/queries.ts`), "Include deleted" checkbox
- Row actions: `Edit` (link to `[id]/edit`), `Delete` (opens `AlertDialog`, confirms, calls `softDeleteDoor`)
- Soft-deleted rows rendered with `opacity-50` + "Deleted" badge; their only row action is `Restore`

**`/admin/doors/[id]/edit`**
- Form covering the E1 whitelist above
- Read-only display block: `door_files` list, thumbnail URL, current video URL — so admin knows what's attached without being able to change it
- Submit calls `updateDoorMeta`; success → toast + router.push(`/admin/doors`)

**`/admin/trash`**
- Columns: same as `/admin/doors` plus `Deleted at` and `Deleted by` (admin email, joined from `auth.users`)
- Row actions: `Restore` and `Delete permanently`
- `Delete permanently` opens a second `AlertDialog` with copy: "This removes the schematic, thumbnail, and video files from storage. This cannot be undone."

**`/admin/audit`**
- Columns: Time · Actor (email) · Action · Target · Details (collapsible JSON viewer)
- Filters: action dropdown, actor dropdown (from distinct admin users). Date-range filter deferred.
- Pagination: 50 rows per page, cursor-based on `created_at`

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Non-admin hits `/admin/**` | `notFound()` (404) |
| Non-admin invokes a Server Action directly | Server Action throws; return value shape `{ ok: false, error: "not_admin" }` so the client can toast |
| `hardDeleteDoor` storage cleanup fails | DB row preserved, audit row `door.hard_delete_failed` written with the storage error, action returns `{ ok: false, error: "storage_failed" }` so admin can retry |
| Audit insert fails mid-action | Log a console warning; do not roll back the primary mutation |
| Concurrent soft-delete / edit on the same row | Last-write-wins (single `updated_at`-free path); acceptable for admin-only concurrency |
| Original uploader and admin editing simultaneously | Admin's RLS permission wins at write time; uploader sees the admin's values on next fetch |
| `ADMIN_BOOTSTRAP_EMAIL` set to a non-existent account | Nothing happens; `admin_users` stays empty; `requireAdmin()` keeps returning 404. Fine — misconfiguration surfaces when the intended person tries to sign in |
| `admin_users` becomes empty after bootstrap (someone DELETEs the row) | Bootstrap would re-fire on next login from that email. Acceptable and actually desirable for recovery scenarios |

## Testing

The Next app has no test runner wired up. Verification plan:

1. **Manual smoke via `/browse` or `/qa`**: sign in as bootstrap admin → view `/admin` → edit a door → soft-delete → restore → soft-delete again → permanently delete → verify storage is empty → verify audit log shows all five actions.
2. **RLS check via Supabase MCP `execute_sql`**: with an anon JWT, `select * from admin_audit_log` must return zero rows and `insert into admin_audit_log` must be rejected. With a non-admin authenticated JWT, same thing. Only admin JWT can read/write.
3. **Public-catalog filter check**: soft-delete a door, hit `/` as an anonymous user → the door is gone. Sign in as admin → `/admin/doors` with "Include deleted" → it's back.
4. **Bootstrap one-shot**: with `admin_users` empty, sign in as `ADMIN_BOOTSTRAP_EMAIL` → verify row appears. Delete it manually → sign in as the same email → row reappears. Change env var to another email → sign in → nothing happens (table non-empty).

## Documentation to update after implementation

- **`CLAUDE.md`**: add `/admin/**` to the Routes table; document `admin_users` + bootstrap env var; note the Server-Action re-check requirement applies to every admin action.
- **`README.md`**: add a short "Admin" section — how to set `ADMIN_BOOTSTRAP_EMAIL`, how to sign in and reach `/admin`, that soft-delete / restore / audit exist.
- **`.env.example`** (if it exists, else skip): add `ADMIN_BOOTSTRAP_EMAIL=`.

## Implementation delegation

Per the user's instruction, implementation will be handed to the `codex:codex-rescue` subagent once this spec is approved and an implementation plan is written by the `writing-plans` skill. Claude Code will verify the codex output against this spec and run the testing plan.
