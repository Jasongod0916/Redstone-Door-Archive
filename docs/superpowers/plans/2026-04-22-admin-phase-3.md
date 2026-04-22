# Admin Phase 3 (curation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/admin/curation` plus a homepage Featured section per `docs/superpowers/specs/2026-04-22-admin-phase-3-design.md`. Activates the long-dormant `doors.sort_order` column as the storage for admin-curated display order.

**Architecture:** Extends Phase 0/1/2. One migration adds the `is_featured` flag + partial index + atomic-swap SECURITY DEFINER RPC. A new `/admin/curation` server-component page lets admins add/remove/reorder featured doors via arrow buttons. The public homepage gains a Featured section that renders only when the visitor has no filter active.

**Tech Stack:** Same as prior phases — Next 16.2.4, React 19.2.4, shadcn/ui (`radix-lyra`, Phosphor icons), `@supabase/ssr`, Tailwind v4, Bun. No drag-and-drop dependency — arrow buttons + RPC-level atomic swap.

**Spec reference:** `docs/superpowers/specs/2026-04-22-admin-phase-3-design.md` — tasks cite its section headings when relevant.

---

## File structure overview

```
supabase/migrations/<ts>_admin_featured.sql    ← Task 1

lib/admin/
  audit.ts                  ← Task 2 (extend AuditAction union)
  queries.ts                ← Task 2 (add listFeaturedForAdmin / listAddableDoors)

app/admin/curation/
  page.tsx                  ← Task 4
  _actions/
    featured.ts             ← Task 3

components/admin/
  admin-nav.tsx             ← Task 4 (flip 'Curation' to enabled)
  featured-row-actions.tsx  ← Task 4

lib/doors/
  queries.ts                ← Task 5 (add listFeaturedForPublic, extend listDoors with excludeIds)

app/page.tsx                ← Task 5 (render Featured section when no filter)

CLAUDE.md                   ← Task 6
README.md                   ← Task 6
```

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/<timestamp>_admin_featured.sql`

**Context:** Implements spec §"Data model".

- [ ] **Step 1: Verify current state via Supabase MCP**

Confirm before writing the migration:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'doors' and column_name = 'is_featured';
-- Expected: 0 rows (column does not exist yet)

select polname from pg_policies where schemaname = 'public' and tablename = 'doors' and cmd = 'UPDATE';
-- Note the UPDATE policy name(s). The existing 'doors_update_owner_or_admin'
-- policy already lets admins update any row, so featureDoor / unfeatureDoor
-- work through it — no new RLS rule is needed for the toggles themselves.
-- The swap RPC is SECURITY DEFINER, so it bypasses RLS regardless.
```

- [ ] **Step 2: Create the migration file**

Generate a timestamp with `date -u +%Y%m%d%H%M%S`. Filename: `supabase/migrations/<timestamp>_admin_featured.sql`.

```sql
-- Admin Phase 3: curation (featured flag + atomic swap RPC).
-- See docs/superpowers/specs/2026-04-22-admin-phase-3-design.md

-- 1. is_featured flag on doors.
alter table public.doors
  add column if not exists is_featured boolean not null default false;

-- 2. Partial index: only live, featured rows participate. Cheap lookup for
-- both the public Featured section and the admin curation page.
create index if not exists doors_featured_idx
  on public.doors (sort_order, created_at desc)
  where is_featured = true and deleted_at is null;

-- 3. Atomic-swap RPC for neighbor reorder. FOR UPDATE serializes concurrent
-- admin presses on the same row. Raises 'not_admin' / 'not_featured' on
-- misuse; server action translates those into toast-friendly errors.
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

- [ ] **Step 3: Apply the migration**

Via Supabase MCP:

```
mcp__supabase__apply_migration
  project_id: mhygitjlhnyyckdnilgb
  name: admin_featured
  query: <file contents>
```

Or if linked locally: `supabase db push`.

- [ ] **Step 4: Verify via MCP**

```sql
-- Column
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_schema='public' and table_name='doors' and column_name='is_featured';
-- Expected: boolean, default 'false', not null

-- Partial index
select indexdef from pg_indexes where schemaname='public' and indexname='doors_featured_idx';
-- Expected: includes 'WHERE ((is_featured = true) AND (deleted_at IS NULL))'

