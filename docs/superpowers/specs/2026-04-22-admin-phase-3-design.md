# Admin interface — Phase 3 (curation: featured + sort_order)

**Status:** approved, ready for implementation plan
**Date:** 2026-04-22
**Scope:** Phase 3 only. Phases 0/1 (moderation) and 2 (user management) shipped separately. Phase 4 (ops dashboard) is its own future spec.

## Context

The `doors` table has carried a `sort_order int` column since the project started, but nothing ever read or wrote it — every door has `sort_order = 0`. The homepage catalog at `/` supports three sort modes (`recent` / `blocks` / `ticks`) but has no notion of "featured" or admin-curated ordering.

Phase 3 turns `sort_order` into the storage for an admin-managed "Featured" carousel on the homepage and adds a minimal curation UI at `/admin/curation`. No collections, no hero banner, no automatic rules — just a flag plus an ordering.

## Goals

1. Admin can mark any live (non-soft-deleted) door as featured via `/admin/curation`.
2. Admin can reorder featured doors relative to each other with up/down arrow buttons.
3. The homepage renders a "Featured" section above the main grid **only** when the visitor has no filter active (no size pill, no search, default sort). Featured doors do not also appear in the main grid (no duplicates).
4. Soft-deleted featured doors disappear from the public Featured section automatically. Restoring them brings them back with their prior flag and order.
5. Every feature / unfeature / reorder action writes to `admin_audit_log`.

## Non-goals

- **No collections.** Featured is a single pool; no named groupings like "3x3 Picks" or "Speed Champions".
- **No hero banner.** No single-door banner at the top of `/`.
- **No automatic curation rules.** Nothing like "auto-feature all doors tagged `compact`".
- **No fixed upper limit on featured count.** Admin self-regulates.
- **No drag-and-drop reordering.** Up/down arrow buttons only — avoids a runtime dep.
- **No sort_order on the edit page.** Curation lives entirely in `/admin/curation`, not as a field on every door edit form.
- **No featured toggle in `/admin/doors` row actions.** Keep moderation and curation pages distinct.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **A — featured flag + sort_order** | With only 2 doors in the catalog today, collections and hero banners would look empty. |
| Homepage integration | **H1 — featured only when unfiltered** | Featured is the curated "front page"; a user actively filtering has opted out of that front page. Also avoids duplicate cards. |
| Featured limit | **Unlimited** | Admin judgment, not a hard rule. |
| Reorder UX | **R2 — up/down arrow buttons** | R1 (drag) needs a dep (`@dnd-kit`) that's unwarranted for a list of ~5–10 items. |
| `sort_order` on new feature | **`max(sort_order) + 10`** | Appends to end. Gaps leave room if we ever add "insert at position N". |
| "Has filter" definition | `size` present OR `q` non-empty OR `sort != 'recent'` | Any deliberate deviation from the default catalog view suppresses Featured. |
| Soft-delete interaction | Public query filters `deleted_at is null`; flag kept | Restore brings featured-ness back with the original order. |

## Architecture

### Routes & file layout

```
app/admin/curation/
  page.tsx                     Two-block page: featured list (reorderable) + "Add to featured" list
  _actions/
    featured.ts                featureDoor / unfeatureDoor / moveFeaturedUp / moveFeaturedDown

lib/admin/
  queries.ts                   (existing) add listFeaturedForAdmin / listAddableDoors
  audit.ts                     (existing) extend AuditAction

components/admin/
  admin-nav.tsx                (existing) flip 'Curation' from disabled to enabled
  featured-row-actions.tsx     ↑ / ↓ / Remove buttons (client)

lib/doors/
  queries.ts                   (existing) add listFeaturedForPublic; extend listDoors with excludeIds

app/page.tsx                   (existing) render Featured section when no filter; pass excludeIds to listDoors

supabase/migrations/<ts>_admin_featured.sql
```

### Data model

Single migration.

```sql
-- 1. is_featured flag.
alter table public.doors
  add column if not exists is_featured boolean not null default false;

-- 2. Partial index for fast public featured lookup (only live, only featured rows).
create index if not exists doors_featured_idx
  on public.doors (sort_order, created_at desc)
  where is_featured = true and deleted_at is null;

-- 3. Atomic swap RPC for neighbor reorder. SECURITY DEFINER because non-admin
-- UPDATE on doors requires ownership via RLS; admins have their override, but
-- locking both rows in one transaction and returning a clear error shape is
-- cleaner through an RPC than a hand-rolled two-step update from the server action.
create or replace function public.swap_featured_sort_order(door_a uuid, door_b uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  sort_a int;
  sort_b int;
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;

  select sort_order into sort_a
  from public.doors where id = door_a and is_featured = true
  for update;
  select sort_order into sort_b
  from public.doors where id = door_b and is_featured = true
  for update;

  if sort_a is null or sort_b is null then
    raise exception 'not_featured';
  end if;

  update public.doors set sort_order = sort_b where id = door_a;
  update public.doors set sort_order = sort_a where id = door_b;
  return true;
end;
$$;

revoke all on function public.swap_featured_sort_order(uuid, uuid) from public;
grant execute on function public.swap_featured_sort_order(uuid, uuid) to authenticated;
```

