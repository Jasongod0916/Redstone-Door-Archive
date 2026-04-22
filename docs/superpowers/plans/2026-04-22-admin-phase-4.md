# Admin Phase 4 (ops dashboard + storage maintenance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the richer `/admin` dashboard (7 stat cards + size distribution + top uploaders) and `/admin/storage` orphan-cleanup page per `docs/superpowers/specs/2026-04-22-admin-phase-4-design.md`. Completes the four-phase admin roadmap.

**Architecture:** One migration adds a SECURITY DEFINER function `list_storage_orphans()`; no schema changes. Extends `lib/admin/queries.ts` and `lib/admin/audit.ts`; adds a shared `lib/admin/format.ts` helper. Rebuilds `app/admin/page.tsx` to render the extended dashboard while keeping the existing audit feed. Adds `/admin/storage` route with a client-component multi-select flow calling a new `cleanupOrphans` Server Action.

**Tech Stack:** Same as prior phases — Next 16.2.4, React 19.2.4, shadcn/ui (`radix-lyra`, Phosphor icons), `@supabase/ssr`, Tailwind v4, Bun. Zero new runtime deps (bars hand-rendered with div + CSS widths).

**Spec reference:** `docs/superpowers/specs/2026-04-22-admin-phase-4-design.md` — tasks cite its section headings when relevant.

---

## File structure overview

```
supabase/migrations/<ts>_admin_ops.sql       ← Task 1

lib/admin/
  audit.ts                     ← Task 2 (extend AuditAction + AuditTargetType)
  queries.ts                   ← Task 2 (add getExtendedDashboardStats / getSizeDistribution / getTopUploaders / listStorageOrphans)
  format.ts                    ← Task 2 (new; formatBytes helper)

app/admin/
  page.tsx                     ← Task 4 (rewrite to show 7 cards + size dist + top uploaders)
  storage/
    page.tsx                   ← Task 5
    _actions/
      orphans.ts               ← Task 3

components/admin/
  admin-nav.tsx                ← Task 5 (add 'Storage' entry)
  storage-orphan-list.tsx      ← Task 5

CLAUDE.md                      ← Task 6
README.md                      ← Task 6
```

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/<timestamp>_admin_ops.sql`

**Context:** Implements spec §"Data model".

- [ ] **Step 1: Confirm no existing `list_storage_orphans` function**

Via Supabase MCP:

```sql
select proname from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'list_storage_orphans';
-- Expected: 0 rows
```

- [ ] **Step 2: Create the migration file**

Timestamp via `date -u +%Y%m%d%H%M%S`. Filename: `supabase/migrations/<timestamp>_admin_ops.sql`.

```sql
-- Admin Phase 4: ops dashboard + storage maintenance.
-- Only new DB object is the orphan-detection RPC. No schema changes.
-- See docs/superpowers/specs/2026-04-22-admin-phase-4-design.md

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

- [ ] **Step 3: Apply via Supabase MCP**

```
mcp__supabase__apply_migration
  project_id: mhygitjlhnyyckdnilgb
  name: admin_ops
  query: <file contents>
```

- [ ] **Step 4: Verify via MCP**

```sql
-- Function exists and is SECURITY DEFINER
select proname, prosecdef from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname = 'list_storage_orphans';
-- Expected: prosecdef = true

-- Function rejects non-admin caller (MCP runs without auth.uid())
select * from public.list_storage_orphans();
-- Expected: ERROR with 'not_admin'
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "migrate: admin ops — list_storage_orphans SECURITY DEFINER RPC"
```

---

## Task 2: Extend audit + queries + new format helper

**Files:**
- Modify: `lib/admin/audit.ts`
- Modify: `lib/admin/queries.ts`
- Create: `lib/admin/format.ts`

**Context:** Spec §"Audit actions & target types" + §"Dashboard" data sources.

- [ ] **Step 1: Extend `lib/admin/audit.ts`**

Replace the `AuditAction` union with the full 10-member version, and extend `AuditTargetType`:

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
  | 'storage.orphan_cleanup'