-- RPC
select proname, prosecdef from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and proname='swap_featured_sort_order';
-- Expected: prosecdef = true

-- RPC rejects non-admin caller (MCP runs without auth.uid())
select public.swap_featured_sort_order(
  '00000000-0000-0000-0000-000000000000'::uuid,
  '00000000-0000-0000-0000-000000000000'::uuid
);
-- Expected: ERROR with 'not_admin'
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "migrate: admin featured — is_featured flag, partial index, swap RPC"
```

---

## Task 2: Extend audit actions + admin queries

**Files:**
- Modify: `lib/admin/audit.ts`
- Modify: `lib/admin/queries.ts`

**Context:** Spec §"Audit actions" + §"UI — `/admin/curation/page.tsx`" data fetches.

- [ ] **Step 1: Extend `AuditAction` in `lib/admin/audit.ts`**

Open `lib/admin/audit.ts`. Replace the existing `AuditAction` union with:

```ts
export type AuditAction =
  | 'door.update'
  | 'door.soft_delete'
  | 'door.restore'
  | 'door.hard_delete'
  | 'door.hard_delete_failed'
  | 'admin.promote'
  | 'admin.demote'
  | 'door.feature'
  | 'door.unfeature'
  | 'door.reorder'
```

No other change in this file.

- [ ] **Step 2: Add `listFeaturedForAdmin` + `listAddableDoors` to `lib/admin/queries.ts`**

Append to the end of `lib/admin/queries.ts`:

```ts
export type FeaturedDoorRow = AdminDoorRow & {
  is_featured: boolean
}

export async function listFeaturedForAdmin(): Promise<FeaturedDoorRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*')
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FeaturedDoorRow[]
}

export type ListAddableDoorsOptions = {
  search?: string
  limit?: number
}

export async function listAddableDoors(
  opts: ListAddableDoorsOptions = {},
): Promise<FeaturedDoorRow[]> {
  const supabase = await createClient()
  let q = supabase
    .from('doors')
    .select('*')
    .eq('is_featured', false)
    .is('deleted_at', null)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term}`)
  }

  q = q.order('created_at', { ascending: false }).limit(opts.limit ?? 20)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as FeaturedDoorRow[]
}
```

- [ ] **Step 3: Ensure the `AdminDoorRow` type carries `is_featured`**

`AdminDoorRow` was defined earlier in `lib/admin/queries.ts` as `Door & { deleted_at, deleted_by }`. The base `Door` type in `lib/types/door.ts` does NOT yet include `is_featured` (added in Task 1 migration). Fix by extending the base type:

Open `lib/types/door.ts`. Add `is_featured: boolean` between `deleted_by` and `created_at` (or wherever keeps the file sorted):

```ts
export type Door = {
  id: string
  slug: string
  title: string
  author: string
  description: string | null
  minecraft_version: string | null
  door_size: string
  tags: string[]
  block_count: number | null
  bounds_width: number | null
  bounds_height: number | null
  bounds_depth: number | null
  open_ticks: number | null
  close_ticks: number | null
  total_ticks: number | null
  video_url: string | null
  thumbnail_url: string | null
  sort_order: number
  is_featured: boolean
  created_at: string
  updated_at: string
}
```

(Only the `is_featured` line is new. Keep the rest of the file — including `DoorWithFiles` and `DoorFile` — unchanged.)

With that, `FeaturedDoorRow = AdminDoorRow & { is_featured: boolean }` is redundant (`AdminDoorRow` now includes `is_featured` via the base). Simplify by aliasing:

```ts
export type FeaturedDoorRow = AdminDoorRow
```