The `sort_order` column itself stays as the existing `int default 0`. From Phase 3 it's used for featured ordering; non-featured doors keep `sort_order = 0` and are irrelevant to the column's purpose.

### Audit actions

`lib/admin/audit.ts`'s `AuditAction` gains:

```ts
| 'door.feature'
| 'door.unfeature'
| 'door.reorder'
```

`target_type` is `'door'`; `target_id` is the affected door's UUID. For `door.reorder`, `details` is `{ direction: 'up' | 'down', swappedWith: <otherDoorId> }`.

### Server Actions (`app/admin/curation/_actions/featured.ts`)

All begin with `const actor = await requireAdmin()`. All follow the Phase 1 `ActionResult` shape.

- **`featureDoor(doorId)`**:
  1. Fetch current `max(sort_order) where is_featured = true`.
  2. `update doors set is_featured = true, sort_order = max + 10 where id = doorId`.
  3. Audit `door.feature`.
  4. Revalidate `/admin/curation` and `/`.

- **`unfeatureDoor(doorId)`**:
  1. `update doors set is_featured = false where id = doorId`. `sort_order` left as-is (will be reset on re-feature).
  2. Audit `door.unfeature`.
  3. Revalidate `/admin/curation` and `/`.

- **`moveFeaturedUp(doorId)`**:
  1. Fetch current row's `sort_order`.
  2. Fetch the featured neighbor immediately above: `select id, sort_order from doors where is_featured = true and sort_order < current order by sort_order desc limit 1`.
  3. If no neighbor, return `{ ok: true }` (no-op — already first).
  4. Call `rpc('swap_featured_sort_order', { door_a: doorId, door_b: neighborId })`.
  5. Audit `door.reorder` with `{ direction: 'up', swappedWith: neighborId }`.
  6. Revalidate.

- **`moveFeaturedDown(doorId)`**: mirror of the above (`sort_order > current order by sort_order asc limit 1`).

### UI — `/admin/curation/page.tsx`