export type AuditTargetType = 'door' | 'user' | 'storage'
```

Leave the `LogAdminActionInput` type and `logAdminAction` function body unchanged — they reference these type names by value, so the widening propagates.

- [ ] **Step 2: Create `lib/admin/format.ts`**

```ts
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
```

- [ ] **Step 3: Extend `lib/admin/queries.ts`**

Append to the end of `lib/admin/queries.ts`:

```ts
export type ExtendedDashboardStats = DashboardStats & {
  featuredCount: number
  adminCount: number
  userCount: number
  storageBytes: number
}

export async function getExtendedDashboardStats(): Promise<ExtendedDashboardStats> {
  const supabase = await createClient()
  const base = await getDashboardStats()

  const [featured, admins, users, storageSum] = await Promise.all([
    supabase.from('doors').select('id', { count: 'exact', head: true })
      .eq('is_featured', true).is('deleted_at', null),
    supabase.from('admin_users').select('user_id', { count: 'exact', head: true }),
    supabase.from('admin_users_list').select('user_id', { count: 'exact', head: true }),
    supabase.from('door_files').select('file_size'),
  ])

  const bytes = (storageSum.data ?? []).reduce<number>((acc, row) => {
    const n = row.file_size as number | null | undefined
    return acc + (typeof n === 'number' ? n : 0)
  }, 0)

  return {
    ...base,
    featuredCount: featured.count ?? 0,
    adminCount: admins.count ?? 0,
    userCount: users.count ?? 0,
    storageBytes: bytes,
  }
}

export type SizeBucket = { size: string; count: number }

export async function getSizeDistribution(): Promise<SizeBucket[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('doors')
    .select('door_size')
    .is('deleted_at', null)
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

export type UploaderStats = {
  user_id: string
  email: string | null
  live: number
  deleted: number
  total: number
}

export async function getTopUploaders(limit = 5): Promise<UploaderStats[]> {
  const supabase = await createClient()
  // Pull every (user, door) pair we can see as an admin. Two separate queries
  // and an in-memory group-by keep us inside PostgREST's shape constraints —
  // we can't do filtered aggregates via the supabase-js builder directly.
  const [usersRes, doorsRes] = await Promise.all([
    supabase.from('admin_users_list').select('user_id, email'),
    supabase.from('doors').select('owner_id, deleted_at'),
  ])
  if (usersRes.error) throw usersRes.error
  if (doorsRes.error) throw doorsRes.error

  type Counts = { live: number; deleted: number; total: number }
  const counts = new Map<string, Counts>()
  for (const row of doorsRes.data ?? []) {
    const ownerId = row.owner_id as string | null
    if (!ownerId) continue
    const cur = counts.get(ownerId) ?? { live: 0, deleted: 0, total: 0 }
    cur.total += 1
    if (row.deleted_at == null) cur.live += 1
    else cur.deleted += 1
    counts.set(ownerId, cur)
  }

  const result: UploaderStats[] = []
  for (const u of usersRes.data ?? []) {
    const c = counts.get(u.user_id as string)
    if (!c || c.total === 0) continue
    result.push({
      user_id: u.user_id as string,
      email: (u.email as string | null) ?? null,
      live: c.live,
      deleted: c.deleted,
      total: c.total,
    })
  }

  result.sort((a, b) => b.total - a.total || b.live - a.live || (a.email ?? '').localeCompare(b.email ?? ''))
  return result.slice(0, limit)
}

export type StorageOrphan = {
  name: string
  size: number
  created_at: string
}

export async function listStorageOrphans(): Promise<StorageOrphan[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('list_storage_orphans')
  if (error) throw error
  return (data ?? []).map((r: { name: string; size: number | string; created_at: string }) => ({
    name: r.name,
    size: typeof r.size === 'string' ? Number.parseInt(r.size, 10) || 0 : r.size,
    created_at: r.created_at,
  }))
}
```

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/admin/audit.ts lib/admin/queries.ts lib/admin/format.ts
git commit -m "feat(admin): extend audit types + dashboard queries + formatBytes"
```

---

## Task 3: Orphan cleanup server action

**Files:**
- Create: `app/admin/storage/_actions/orphans.ts`

**Context:** Spec §"Server Action — cleanupOrphans".

- [ ] **Step 1: Write the action file**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true; count: number } | { ok: false; error: string }