Adjust the new code in Step 2 accordingly — the simplification is the only code change; the `listFeaturedForAdmin` and `listAddableDoors` bodies stay identical.

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/audit.ts lib/admin/queries.ts lib/types/door.ts
git commit -m "feat(admin): extend audit actions + curation queries + Door.is_featured"
```

---

## Task 3: Server actions (feature / unfeature / reorder)

**Files:**
- Create: `app/admin/curation/_actions/featured.ts`

**Context:** Spec §"Server Actions".

- [ ] **Step 1: Write the actions file**

Create `app/admin/curation/_actions/featured.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function featureDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { data: maxRow, error: maxErr } = await supabase
    .from('doors')
    .select('sort_order')
    .eq('is_featured', true)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (maxErr) return { ok: false, error: maxErr.message }
  const nextSort = ((maxRow?.sort_order as number | null | undefined) ?? 0) + 10

  const { error: updateErr } = await supabase
    .from('doors')
    .update({ is_featured: true, sort_order: nextSort })
    .eq('id', doorId)
  if (updateErr) return { ok: false, error: updateErr.message }

  await logAdminAction({
    actor, action: 'door.feature', targetType: 'door', targetId: doorId,
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

export async function unfeatureDoor(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase
    .from('doors')
    .update({ is_featured: false })
    .eq('id', doorId)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.unfeature', targetType: 'door', targetId: doorId,
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

async function findNeighbor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  doorId: string,
  direction: 'up' | 'down',
): Promise<{ id: string; sort_order: number } | null> {
  const { data: self, error: selfErr } = await supabase
    .from('doors')
    .select('sort_order')
    .eq('id', doorId)
    .eq('is_featured', true)
    .maybeSingle()
  if (selfErr || !self) return null

  const selfOrder = self.sort_order as number

  const query = supabase
    .from('doors')
    .select('id, sort_order')
    .eq('is_featured', true)
    .is('deleted_at', null)

  const { data: neighbor, error: neighborErr } = await (direction === 'up'
    ? query.lt('sort_order', selfOrder).order('sort_order', { ascending: false })
    : query.gt('sort_order', selfOrder).order('sort_order', { ascending: true })
  ).limit(1).maybeSingle()

  if (neighborErr || !neighbor) return null
  return { id: neighbor.id as string, sort_order: neighbor.sort_order as number }
}

export async function moveFeaturedUp(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const neighbor = await findNeighbor(supabase, doorId, 'up')
  if (!neighbor) return { ok: true } // already first — no-op, no audit

  const { error } = await supabase.rpc('swap_featured_sort_order', {
    door_a: doorId,
    door_b: neighbor.id,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.reorder', targetType: 'door', targetId: doorId,
    details: { direction: 'up', swappedWith: neighbor.id },
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}

export async function moveFeaturedDown(doorId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const neighbor = await findNeighbor(supabase, doorId, 'down')
  if (!neighbor) return { ok: true } // already last — no-op, no audit

  const { error } = await supabase.rpc('swap_featured_sort_order', {
    door_a: doorId,
    door_b: neighbor.id,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor, action: 'door.reorder', targetType: 'door', targetId: doorId,
    details: { direction: 'down', swappedWith: neighbor.id },
  })
  revalidatePath('/admin/curation')
  revalidatePath('/')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass. Confirm the file exports only async functions and a type — `'use server'` rejects non-async value exports.

- [ ] **Step 3: Commit**

```bash
git add app/admin/curation/_actions/featured.ts
git commit -m "feat(admin): feature/unfeature + up/down reorder server actions"
```

---

## Task 4: Curation page + row actions + nav

**Files:**
- Create: `components/admin/featured-row-actions.tsx`
- Create: `app/admin/curation/page.tsx`
- Modify: `components/admin/admin-nav.tsx` (flip 'Curation' to enabled)

**Context:** Spec §"UI — `/admin/curation/page.tsx`".

- [ ] **Step 1: Write `components/admin/featured-row-actions.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  unfeatureDoor,
  moveFeaturedUp,
  moveFeaturedDown,
} from '@/app/admin/curation/_actions/featured'

export type FeaturedRowActionsProps = {
  doorId: string
  title: string
  isFirst: boolean
  isLast: boolean
}

export function FeaturedRowActions(props: FeaturedRowActionsProps) {
  const [pending, start] = useTransition()
  const [removeOpen, setRemoveOpen] = useState(false)

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const res = (await action()) as { ok: true } | { ok: false; error: string }
      if (res.ok) return
      toast.error(`Failed: ${res.error}`)
    })
  }

  return (
    <div className="flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending || props.isFirst}
        onClick={() => run(() => moveFeaturedUp(props.doorId))}
        title={props.isFirst ? 'Already first' : 'Move up'}
        aria-label="Move up"
      >
        ↑
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={pending || props.isLast}
        onClick={() => run(() => moveFeaturedDown(props.doorId))}
        title={props.isLast ? 'Already last' : 'Move down'}
        aria-label="Move down"
      >
        ↓
      </Button>
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="destructive" disabled={pending}>
            Remove
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {props.title} from featured?</AlertDialogTitle>
            <AlertDialogDescription>
              It will return to the regular catalog.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await unfeatureDoor(props.doorId)
                  if (res.ok) {
                    toast.success(`Removed ${props.title} from featured`)
                    setRemoveOpen(false)
                  } else {
                    toast.error(`Remove failed: ${res.error}`)
                  }
                })
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
```

- [ ] **Step 2: Write `app/admin/curation/page.tsx`**

```tsx
import Link from 'next/link'
import { requireAdmin } from '@/lib/admin/guard'
import { listFeaturedForAdmin, listAddableDoors } from '@/lib/admin/queries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FeaturedRowActions } from '@/components/admin/featured-row-actions'
import { featureDoor } from '@/app/admin/curation/_actions/featured'
import { AddButton } from '@/components/admin/featured-row-actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AdminCurationPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q : ''

  const [featured, addable] = await Promise.all([
    listFeaturedForAdmin(),
    listAddableDoors({ search: search || undefined, limit: 30 }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Curation</h1>
        <p className="text-muted-foreground text-sm">
          {featured.length} featured · {addable.length} available{search ? ' (filtered)' : ''}
        </p>
      </header>

      {/* Featured section */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs tracking-widest uppercase text-muted-foreground">Featured doors</h2>
        {featured.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No featured doors yet — add some below.
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            {featured.map((door, i) => (
              <li key={door.id} className="flex items-center gap-4 p-3">
                {door.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={door.thumbnail_url} alt="" className="w-20 h-12 object-cover border border-border" />
                ) : <div className="w-20 h-12 bg-muted" />}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <Link href={`/view/${door.id}`} className="truncate hover:text-primary">{door.title}</Link>
                  <span className="text-muted-foreground text-xs truncate">by {door.author}</span>
                </div>
                <Badge variant="secondary" className="border-primary/30 bg-primary/10 text-primary text-xs">{door.door_size}</Badge>
                <FeaturedRowActions
                  doorId={door.id}
                  title={door.title}
                  isFirst={i === 0}
                  isLast={i === featured.length - 1}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add to featured section */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs tracking-widest uppercase text-muted-foreground">Add to featured</h2>
        <form className="flex items-end gap-3 border border-border bg-card p-4">
          <div className="flex flex-col gap-1.5 min-w-[220px]">
            <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="q">Search</label>
            <Input id="q" name="q" defaultValue={search} placeholder="Title, author…" />
          </div>
          <Button type="submit" variant="outline" size="sm">Apply</Button>
        </form>
        {addable.length === 0 ? (
          <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            {search ? 'No non-featured doors match the search.' : 'Every live door is already featured.'}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            {addable.map((door) => (
              <li key={door.id} className="flex items-center gap-4 p-3">
                {door.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={door.thumbnail_url} alt="" className="w-20 h-12 object-cover border border-border" />
                ) : <div className="w-20 h-12 bg-muted" />}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <Link href={`/view/${door.id}`} className="truncate hover:text-primary">{door.title}</Link>
                  <span className="text-muted-foreground text-xs truncate">by {door.author}</span>
                </div>
                <Badge variant="outline" className="text-xs">{door.door_size}</Badge>
                <AddButton doorId={door.id} title={door.title} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Add the `AddButton` export to `components/admin/featured-row-actions.tsx`**

Append at the bottom of `components/admin/featured-row-actions.tsx`:

```tsx
'use client'

// (existing imports above are reused — React's useTransition, Button, toast, featureDoor)
import { featureDoor as featureDoorAction } from '@/app/admin/curation/_actions/featured'

export function AddButton({ doorId, title }: { doorId: string; title: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        start(async () => {
          const res = await featureDoorAction(doorId)
          if (res.ok) toast.success(`Added ${title} to featured`)
          else toast.error(`Add failed: ${res.error}`)
        })
      }}
    >
      Add
    </Button>
  )
}
```

**Note:** the second `'use client'` directive is a no-op since the file already starts with one — delete that redundant line when pasting. The import line `import { featureDoor as featureDoorAction } ...` should be consolidated with the existing import block at the top of the file (combined form: `import { featureDoor, unfeatureDoor, moveFeaturedUp, moveFeaturedDown } from '@/app/admin/curation/_actions/featured'`), and `AddButton` can just call `featureDoor(doorId)` directly without the alias. Resulting import block at the top of the file:

```tsx
import {
  featureDoor,
  unfeatureDoor,
  moveFeaturedUp,
  moveFeaturedDown,
} from '@/app/admin/curation/_actions/featured'
```

And `AddButton`'s body uses `featureDoor(doorId)` directly.

- [ ] **Step 4: Flip 'Curation' to enabled in `components/admin/admin-nav.tsx`**

Find the `ITEMS` array in `components/admin/admin-nav.tsx`. Replace the 'Curation' entry (currently `{ href: '#', label: 'Curation', disabled: true, phase: 'Phase 3' }`) with:

```ts
  { href: '/admin/curation', label: 'Curation' },
```

Leave the rest of the array unchanged.

- [ ] **Step 5: Typecheck + build (the page imports cross-file client components; catch both)**

```bash
bunx tsc --noEmit && bun run build
```

Expected: both pass. `/admin/curation` should appear as a dynamic route in the build output.

- [ ] **Step 6: Manual verify locally**

```bash
bun dev
```

- Navigate to `/admin` → "Curation" nav link is enabled.
- Click into `/admin/curation` → "Featured doors" shows empty state; "Add to featured" lists every live non-featured door.
- Click `Add` on any door → toast; it moves to the featured list; the addable list shrinks.
- Click `Add` on a second door → featured list now has 2; the one added first is at the top (lower `sort_order`).
- Click `↓` on the first featured row → rows swap; first becomes second.
- Click `↑` on the now-second row → swaps back.
- `↑` on the first row and `↓` on the last row should be disabled (grayed).
- Click `Remove` on a featured row → AlertDialog confirm → row returns to the addable list.

- [ ] **Step 7: Commit**

```bash
git add components/admin/featured-row-actions.tsx app/admin/curation/page.tsx components/admin/admin-nav.tsx
git commit -m "feat(admin): /admin/curation page with featured list + reorder"
```

---

## Task 5: Public homepage Featured section

**Files:**
- Modify: `lib/doors/queries.ts`
- Modify: `app/page.tsx`

**Context:** Spec §"Public homepage — `app/page.tsx`".

- [ ] **Step 1: Extend `lib/doors/queries.ts`**

Open `lib/doors/queries.ts`. Update the `DoorsListOptions` type and `listDoors` body, and add `listFeaturedForPublic` at the bottom. The final file should look like:

```ts
import { createClient } from '@/lib/supabase/server'
import type { Door, DoorWithFiles } from '@/lib/types/door'

export type DoorsListOptions = {
  size?: string
  sort?: 'recent' | 'blocks' | 'ticks'
  search?: string
  excludeIds?: string[]
}

export async function listDoors(opts: DoorsListOptions = {}): Promise<Door[]> {
  const supabase = await createClient()
  let q = supabase.from('doors').select('*')

  if (opts.size) q = q.eq('door_size', opts.size)

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.or(`title.ilike.${term},author.ilike.${term},description.ilike.${term}`)
  }

  if (opts.excludeIds && opts.excludeIds.length > 0) {
    q = q.not('id', 'in', `(${opts.excludeIds.join(',')})`)
  }

  switch (opts.sort) {
    case 'blocks':
      q = q.order('block_count', { ascending: true, nullsFirst: false })
      break
    case 'ticks':
      q = q.order('total_ticks', { ascending: true, nullsFirst: false })
      break
    case 'recent':
    default:
      q = q.order('created_at', { ascending: false })
  }

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as Door[]
}

export async function getDoor(id: string): Promise<DoorWithFiles | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*, door_files(*)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as DoorWithFiles | null) ?? null
}