Server component. `await requireAdmin()` at top. Two data fetches in parallel:
- `listFeaturedForAdmin()` → featured doors ordered by `sort_order asc, created_at desc`. Returns live doors only (soft-deleted featured doors aren't shown — admins can unfeature them via `/admin/trash`'s restore flow if they change their mind, but the curation page isn't the place to surface that).
- `listAddableDoors({ search })` → non-featured live doors for the "Add to featured" section, with optional email-style search on title and author.

Layout:

```
┌─────────────────────────────────────┐
│ Curation                            │
│ <N> featured · <M> available        │
├─────────────────────────────────────┤
│ Featured doors                      │
│   <card grid with ↑ ↓ Remove>       │
│   <empty state if 0>                │
├─────────────────────────────────────┤
│ Add to featured                     │
│   [search bar]                      │
│   <list with [Add] button per row>  │
└─────────────────────────────────────┘
```

**Featured card** (component: `components/admin/featured-row-actions.tsx` wraps the action buttons; the card itself is inline in `page.tsx` for layout tightness):

- Thumbnail, title, author, size badge
- `↑` disabled on first row; `↓` disabled on last row
- `Remove` opens an AlertDialog: "Remove {title} from featured? It will return to the regular catalog."

**Add list row**:
- Thumbnail (small), title, author, size badge
- `Add` button → calls `featureDoor`, toast "Added to featured", row disappears from this list and appears at the bottom of the featured section.

`components/admin/admin-nav.tsx`: replace the 'Curation' entry (currently `{ href: '#', label: 'Curation', disabled: true, phase: 'Phase 3' }`) with `{ href: '/admin/curation', label: 'Curation' }`.

### Public homepage — `app/page.tsx`

New Featured section on top of the existing layout, rendered **only** when no filter is active:

```tsx
const hasFilter = !!sizeParam || !!search || sort !== 'recent'
const featured = hasFilter ? [] : await listFeaturedForPublic()
const excludeIds = featured.map((d) => d.id)
const doors = await listDoors({ size: sizeParam, sort, search, excludeIds })
```

Render:

```tsx
{featured.length > 0 && (
  <section className="flex flex-col gap-3">
    <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Featured</h2>
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {featured.map((door) => (<DoorCard key={door.id} door={door} />))}
    </div>
  </section>
)}
{/* existing filter bar + main grid below, unchanged structure */}
```

`lib/doors/queries.ts` additions:

- `listFeaturedForPublic()` — returns `Door[]`, filters `is_featured = true` AND `deleted_at is null`, orders by `sort_order asc, created_at desc`.
- `listDoors()` — extend `DoorsListOptions` with `excludeIds?: string[]`. When provided and non-empty, add `.not('id', 'in', '(' + ids.join(',') + ')')` to the query.

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Non-admin hits `/admin/curation` | Layout's `requireAdmin()` 404s. |
| Non-admin invokes a featured Server Action directly | Action's `requireAdmin()` 404s; never reaches RPC. |
| Non-admin calls `swap_featured_sort_order` RPC directly | RPC raises `not_admin`. |
| `moveFeaturedUp` on the already-first featured row | No neighbor found; returns `{ ok: true }` with no audit entry (not a real action). |
| `moveFeaturedDown` on the already-last featured row | Same — no-op, no audit. |
| `featureDoor` on an already-featured door | UI never shows `Add` for featured rows, but if invoked, updates `is_featured = true` (no change) and resets `sort_order = max + 10`, effectively moving it to the end. Audit `door.feature` is still written. |
| `unfeatureDoor` on a non-featured door | UPDATE affects 0 rows; audit `door.unfeature` still written. |
| Featured door gets soft-deleted via `/admin/doors` | Public Featured section hides it (query filter). Admin curation page also hides it (`listFeaturedForAdmin` filters `deleted_at is null`). The `is_featured` flag remains on the row; restoring via `/admin/trash` brings it back to the Featured section in its prior `sort_order`. |
| Featured door gets hard-deleted | Row gone; no dangling featured state. |
| Two admins press `↑` on the same row at the same time | `swap_featured_sort_order`'s `FOR UPDATE` serializes the swaps. The second call may operate on already-swapped values and effectively swap back. Acceptable — races are rare and the outcome is a valid state. |
| User sets `?sort=recent` explicitly (same as default) | Still counts as unfiltered (`sort === 'recent'` is the no-filter branch). Featured section appears. |

## Testing

Same constraints as prior phases — no test runner. Verification:

1. **Typecheck + lint + build**: `bunx tsc --noEmit && bun run lint && bun run build`. Expect `/admin/curation` listed as a dynamic route.
2. **RLS smoke via Supabase MCP**:
   - With anon context: `select public.swap_featured_sort_order('00000000-...'::uuid, '00000000-...'::uuid);` → raises `not_admin`.
   - With anon context: `select count(*) from public.doors where is_featured = true;` → still works (public can read the column). This is fine — `is_featured` isn't sensitive.
3. **Happy-path smoke** (dev server):
   - `/admin/curation`: 2 addable doors, 0 featured. Add both → featured count 2, addable 0.
   - `/`: Featured section renders both cards; main grid is empty (or shows only non-featured).
   - Back on curation, press `↓` on the first featured row → rows swap. `/` reflects new order.
   - Apply `/?q=foo` (or any filter) → Featured section disappears.
   - `/admin/audit`: see `door.feature × 2` and `door.reorder × 1`.
4. **Soft-delete interaction**:
   - With one door featured, soft-delete it from `/admin/doors`.
   - `/` Featured section now shows only the other featured door (or disappears if it was the only one).
   - `/admin/curation` also omits it.
   - Restore from `/admin/trash` → Featured section shows it again with its prior `sort_order`.
5. **Edge-case smoke**:
   - Last featured row's `↓` is disabled (UI) and a direct `moveFeaturedDown` call returns `{ ok: true }` with no audit row.

## Documentation to update after implementation

- **`CLAUDE.md`**: add `/admin/curation` to the routes table; under "Admin role", document `is_featured`, `sort_order` (from Phase 3 onwards it is the featured-display order), and the `swap_featured_sort_order` RPC.
- **`README.md`**: add `/admin/curation` to "What admins can do"; add one sentence under an existing "Homepage" area (or in the architecture highlights if no homepage section exists) noting that an admin-curated "Featured" row appears on `/` when no filter is active.

## Implementation delegation

Implementation will be handed to the `codex:codex-rescue` subagent after the plan is written. Expected size: ~5 tasks (migration, audit+queries extension, server actions, UI + nav, homepage changes — potentially bundled with docs into a final task).