export async function cleanupOrphans(paths: string[]): Promise<ActionResult> {
  const actor = await requireAdmin()
  if (!Array.isArray(paths) || paths.length === 0) {
    return { ok: false, error: 'no_paths' }
  }
  if (paths.length > 100) {
    return { ok: false, error: 'too_many' }
  }

  const supabase = await createClient()
  const { error } = await supabase.storage.from('schematics').remove(paths)
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'storage.orphan_cleanup',
    targetType: 'storage',
    targetId: paths[0],
    details: { count: paths.length, paths },
  })

  revalidatePath('/admin/storage')
  revalidatePath('/admin')
  return { ok: true, count: paths.length }
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add app/admin/storage/_actions/orphans.ts
git commit -m "feat(admin): cleanupOrphans server action"
```

---

## Task 4: Dashboard rewrite

**Files:**
- Modify: `app/admin/page.tsx` (full rewrite — small file)

**Context:** Spec §"Dashboard (`app/admin/page.tsx`)".

- [ ] **Step 1: Replace `app/admin/page.tsx` contents**

```tsx
import {
  getExtendedDashboardStats,
  getSizeDistribution,
  getTopUploaders,
  listAuditLog,
} from '@/lib/admin/queries'
import { formatBytes } from '@/lib/admin/format'