export async function listAvailableSizes(): Promise<Array<{ size: string; count: number }>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('doors').select('door_size')
  if (error) throw error
  const map = new Map<string, number>()
  for (const row of data ?? []) {
    map.set(row.door_size, (map.get(row.door_size) ?? 0) + 1)
  }
  return Array.from(map.entries())
    .map(([size, count]) => ({ size, count }))
    .sort((a, b) => {
      const [aw, ah] = a.size.split('x').map(Number)
      const [bw, bh] = b.size.split('x').map(Number)
      return aw - bw || ah - bh
    })
}

export async function listFeaturedForPublic(): Promise<Door[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('*')
    .eq('is_featured', true)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as Door[]
}
```

The change set: `excludeIds?: string[]` added to `DoorsListOptions`; the `.not('id', 'in', ...)` branch added to `listDoors`; `listFeaturedForPublic` appended. The other two functions are unchanged.

- [ ] **Step 2: Modify `app/page.tsx`**

Open `app/page.tsx`. The top-of-body logic (before `return`) needs to compute `hasFilter`, fetch featured, and pass `excludeIds` into `listDoors`.

Find this block:

```ts
  const [doors, sizes] = await Promise.all([
    listDoors({ size: sizeParam, sort, search: search || undefined }),
    listAvailableSizes(),
  ])
