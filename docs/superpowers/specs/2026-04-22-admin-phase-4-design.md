# Admin interface — Phase 4 (ops dashboard + storage maintenance)

**Status:** approved, ready for implementation plan
**Date:** 2026-04-22
**Scope:** Phase 4 only. Phases 0/1 (moderation), 2 (user management), 3 (curation) shipped separately. No further phases planned; this completes the admin roadmap.

## Context

The current `/admin` dashboard (shipped in Phase 0/1) shows three stat cards (Live doors / Including trash / Last 7 days uploads) plus a 10-item recent audit feed. It answers "what just happened" but nothing else. Phase 4 is the ops surface: richer visibility into the catalog's shape (who uploads, which sizes dominate, storage size) and a maintenance page for cleaning up orphan storage files — schematic objects in the `schematics` bucket with no matching `door_files` row.

Orphans can arise from two places: a hard-delete storage removal that succeeded at the DB level but failed at the storage level (mitigated in Phase 1 via `door.hard_delete_failed` audit but not auto-cleaned), or manual DB intervention (someone SQL-deletes a `door_files` row without removing the storage object). Both are rare but accumulate; without a cleanup UI, the only way to reclaim them is the Supabase dashboard plus manual cross-checking.

## Goals

1. `/admin` dashboard shows seven stat cards, a size distribution bar list, and a top-5 uploaders table — all read-only.
2. `/admin/storage` lists orphan storage files with a multi-select batch-delete flow, capped at 100 files per call.
3. Every cleanup action writes a `storage.orphan_cleanup` audit entry with the deleted paths.
4. All new data access uses SECURITY DEFINER helpers where admin-only visibility is required; no service-role client.
5. No new tables or columns. No runtime dependencies (no charting library — bars are hand-rendered divs).

## Non-goals

- **No reverse-orphan detection** (`door_files` rows pointing to missing storage objects). Impractical check — would require one storage lookup per row. If a file genuinely vanishes, admins notice it on `/view/[id]` or during normal moderation.
- **No monthly upload trend chart.** With a ~2-door catalog, the bars would be noise; defer until inventory is substantive.
- **No audit retention policy.** The audit table is append-only and expected to grow slowly (hundreds of rows per year at current activity).
- **No per-user storage breakdown** beyond "how many doors they uploaded". Per-user bytes requires more complex aggregation; current usage is negligible.
- **No manual cache-invalidation or reindex buttons.** `revalidatePath` inside actions already covers the cases that matter.
- **No pagination on Top uploaders.** Top 5 is the full surface; if that ever feels small, extend to 10 as a one-line change.
- **No per-row Delete button on the orphan list.** Batch-only UX — single-item deletion is a batch of one with the same dialog.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **C — stats + orphan cleanup** | Read-only stats alone duplicate what the Supabase dashboard shows; cleanup is the admin-visible differentiator. |
| Dashboard placement | **L1 — extend `/admin`** | Single entry point; admins see the whole picture on login. |
| Stats depth | **S2 — seven cards + size distribution + top 5 uploaders** | Covers "how much", "what shape", "who's active". No charts. |
| Orphan cleanup UX | **Multi-select batch (O2)** | Per-row buttons are redundant with batch; batch scales to 100 per action with a single confirm. |
| Reverse orphans | **Out of scope** | Too expensive to detect; visible to admins during normal browsing. |
| Top uploaders count | **5** | Current scale needs less; change to 10 later if wanted. |
| Batch size cap | **100 files per `cleanupOrphans` call** | Prevents `audit_log.details.paths` jsonb bloat and forces chunking of pathological cases. |
| Storage-used source | **`sum(door_files.file_size)`** | DB-authoritative, ignores orphans by definition — which is correct for the "legitimate usage" framing of the card. |

## Architecture

### Routes & file layout

```
app/admin/
  page.tsx                     (modify) 7 stat cards + size distribution + top uploaders; Recent activity panel unchanged
  storage/
    page.tsx                   New: orphan file list + batch delete
    _actions/
      orphans.ts               cleanupOrphans Server Action

lib/admin/
  queries.ts                   (existing) add getExtendedDashboardStats / getSizeDistribution / getTopUploaders / getStorageUsage / listStorageOrphans
  audit.ts                     (existing) extend AuditAction + AuditTargetType

components/admin/
  admin-nav.tsx                (existing) add 'Storage' nav item
  storage-orphan-list.tsx      Client component: selection + batch delete with AlertDialog

supabase/migrations/<ts>_admin_ops.sql
```

### Data model

No schema changes. One new SECURITY DEFINER function:

```sql
-- list_storage_orphans: return storage.objects in 'schematics' bucket not referenced by door_files
create or replace function public.list_storage_orphans()
returns table (name text, size bigint, created_at timestamptz)
language plpgsql
security definer
set search_path = public, storage, auth
as $$
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  return query
    select
      o.name::text,
      coalesce((o.metadata->>'size')::bigint, 0) as size,
      o.created_at
    from storage.objects o
    where o.bucket_id = 'schematics'
      and not exists (
        select 1 from public.door_files df where df.storage_path = o.name
      )
    order by o.created_at desc;
end;
$$;

revoke all on function public.list_storage_orphans() from public;
grant execute on function public.list_storage_orphans() to authenticated;
```

Design reasoning: `storage.objects` has its own RLS. Routing the orphan check through SECURITY DEFINER (a) sidesteps any uncertainty about what admins can or cannot select from `storage.objects` directly, (b) centralizes the "caller is admin" check, and (c) keeps the server action thin.

### Audit actions & target types

`lib/admin/audit.ts` changes:

- `AuditAction` union adds `'storage.orphan_cleanup'`.
- `AuditTargetType` union adds `'storage'`.

`logAdminAction` body is unchanged — the type widening is the only modification.

### Server Action — `cleanupOrphans`

`app/admin/storage/_actions/orphans.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true; count: number } | { ok: false; error: string }

export async function cleanupOrphans(paths: string[]): Promise<ActionResult> {
  const actor = await requireAdmin()
  if (!Array.isArray(paths) || paths.length === 0) return { ok: false, error: 'no_paths' }
  if (paths.length > 100) return { ok: false, error: 'too_many' }

  const supabase = await createClient()
  const { error } = await supabase.storage.from('schematics').remove(paths)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'storage.orphan_cleanup',
    targetType: 'storage',
    targetId: paths[0], // representative — full list lives in details
    details: { count: paths.length, paths },
  })

  revalidatePath('/admin/storage')
  revalidatePath('/admin')
  return { ok: true, count: paths.length }
}
```