export default async function AdminDashboardPage() {
  const [stats, sizes, uploaders, recent] = await Promise.all([
    getExtendedDashboardStats(),
    getSizeDistribution(),
    getTopUploaders(5),
    listAuditLog({ limit: 10 }),
  ])

  const maxSize = sizes.reduce((m, s) => (s.count > m ? s.count : m), 0)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Admin dashboard</h1>
        <p className="text-muted-foreground text-sm">Catalog health + moderation overview.</p>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Live doors" value={stats.totalLive} />
        <Stat label="Including trash" value={stats.totalAll} />
        <Stat label="Last 7d uploads" value={stats.uploadsLast7Days} />
        <Stat label="Featured" value={stats.featuredCount} />
        <Stat label="Admins" value={stats.adminCount} />
        <Stat label="Users" value={stats.userCount} />
        <Stat label="Storage used" value={formatBytes(stats.storageBytes)} />
      </section>

      {/* Size distribution */}
      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Size distribution
        </header>
        {sizes.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No data.</div>
        ) : (
          <ul className="flex flex-col gap-2 p-4">
            {sizes.map((s) => {
              const pct = maxSize === 0 ? 0 : Math.round((s.count / maxSize) * 100)
              return (
                <li key={s.size} className="grid grid-cols-[3rem_3rem_1fr] items-center gap-3 text-sm tabular-nums">
                  <span className="text-foreground font-medium">{s.size}</span>
                  <span className="text-muted-foreground">{s.count}</span>
                  <div className="h-1.5 w-full bg-muted">
                    {s.count > 0 ? (
                      <div className="h-full bg-primary/70" style={{ width: `${pct}%` }} />
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Top uploaders */}
      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Top uploaders
        </header>
        {uploaders.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No uploaders yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs tracking-widest uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3 w-12">#</th>
                <th className="text-left p-3">Email</th>
                <th className="text-right p-3 w-20">Live</th>
                <th className="text-right p-3 w-20">Deleted</th>
                <th className="text-right p-3 w-20">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {uploaders.map((u, i) => (
                <tr key={u.user_id}>
                  <td className="p-3 text-muted-foreground">{i + 1}</td>
                  <td className="p-3">{u.email ?? '—'}</td>
                  <td className="p-3 text-right tabular-nums">{u.live}</td>
                  <td className="p-3 text-right tabular-nums text-muted-foreground">{u.deleted}</td>
                  <td className="p-3 text-right tabular-nums font-medium">{u.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Recent audit activity (unchanged from Phase 0/1) */}
      <section className="border border-border bg-card">
        <header className="border-b border-border px-4 py-3 text-xs tracking-widest uppercase text-muted-foreground">
          Recent activity
        </header>
        {recent.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No admin activity yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((r) => (
              <li key={r.id} className="px-4 py-3 text-sm flex flex-wrap gap-x-4 gap-y-1">
                <span className="text-muted-foreground tabular-nums">{new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ')}</span>
                <span className="text-foreground">{r.actor_email ?? r.actor_id}</span>
                <span className="text-primary">{r.action}</span>
                <span className="text-muted-foreground">{r.target_type}:{r.target_id ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border border-border bg-card p-4 flex flex-col gap-2">
      <span className="text-xs tracking-widest uppercase text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
    </div>
  )
}
```

Note: `Stat`'s `value` type is `number | string` so the Storage card can render the `formatBytes` string directly.

- [ ] **Step 2: Typecheck + build**

```bash
bunx tsc --noEmit && bun run build
```

Expected: both pass.

- [ ] **Step 3: Manual verify**

```bash
bun dev
```

- As the admin, visit `/admin`. Confirm:
  - 7 stat cards laid out 4-per-row on desktop.
  - `Storage used` shows `~1.3 KB` (current inventory).
  - Size distribution shows at least `3x3 · 2 ▓▓▓…` (given the current 2-door inventory, both are 3x3).
  - Top uploaders shows your own row with `total = 2`.
  - Recent activity below, same as before.

- [ ] **Step 4: Commit**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): extended dashboard with 7 cards + size dist + top uploaders"
```

---

## Task 5: Storage page + orphan list + nav

**Files:**
- Create: `components/admin/storage-orphan-list.tsx`
- Create: `app/admin/storage/page.tsx`
- Modify: `components/admin/admin-nav.tsx`

**Context:** Spec §"Storage page (`/admin/storage`)" + §"Nav".

- [ ] **Step 1: Write `components/admin/storage-orphan-list.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { formatBytes } from '@/lib/admin/format'
import { cleanupOrphans } from '@/app/admin/storage/_actions/orphans'
import type { StorageOrphan } from '@/lib/admin/queries'

export function StorageOrphanList({ orphans }: { orphans: StorageOrphan[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [open, setOpen] = useState(false)

  if (orphans.length === 0) {
    return (
      <div className="border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No orphan files. Storage is clean.
      </div>
    )
  }

  const allSelected = selected.size === orphans.length && orphans.length > 0
  const count = selected.size

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(orphans.map((o) => o.name)))
  }
  function toggleOne(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function onConfirmDelete() {
    start(async () => {
      const res = await cleanupOrphans([...selected])
      if (res.ok) {
        toast.success(`Deleted ${res.count} orphan ${res.count === 1 ? 'file' : 'files'}`)
        setSelected(new Set())
        setOpen(false)
        router.refresh()
      } else {
        toast.error(
          res.error === 'too_many'
            ? 'Too many files selected (max 100 at a time)'
            : `Delete failed: ${res.error}`,
        )
      }
    })
  }

  return (
    <div className="flex flex-col gap-3 border border-border bg-card">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        <label className="flex items-center gap-2 text-xs tracking-widest uppercase text-muted-foreground">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            aria-label="Select all orphan files"
          />
          Select all
        </label>
        <span className="text-xs text-muted-foreground ml-auto">
          {count} selected / {orphans.length} total
        </span>
      </header>

      <ul className="divide-y divide-border">
        {orphans.map((o) => (
          <li key={o.name} className="flex items-center gap-3 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={selected.has(o.name)}
              onChange={() => toggleOne(o.name)}
              aria-label={`Select ${o.name}`}
            />
            <code className="flex-1 truncate text-foreground">{o.name}</code>
            <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(o.size)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {new Date(o.created_at).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>

      <footer className="flex items-center justify-end gap-3 border-t border-border px-4 py-3">
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending || count === 0}
            >
              Delete {count} selected
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently delete {count} orphan files?</AlertDialogTitle>
              <AlertDialogDescription>
                The files will be removed from storage. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onConfirmDelete}>
                Delete {count}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </footer>
    </div>
  )
}
```

- [ ] **Step 2: Write `app/admin/storage/page.tsx`**

```tsx
import { requireAdmin } from '@/lib/admin/guard'
import { listStorageOrphans } from '@/lib/admin/queries'
import { StorageOrphanList } from '@/components/admin/storage-orphan-list'

export default async function AdminStoragePage() {
  await requireAdmin()
  const orphans = await listStorageOrphans()

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Storage</h1>
        <p className="text-muted-foreground text-sm">
          Bucket <code className="text-foreground">schematics</code> · {orphans.length} orphan{orphans.length === 1 ? '' : 's'}
        </p>
      </header>

      <StorageOrphanList orphans={orphans} />
    </div>
  )
}
```

- [ ] **Step 3: Modify `components/admin/admin-nav.tsx`**

Open `components/admin/admin-nav.tsx`. In the `ITEMS` array, insert a new entry directly after the 'Audit' entry:

```ts
  { href: '/admin/storage', label: 'Storage' },
```

Leave every other entry unchanged.

- [ ] **Step 4: Typecheck + build**

```bash
bunx tsc --noEmit && bun run build
```

Expected: both pass. `/admin/storage` listed among the dynamic routes.

- [ ] **Step 5: Manual verify**

With `bun dev`:

- `/admin/storage` renders with "No orphan files. Storage is clean." (current state).
- Synthesize an orphan: in the Supabase dashboard, delete one `door_files` row without touching the matching storage object. Reload `/admin/storage` → the path appears in the list with size + date.
- Check the row, "Delete 1 selected" button becomes enabled, click → AlertDialog → confirm → toast "Deleted 1 orphan file" (singular), list empties.
- `/admin/audit` → new `storage.orphan_cleanup` row with `details.count = 1` and `details.paths = [<path>]`.

- [ ] **Step 6: Commit**

```bash
git add components/admin/storage-orphan-list.tsx app/admin/storage/page.tsx components/admin/admin-nav.tsx
git commit -m "feat(admin): /admin/storage orphan list with batch cleanup"
```

---

## Task 6: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Context:** Spec §"Documentation to update after implementation".

- [ ] **Step 1: CLAUDE.md — add `/admin/storage` to routes table**

Open `CLAUDE.md`. In the routes table, insert after the `/admin/audit` row:

```markdown
| `/admin/storage` | Server Component | Storage ops: list orphan files (`storage.objects` with no matching `door_files.storage_path` via `list_storage_orphans` RPC) and batch-delete up to 100 at a time. |
```

- [ ] **Step 2: CLAUDE.md — extend Admin role with ops additions**

Find the "Admin role" subsection. Append at the end of the bullet list:

```markdown
- **Ops dashboard lives at `/admin`** — seven stat cards (Live / Trash / Last 7d / Featured / Admins / Users / Storage used), a size-distribution bar list, a top-5 uploaders table, and the existing 10-item recent audit feed.
- **Orphan storage cleanup**: `public.list_storage_orphans()` is a SECURITY DEFINER RPC that returns storage objects under the `schematics` bucket with no corresponding `door_files.storage_path`. The `/admin/storage` page renders the list; the `cleanupOrphans` Server Action calls `supabase.storage.from('schematics').remove(paths)` (capped at 100 paths per call) and writes a `storage.orphan_cleanup` audit row. Reverse orphans (`door_files` pointing to missing storage objects) are out of scope.
- **`lib/admin/format.ts` exports `formatBytes(n)`** — the single byte-formatter used by Storage used cards and the orphan list. Thresholds: B → KB → MB → GB.
```

- [ ] **Step 3: CLAUDE.md — update the `/admin` row's Purpose text**

Find the routes table's `/admin` row and replace its Purpose column with:

```markdown
Admin dashboard: 7 stat cards (Live, Trash, Last 7d uploads, Featured, Admins, Users, Storage used), size distribution, top-5 uploaders, recent audit activity. Requires membership in `admin_users`; 404s otherwise. Gated by `lib/admin/guard.ts#requireAdmin` in the layout.
```

- [ ] **Step 4: README.md — extend "What admins can do"**

Open `README.md`. Find the bullet list under "What admins can do". Add a new bullet just before `/admin/audit`:

```markdown
- `/admin/storage` — list orphan files (storage objects with no matching
  `door_files` row) and batch-delete up to 100 per action. Each cleanup
  writes a `storage.orphan_cleanup` audit entry including the full list
  of deleted paths.
```

- [ ] **Step 5: README.md — expand the dashboard description**

Find the bullet that mentions `/admin` (the one describing the dashboard; in the current README it reads roughly "dashboard with counts (live / including trash / last-7-days uploads) and the ten most recent audit entries.") and replace it with:

```markdown
- `/admin` — dashboard with seven stat cards (Live doors, Including trash,
  Last 7-day uploads, Featured, Admins, Users, Storage used), a size
  distribution bar list, a top-5 uploaders table, and the ten most recent
  audit entries.
```

- [ ] **Step 6: Typecheck (catches any code regressions; markdown edits shouldn't break anything)**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document ops dashboard + /admin/storage"
```

---

## Self-review summary

Against `docs/superpowers/specs/2026-04-22-admin-phase-4-design.md`:

| Spec section | Implemented in |
|---|---|
| §Goals (1) 7 stat cards + size dist + top uploaders | Task 4 (UI), Task 2 (queries) |
| §Goals (2) `/admin/storage` multi-select batch up to 100 | Task 5 (UI), Task 3 (action cap) |
| §Goals (3) `storage.orphan_cleanup` audit row | Task 3 (action body), Task 2 (AuditAction union) |
| §Goals (4) SECURITY DEFINER helpers | Task 1 (`list_storage_orphans`), Phase 2 `admin_users_list` reused |
| §Goals (5) no new tables / no new deps | No schema change in Task 1; bars are pure CSS in Task 4 |
| §Non-goals (reverse orphans, charts, retention, per-user storage, cache buttons, pagination, per-row delete) | None implemented — spec enforces |
| §Decisions table (C / L1 / S2 / O2 / reverse-out-of-scope / top 5 / cap 100 / DB-sum for storage-used) | All honored |
| §Architecture / routes & files | Tasks 4, 5 |
| §Data model (RPC only) | Task 1 |
| §Audit actions & target types | Task 2 |
| §Server Action `cleanupOrphans` | Task 3 |
| §Dashboard | Task 4 (cards, size dist, uploaders, recent activity preserved) |
| §Storage page | Task 5 (orphan list + batch delete) |
| §Error handling | Task 3 (`no_paths`, `too_many`), Task 5 (client-side "too_many" toast path) |
| §Testing | Task 1 MCP checks, Tasks 4/5 manual smoke |
| §Documentation updates | Task 6 |

**No placeholders.** All type and function names match across tasks: `AuditAction`, `AuditTargetType`, `ExtendedDashboardStats`, `SizeBucket`, `UploaderStats`, `StorageOrphan`, `getExtendedDashboardStats`, `getSizeDistribution`, `getTopUploaders`, `listStorageOrphans`, `formatBytes`, `cleanupOrphans`, `StorageOrphanList`, `list_storage_orphans`.

**Type consistency check:** `ActionResult` in Task 3 is `{ ok: true; count: number } | { ok: false; error: string }` — the `count` in the success branch is consumed by `StorageOrphanList` in Task 5 (`toast.success('Deleted ${res.count} orphan ...')`). Deliberately different from Phase 1–3's `{ ok: true } | { ok: false; error }`; Phase 5 has no reason to match prior phases because `count` is the specific thing the UI wants to display.