```

Replace with:

```ts
  const hasFilter = !!sizeParam || !!search || sort !== 'recent'
  const featured = hasFilter ? [] : await listFeaturedForPublic()
  const excludeIds = featured.map((d) => d.id)

  const [doors, sizes] = await Promise.all([
    listDoors({
      size: sizeParam,
      sort,
      search: search || undefined,
      excludeIds: excludeIds.length > 0 ? excludeIds : undefined,
    }),
    listAvailableSizes(),
  ])
```

Add `listFeaturedForPublic` to the import:

```ts
import { listAvailableSizes, listDoors, listFeaturedForPublic } from '@/lib/doors/queries'
```

Render the Featured section. Find the current `{/* Grid */}` section (it renders `doors.map((door) => (<DoorCard key={door.id} door={door} />))` inside a grid). Insert a new section **above** it (above the `<section className="flex flex-col gap-3">` that wraps the main grid):

```tsx
      {featured.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm tracking-widest uppercase text-muted-foreground">Featured</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {featured.map((door) => (
              <DoorCard key={door.id} door={door} />
            ))}
          </div>
        </section>
      ) : null}
```

Leave everything else in `app/page.tsx` — header, sign-in CTA, filter bar, main grid, footer helpers (`DoorCard`, `Stat`, `SizePill`) — unchanged.

- [ ] **Step 3: Typecheck + build**

```bash
bunx tsc --noEmit && bun run build
```

Expected: both pass.

- [ ] **Step 4: Manual verify**

- Visit `/` — default (`recent`, no filter): Featured section shows featured doors; main grid shows non-featured only.
- Visit `/?size=3x3` (or any size pill): Featured section gone; main grid shows matching doors (including any featured that match).
- Visit `/?q=foo`: Featured section gone.
- Visit `/?sort=blocks`: Featured section gone.
- Visit `/?sort=recent` (explicit, same as default): Featured section still present.
- Click a Featured card → goes to `/view/[id]` correctly.
- From curation, `↑`/`↓` a featured door, reload `/` → order reflects the change.

- [ ] **Step 5: Commit**

```bash
git add lib/doors/queries.ts app/page.tsx
git commit -m "feat(catalog): render Featured section on unfiltered homepage"
```

---

## Task 6: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Context:** Spec §"Documentation to update after implementation".

- [ ] **Step 1: CLAUDE.md — add `/admin/curation` to the routes table**

Open `CLAUDE.md`. Find the routes table with the existing `/admin/*` rows. Insert a new row after `/admin/audit`:

```markdown
| `/admin/curation` | Server Component | Mark any door `is_featured`, unfeature, and reorder with up/down arrows. Atomic swap via `swap_featured_sort_order` RPC. |
```

- [ ] **Step 2: CLAUDE.md — extend the "Admin role" subsection**

Find the "Admin role" subsection under "Data & auth boundary". Append after the bullet about `admin_users_list`:

```markdown
- **Curation lives on `doors` itself**, not a separate table. `doors.is_featured boolean` flags a door for homepage promotion; `doors.sort_order int` (dormant before Phase 3) is the relative order among featured doors, ascending. A partial index `doors_featured_idx` covers `(sort_order, created_at desc) WHERE is_featured = true AND deleted_at IS NULL` for fast public lookup.
- **Admin reorder goes through `public.swap_featured_sort_order(uuid, uuid)`** — a SECURITY DEFINER RPC that locks both rows (`FOR UPDATE`) and swaps their `sort_order`. Raises `not_admin` / `not_featured` on misuse. The server actions find the immediate up/down neighbor and call swap; boundary presses (first row ↑, last row ↓) are UI-disabled AND action-level no-ops.
```

- [ ] **Step 3: CLAUDE.md — clarify homepage behavior**

Find the Routes table row for `/`. Replace the "Purpose" column text with:

```markdown
Catalog. Size pill filter, sort dropdown (`recent` / `blocks` / `ticks`), text search via `searchParams`. Shows an admin-curated "Featured" section above the main grid **only** when no filter is active (no size, empty search, default sort); featured doors are excluded from the main grid to avoid duplicates.
```

- [ ] **Step 4: README.md — add `/admin/curation` to "What admins can do"**

Open `README.md`. Find the bullet list under "What admins can do". Insert before the `/admin/audit` bullet:

```markdown
- `/admin/curation` — mark doors as featured, remove them from featured, and
  reorder with up/down arrow buttons. The order here drives the order of the
  Featured section on the public homepage.
```

- [ ] **Step 5: README.md — note the homepage Featured section**

Find the "Architecture highlights" section (or another natural slot). Insert a bullet:

```markdown
- The public homepage shows an admin-curated **Featured** row above the main
  catalog grid, but **only** when the visitor has no filter active (no size
  pill, no search, default sort). The moment a filter is applied, Featured
  disappears and the grid shows all matching doors — featured or not.
```

- [ ] **Step 6: Typecheck (catches code regressions if any markdown edit accidentally broke fenced TS blocks)**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document /admin/curation, is_featured, sort_order, homepage Featured"
```

---

## Self-review summary

Against `docs/superpowers/specs/2026-04-22-admin-phase-3-design.md`:

| Spec section | Implemented in |
|---|---|
| §Goals (1) feature via `/admin/curation` | Tasks 1 (schema), 3 (featureDoor), 4 (UI) |
| §Goals (2) reorder with arrows | Tasks 1 (swap RPC), 3 (move actions), 4 (arrow buttons) |
| §Goals (3) homepage Featured only when unfiltered, no duplicates | Task 5 (`hasFilter` branch + `excludeIds`) |
| §Goals (4) soft-delete interaction (hide featured, flag kept) | Task 2 (queries filter `deleted_at is null`), Task 5 (same for public) |
| §Goals (5) audit every action | Task 2 (types), Task 3 (action bodies) |
| §Non-goals (collections, hero, auto rules, drag, edit-page field, doors-row toggle) | Not implemented — spec enforces |
| §Decisions table (Scope A, H1, R2, `+10` gap, has-filter definition) | All honored — check migration, action bodies, `hasFilter` |
| §Architecture / routes & files | Tasks 4, 5 |
| §Data model | Task 1 |
| §Audit actions | Task 2 |
| §Server Actions | Task 3 |
| §UI | Task 4 |
| §Public homepage | Task 5 |
| §Error handling & edge cases | Task 3 (no-op branches, error pass-through), Task 4 (disabled buttons) |
| §Testing | Task 1 (MCP), Task 4/5 (manual smoke) |
| §Documentation updates | Task 6 |

**No placeholders**. All type and function names match across tasks: `AuditAction`, `FeaturedDoorRow`, `listFeaturedForAdmin`, `listAddableDoors`, `listFeaturedForPublic`, `DoorsListOptions` (extended with `excludeIds`), `ActionResult`, `featureDoor`, `unfeatureDoor`, `moveFeaturedUp`, `moveFeaturedDown`, `FeaturedRowActions`, `AddButton`, `is_featured`, `sort_order`, `swap_featured_sort_order`.

**Type consistency check**: `ActionResult` in Task 3 mirrors Phase 1/2 locally (same shape `{ ok: true } | { ok: false; error: string }`, not shared). `AdminDoorRow` in Task 2 implicitly gains `is_featured` via the base `Door` type extension — both `listFeaturedForAdmin` and `listAddableDoors` rely on this.