Note: the `ok: true` branch here includes `count` (unlike prior phases' `{ ok: true }` shape). Client code uses this to phrase the success toast precisely ("Deleted 7 orphan files").

### Dashboard (`app/admin/page.tsx`)

Structure:

```
<header>
<stat-cards × 7>
<size-distribution>
<top-uploaders>
<recent-activity> (unchanged from Phase 0/1)
```

**Seven stat cards** (4-column grid on md, 2-column on mobile, wraps gracefully):

| # | Label | Source |
|---|---|---|
| 1 | Live doors | existing `DashboardStats.totalLive` |
| 2 | Including trash | existing `DashboardStats.totalAll` |
| 3 | Last 7 days uploads | existing `DashboardStats.uploadsLast7Days` |
| 4 | Featured | `select count(*) from doors where is_featured = true and deleted_at is null` |
| 5 | Admins | `select count(*) from admin_users` |
| 6 | Users | `select count(*) from auth.users` (via admin_users_list view — it contains one row per user to admin callers) |
| 7 | Storage used | `sum(file_size) from door_files` → `formatBytes(...)` helper |

Cards 1–3 come from `getDashboardStats`. Cards 4–7 come from a new `getExtendedDashboardStats`.

**`formatBytes` helper** in `lib/admin/format.ts` (new file):

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
```

**Size distribution** — `getSizeDistribution()` returns `Array<{ size: string; count: number }>` (identical shape to existing `listAvailableSizes`; we can reuse that function and just render it differently here). Sorted by numeric `WxH` same as today.

Rendered as a list of rows, each:

```
3x3   2   █████████████████████
4x4   0
```

Bar width: `(count / max) * 100%` on a `<div className="h-1 bg-primary/40" style={{ width: ... }}>`. If max is 0, skip rendering the bar. Hand-rolled CSS, no chart lib.

**Top uploaders** — `getTopUploaders(limit = 5)` returns:

```ts
type UploaderStats = {
  user_id: string
  email: string | null
  live: number
  deleted: number
  total: number
}
```

Joined against `admin_users_list` (Phase 2's SECURITY DEFINER view) so emails resolve. The query:

```sql
select
  u.user_id,
  u.email,
  count(d.id) filter (where d.deleted_at is null) as live,
  count(d.id) filter (where d.deleted_at is not null) as deleted,
  count(d.id) as total
from public.admin_users_list u
left join public.doors d on d.owner_id = u.user_id
group by u.user_id, u.email
having count(d.id) > 0
order by total desc, live desc, u.email asc
limit 5;
```

Rendered as a narrow table: Rank / Email / Live / Deleted / Total. Empty state: "No uploaders yet."

`admin_users_list` enforces the admin-only WHERE clause internally — non-admin callers get zero rows, which naturally makes `getTopUploaders` return empty for them too.

### Storage page (`/admin/storage`)

Server component. `await requireAdmin()` at top. Fetches `listStorageOrphans()`.

Layout:

```
Storage
Bucket schematics · N orphan files

<storage-orphan-list>
```

`components/admin/storage-orphan-list.tsx` (client):

- Props: `orphans: Array<{ name: string; size: number; created_at: string }>`
- State: `selected: Set<string>`, a pending transition for the delete call
- "Select all" checkbox in header toggles everything
- Per-row: checkbox + `name` (truncated if long) + formatted size + ISO date
- Bottom bar: `Delete N selected` button
  - Disabled when `selected.size === 0`
  - Click → AlertDialog: "Permanently delete {N} orphan files? The files will be removed from storage. This cannot be undone."
  - Confirm → `cleanupOrphans([...selected])`; success toast "Deleted N orphan files" + `router.refresh()`; error toast otherwise

Empty state (no orphans returned): render "No orphan files. Storage is clean." Skip the list entirely.

### Nav

`components/admin/admin-nav.tsx`: insert `{ href: '/admin/storage', label: 'Storage' }` immediately after the `Audit` entry. The full order becomes: Dashboard · Users · Doors · Trash · Audit · Storage · Curation.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Non-admin hits `/admin/storage` | Layout's `requireAdmin()` 404s. |
| Non-admin invokes `cleanupOrphans` directly | `requireAdmin()` 404s. |
| Non-admin calls `list_storage_orphans` RPC | RPC raises `not_admin`. |
| `cleanupOrphans([])` | `{ ok: false, error: 'no_paths' }`. |
| `cleanupOrphans` with > 100 paths | `{ ok: false, error: 'too_many' }`. |
| `storage.remove` returns an error | `{ ok: false, error: <message> }`; audit not written; UI toast. |
| File disappears between detection and delete | Remove succeeds silently for the missing path (Supabase behavior); if any other path errored, whole batch fails. Acceptable. |
| File is NOT orphan anymore (someone re-referenced it in `door_files` between detection and delete) | The delete still runs. This would break a legitimate door. Window is a couple of seconds max — acceptable risk; alternative is re-validating every path in the action, which doubles the work for a negligible gain. Documented here so admins know. |
| `auth.users` contains a user with no email (shouldn't happen in normal Supabase) | Top uploaders shows `—` as email. |
| `admin_users_list` returns 0 rows to the caller (caller is somehow not admin but got past the page guard) | Stats render zero counts; not a security issue. |
| Top uploaders excludes users with 0 doors via the `having count > 0` clause | Intentional — the list is "who contributed", not "who signed up". |

## Testing

Same constraints as prior phases — no test runner. Verification plan:

1. **Typecheck + lint + build**: `bunx tsc --noEmit && bun run lint && bun run build`. Expect `/admin/storage` in the route list.
2. **RLS smoke via Supabase MCP** (anon context, no `auth.uid()`):
   - `select * from public.list_storage_orphans();` → raises `not_admin`.
3. **Dashboard smoke**:
   - `/admin`: seven stat cards render with real numbers. Size distribution shows `3x3 · 2` (the current inventory). Top uploaders shows your own row with `total = 2`.
4. **Storage page happy path**:
   - With no orphans in the bucket: `/admin/storage` shows "No orphan files. Storage is clean."
   - Manually create an orphan: in the Supabase dashboard, delete one `door_files` row without touching the corresponding storage object. Reload `/admin/storage` → the storage path appears in the list.
   - Check it, press "Delete 1 selected", confirm → toast "Deleted 1 orphan files" (ugly plural — acceptable), list clears.
   - `/admin/audit`: a new `storage.orphan_cleanup` row is present with `details.count = 1` and `details.paths = [<that path>]`.
5. **Bulk cap**:
   - Construct a synthetic array of 101 orphan paths (can be dummy strings — the action rejects before calling storage). Calling via the UI isn't feasible with 101 real orphans; instead, trigger via devtools: `await fetch('/admin/storage', ...)` or via a temporary test route. Expect `{ ok: false, error: 'too_many' }`.
   - Alternatively, inspect the action code and confirm the cap exists. Treating this as a code-review check rather than a runtime test is acceptable.

## Documentation to update after implementation

- **`CLAUDE.md`**: add `/admin/storage` to the routes table. Under "Admin role", mention `list_storage_orphans` RPC + the orphan cleanup flow + the `formatBytes` helper.
- **`README.md`**: add `/admin/storage` to the "What admins can do" list. Expand the dashboard description to note the seven cards + size distribution + top uploaders.

## Implementation delegation

Implementation will be handed to the `codex:codex-rescue` subagent after the plan is written. Expected size: ~5 tasks (migration + RPC, audit/queries/format extension, server action, dashboard + storage UI + nav, docs).
