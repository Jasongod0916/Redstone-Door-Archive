# Admin Phase 2 (user & permission management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/admin/users` with a full registered-user listing and admin promote/demote flow per `docs/superpowers/specs/2026-04-22-admin-phase-2-design.md`. Replaces the env-var bootstrap as the primary path for minting admins.

**Architecture:** Extends Phase 0/1. One migration adds the FK cascade fix, a SECURITY DEFINER view (`admin_users_list`), and two RPCs (`promote_admin`, `demote_admin`). A new server-component page at `/admin/users` queries the view; two Server Actions call the RPCs and write audit rows. Flat role model with one server-side invariant: the last admin cannot be demoted.

**Tech Stack:** Same as Phase 1 — Next 16.2.4, React 19.2.4, shadcn/ui (`radix-lyra`, Phosphor icons), `@supabase/ssr`, Tailwind v4, Bun. No test runner; verification is typecheck + lint + build + manual smoke.

**Spec reference:** `docs/superpowers/specs/2026-04-22-admin-phase-2-design.md` — tasks cite its section headings when relevant.

---

## File structure overview

```
supabase/migrations/<ts>_admin_user_management.sql    ← Task 1

lib/admin/
  audit.ts            ← Task 2 (extend AuditAction union)
  queries.ts          ← Task 2 (add listUsersWithStats)

app/admin/users/
  page.tsx            ← Task 4
  _actions/
    admins.ts         ← Task 3

components/admin/
  admin-nav.tsx       ← Task 4 (flip 'Users' to enabled)
  user-row-actions.tsx  ← Task 4

CLAUDE.md             ← Task 6
README.md             ← Task 6
```

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/<timestamp>_admin_user_management.sql`

**Context:** Implements spec §"Data model".

- [ ] **Step 1: Confirm current admin_users FK state (2026-04-22 MCP check)**

Already verified via Supabase MCP:
- `admin_users.user_id` FK to `auth.users(id)` has `delete_rule = NO ACTION` — must be switched to `CASCADE`.
- `admin_users` has exactly one policy today: `admin_users_self_read` (SELECT, `auth.uid() = user_id`). Keep it; Phase 2 does not modify existing policies.
- No existing `admin_users_list` view or `promote_admin` / `demote_admin` function (verified: `bootstrap_admin` is the only SECURITY DEFINER function in public). Safe to create fresh with `or replace`.

- [ ] **Step 2: Create the migration file**

Generate a timestamp with `date -u +%Y%m%d%H%M%S`. Filename: `supabase/migrations/<timestamp>_admin_user_management.sql`.

```sql
-- Admin Phase 2: user & permission management.
-- - FK cascade so auth user deletion cleans admin_users rows
-- - admin_users_list SECURITY DEFINER view for the /admin/users page
-- - promote_admin / demote_admin SECURITY DEFINER RPCs (admin_users has no
--   INSERT/DELETE policy for authenticated users; these are the only paths).
--
-- See docs/superpowers/specs/2026-04-22-admin-phase-2-design.md

-- 1. FK: NO ACTION -> CASCADE
alter table public.admin_users
  drop constraint admin_users_user_id_fkey,
  add constraint admin_users_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- 2. Admin-only listing view with door counts and admin flag.
create or replace view public.admin_users_list
  with (security_invoker = false)
  as
  select
    u.id as user_id,
    u.email::text as email,
    u.created_at,
    u.last_sign_in_at,
    u.banned_until,
    (select count(*) from public.doors d where d.owner_id = u.id and d.deleted_at is null) as live_doors,
    (select count(*) from public.doors d where d.owner_id = u.id and d.deleted_at is not null) as deleted_doors,
    exists(select 1 from public.admin_users au where au.user_id = u.id) as is_admin
  from auth.users u
  where auth.uid() in (select user_id from public.admin_users);

comment on view public.admin_users_list is
  'Admin-only listing of every auth user with door counts and admin flag. Non-admin callers see zero rows.';

grant select on public.admin_users_list to authenticated;

-- 3. Promote RPC.
create or replace function public.promote_admin(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;
  if not exists (select 1 from auth.users where id = target_user_id) then
    raise exception 'target_not_found';
  end if;
  insert into public.admin_users (user_id) values (target_user_id)
    on conflict (user_id) do nothing;
  return true;
end;
$$;

-- 4. Demote RPC with last-admin protection.
create or replace function public.demote_admin(target_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  remaining int;
begin
  if not exists (select 1 from public.admin_users where user_id = auth.uid()) then
    raise exception 'not_admin';
  end if;
  select count(*) into remaining from public.admin_users;
  if remaining <= 1 and exists(select 1 from public.admin_users where user_id = target_user_id) then
    raise exception 'last_admin';
  end if;
  delete from public.admin_users where user_id = target_user_id;
  return true;
end;
$$;

revoke all on function public.promote_admin(uuid) from public;
revoke all on function public.demote_admin(uuid) from public;
grant execute on function public.promote_admin(uuid), public.demote_admin(uuid) to authenticated;
```

- [ ] **Step 3: Apply the migration**

Apply via the Supabase MCP:

```
mcp__supabase__apply_migration
  project_id: mhygitjlhnyyckdnilgb
  name: admin_user_management
  query: <file contents from Step 2>
```

Or if the local project is linked: `supabase db push`.

- [ ] **Step 4: Verify via MCP**

```sql
-- FK cascade
select rc.delete_rule
from information_schema.referential_constraints rc
where rc.constraint_name = 'admin_users_user_id_fkey';
-- Expected: CASCADE

-- View exists and is readable by the admin caller
select count(*) from public.admin_users_list;
-- Expected: a positive integer (the caller, plus any other auth.users rows)

-- RPCs exist with SECURITY DEFINER
select proname, prosecdef from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and proname in ('promote_admin','demote_admin')
order by proname;
-- Expected: two rows, prosecdef = true for both
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "migrate: admin user management — FK cascade, listing view, promote/demote RPCs"
```

---

## Task 2: Extend audit actions + queries

**Files:**
- Modify: `lib/admin/audit.ts` (extend `AuditAction` union)
- Modify: `lib/admin/queries.ts` (add `UserStats` type + `listUsersWithStats`)

**Context:** Spec §"Audit actions" + §"Data model" (view query surface).

- [ ] **Step 1: Extend `AuditAction` in `lib/admin/audit.ts`**

Open `lib/admin/audit.ts`. Replace the `AuditAction` type union so it includes the two new members:

```ts
export type AuditAction =
  | 'door.update'
  | 'door.soft_delete'
  | 'door.restore'
  | 'door.hard_delete'
  | 'door.hard_delete_failed'
  | 'admin.promote'
  | 'admin.demote'
```

No other change to this file.

- [ ] **Step 2: Add `UserStats` type + `listUsersWithStats` to `lib/admin/queries.ts`**

Append to the end of `lib/admin/queries.ts`:

```ts
export type UserStats = {
  user_id: string
  email: string | null
  created_at: string
  last_sign_in_at: string | null
  banned_until: string | null
  live_doors: number
  deleted_doors: number
  is_admin: boolean
}

export type ListUsersWithStatsOptions = {
  search?: string
  role?: 'all' | 'admins' | 'non_admins'
}

export async function listUsersWithStats(
  opts: ListUsersWithStatsOptions = {},
): Promise<UserStats[]> {
  const supabase = await createClient()
  let q = supabase.from('admin_users_list').select('*')

  if (opts.search) {
    const term = `%${opts.search}%`
    q = q.ilike('email', term)
  }

  if (opts.role === 'admins') q = q.eq('is_admin', true)
  else if (opts.role === 'non_admins') q = q.eq('is_admin', false)

  q = q.order('created_at', { ascending: false })

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as UserStats[]
}
```

- [ ] **Step 3: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add lib/admin/audit.ts lib/admin/queries.ts
git commit -m "feat(admin): extend audit actions + add listUsersWithStats"
```

---

## Task 3: Server actions (promote / demote)

**Files:**
- Create: `app/admin/users/_actions/admins.ts`

**Context:** Spec §"Server Actions".

- [ ] **Step 1: Write the actions file**

Create `app/admin/users/_actions/admins.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin/guard'
import { logAdminAction } from '@/lib/admin/audit'

export type ActionResult = { ok: true } | { ok: false; error: string }

export async function promoteAdmin(targetUserId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase.rpc('promote_admin', {
    target_user_id: targetUserId,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'admin.promote',
    targetType: 'user',
    targetId: targetUserId,
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin')
  return { ok: true }
}

export async function demoteAdmin(targetUserId: string): Promise<ActionResult> {
  const actor = await requireAdmin()
  const supabase = await createClient()

  const { error } = await supabase.rpc('demote_admin', {
    target_user_id: targetUserId,
  })
  if (error) return { ok: false, error: error.message }

  await logAdminAction({
    actor,
    action: 'admin.demote',
    targetType: 'user',
    targetId: targetUserId,
    details: { selfDemote: actor.id === targetUserId },
  })

  revalidatePath('/admin/users')
  revalidatePath('/admin')
  return { ok: true }
}
```

- [ ] **Step 2: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass. If the `'use server'` directive flags non-async exports, confirm no such exports exist (the file exports only async functions and a type; types are erased and don't violate the rule).

- [ ] **Step 3: Commit**

```bash
git add app/admin/users/_actions/admins.ts
git commit -m "feat(admin): promoteAdmin / demoteAdmin server actions"
```

---

## Task 4: Users page + row actions + nav

**Files:**
- Create: `components/admin/user-row-actions.tsx`
- Create: `app/admin/users/page.tsx`
- Modify: `components/admin/admin-nav.tsx` (flip 'Users' from disabled to enabled)

**Context:** Spec §"UI — `/admin/users/page.tsx`".

- [ ] **Step 1: Write `components/admin/user-row-actions.tsx`**

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
import { promoteAdmin, demoteAdmin } from '@/app/admin/users/_actions/admins'

export type UserRowActionsProps = {
  targetUserId: string
  targetEmail: string
  isAdmin: boolean
  isSelf: boolean
  isLastAdmin: boolean
}

export function UserRowActions(props: UserRowActionsProps) {
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  if (!props.isAdmin) {
    return (
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>Promote</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promote {props.targetEmail} to admin?</AlertDialogTitle>
            <AlertDialogDescription>
              They will be able to moderate all content and manage other admins.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                start(async () => {
                  const res = await promoteAdmin(props.targetUserId)
                  if (res.ok) {
                    toast.success(`Promoted ${props.targetEmail}`)
                    setOpen(false)
                  } else {
                    toast.error(`Promote failed: ${res.error}`)
                  }
                })
              }}
            >
              Promote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  // Admin row
  if (props.isLastAdmin) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled
        title="Cannot demote the last remaining admin"
      >
        Demote
      </Button>
    )
  }

  const label = props.isSelf ? 'Demote (self)' : 'Demote'
  const copy = props.isSelf
    ? 'You will immediately lose admin access. /admin will 404 on your next request. Another admin will need to restore you.'
    : `Demote ${props.targetEmail}? They will immediately lose admin access.`

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={props.isSelf ? 'destructive' : 'outline'} disabled={pending}>
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {props.isSelf ? 'Demote yourself?' : `Demote ${props.targetEmail}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>{copy}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              start(async () => {
                const res = await demoteAdmin(props.targetUserId)
                if (res.ok) {
                  toast.success(props.isSelf ? 'You are no longer admin' : `Demoted ${props.targetEmail}`)
                  setOpen(false)
                } else {
                  toast.error(
                    res.error === 'last_admin'
                      ? 'Cannot demote the last admin'
                      : `Demote failed: ${res.error}`,
                  )
                }
              })
            }}
          >
            {props.isSelf ? 'Demote self' : 'Demote'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
```

- [ ] **Step 2: Write `app/admin/users/page.tsx`**

```tsx
import { requireAdmin } from '@/lib/admin/guard'
import { listUsersWithStats } from '@/lib/admin/queries'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { UserRowActions } from '@/components/admin/user-row-actions'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const ROLE_OPTIONS: Array<{ value: 'all' | 'admins' | 'non_admins'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'admins', label: 'Admins' },
  { value: 'non_admins', label: 'Non-admins' },
]

function fmt(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toISOString().slice(0, 16).replace('T', ' ')
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requireAdmin()
  const params = await searchParams
  const search = typeof params.q === 'string' ? params.q : ''
  const roleParam = typeof params.role === 'string' ? params.role : 'all'
  const role = (ROLE_OPTIONS.find((r) => r.value === roleParam)?.value ?? 'all') as
    | 'all' | 'admins' | 'non_admins'

  const users = await listUsersWithStats({
    search: search || undefined,
    role,
  })

  const adminCount = users.filter((u) => u.is_admin).length

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground text-sm">{users.length} results · {adminCount} admin{adminCount === 1 ? '' : 's'}</p>
      </header>

      <form className="flex flex-wrap items-end gap-3 border border-border bg-card p-4">
        <div className="flex flex-col gap-1.5 min-w-[220px]">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="q">Search email</label>
          <Input id="q" name="q" defaultValue={search} placeholder="email…" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs tracking-widest uppercase text-muted-foreground" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={role} className="border-input h-9 border bg-muted px-2 text-sm">
            {ROLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline" size="sm">Apply</Button>
      </form>

      <div className="border border-border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs tracking-widest uppercase text-muted-foreground">
            <tr>
              <th className="text-left p-3">Email</th>
              <th className="text-left p-3">Joined</th>
              <th className="text-left p-3">Last sign-in</th>
              <th className="text-left p-3">Live doors</th>
              <th className="text-left p-3">Deleted</th>
              <th className="text-left p-3">Role</th>
              <th className="text-left p-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.user_id}>
                <td className="p-3">{u.email ?? '—'}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">{fmt(u.created_at)}</td>
                <td className="p-3 text-muted-foreground text-xs tabular-nums">{fmt(u.last_sign_in_at)}</td>
                <td className="p-3 tabular-nums">{u.live_doors}</td>
                <td className="p-3 tabular-nums text-muted-foreground">{u.deleted_doors}</td>
                <td className="p-3">
                  {u.is_admin ? (
                    <Badge className="border-primary/30 bg-primary/10 text-primary">Admin</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">User</Badge>
                  )}
                </td>
                <td className="p-3">
                  <UserRowActions
                    targetUserId={u.user_id}
                    targetEmail={u.email ?? u.user_id}
                    isAdmin={u.is_admin}
                    isSelf={u.user_id === actor.id}
                    isLastAdmin={u.is_admin && adminCount === 1}
                  />
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No users match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Flip 'Users' to enabled in `components/admin/admin-nav.tsx`**

Open `components/admin/admin-nav.tsx`. Find the `ITEMS` array and replace the 'Users' entry (which currently reads `{ href: '#', label: 'Users', disabled: true, phase: 'Phase 2' }`) with:

```ts
  { href: '/admin/users', label: 'Users' },
```

Leave the 'Curation' entry untouched (still Phase 3).

- [ ] **Step 4: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 5: Manual verify locally**

```bash
bun dev
```

- As the current admin, navigate to `/admin` → click "Users" in the nav → table renders.
- Your own row shows `Admin` badge and a disabled `Demote` button (tooltip "Cannot demote the last remaining admin").
- Search filter works; role dropdown filters correctly.
- Clicking `Promote` on a non-admin row opens the AlertDialog.

- [ ] **Step 6: Commit**

```bash
git add components/admin/user-row-actions.tsx app/admin/users/page.tsx components/admin/admin-nav.tsx
git commit -m "feat(admin): /admin/users page with promote/demote actions"
```

---

## Task 5: End-to-end smoke verification

**Files:** none (verification only)

**Context:** Executes spec §"Testing".

- [ ] **Step 1: Build + typecheck + lint**

```bash
bunx tsc --noEmit && bun run lint && bun run build
```

Expected: typecheck clean, lint shows existing warnings only (no new ones), build completes with `/admin/users` listed among the routes.

- [ ] **Step 2: RLS smoke via Supabase MCP**

Using an anon-key context (or Supabase Dashboard's SQL editor with RLS on for anon):

```sql
select count(*) from public.admin_users_list;
-- Expected: 0 (not an error) — view is empty to non-admins

select public.promote_admin('00000000-0000-0000-0000-000000000000'::uuid);
-- Expected: error "not_admin"
```

- [ ] **Step 3: Happy-path round trip**

With `bun dev` running:

1. Sign in as the current sole admin → visit `/admin/users`. Confirm:
   - Own row present with `Admin` badge.
   - `Demote` button disabled with tooltip "Cannot demote the last remaining admin."
2. Register a second account (different email) via `/auth/login`.
3. Sign back in as the first admin → `/admin/users` → on the second account's row click `Promote` → confirm dialog → confirm. Expect toast "Promoted <email>" and both rows now show `Admin`. Both rows now offer `Demote`.
4. Sign out, sign in as the second admin → `/admin/users` → click `Demote` on the first admin's row. Confirm. Expect toast "Demoted <email>" and first admin's row now shows `User`.
5. Visit `/admin` while signed in as the first (now non-admin) user → 404.
6. Sign back in as the second admin → `/admin/users` → promote the first user again. Confirm access restored.

- [ ] **Step 4: Last-admin protection check**

1. With two admins, from the second admin's session, demote the first so only the second remains.
2. On the second admin's own row, verify `Demote` is disabled (tooltip).
3. In devtools, manually invoke the server action via a browser URL or rpc call — expect the RPC to raise `last_admin`. If you can't easily fabricate a call, run:
   ```sql
   select public.demote_admin('<second-admin-user-id>'::uuid);
   ```
   via the Supabase MCP with an admin JWT. Expected: error `last_admin`.
4. Re-promote the first admin to restore the two-admin state.

- [ ] **Step 5: FK cascade check**

Via the Supabase MCP:

1. Pick a throwaway non-admin auth user or create one via the dashboard.
2. Promote them via the UI.
3. Delete their auth row: use the Supabase Dashboard "Authentication > Users > delete" UI (this uses the service role under the hood).
4. Back in MCP:
   ```sql
   select count(*) from public.admin_users where user_id = '<deleted-user-id>'::uuid;
   -- Expected: 0. Their admin row cascaded away.
   ```

- [ ] **Step 6: Audit log verification**

Visit `/admin/audit`. Filter by action:
- `admin.promote` — expect at least two entries from the round trip.
- `admin.demote` — expect entries. Click "Show" on a `door.update`-style row: `admin.demote` details include `{ selfDemote: false }` for non-self demotes and `{ selfDemote: true }` if any self-demote occurred.

If any of Steps 1–6 fails, file a fix commit per failure and re-run before proceeding to Task 6.

---

## Task 6: Documentation updates

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Context:** Spec §"Documentation to update after implementation".

- [ ] **Step 1: CLAUDE.md — add `/admin/users` to the routes table**

Open `CLAUDE.md`. Find the routes table (it already lists `/admin`, `/admin/doors`, `/admin/doors/[id]/edit`, `/admin/trash`, `/admin/audit`). Insert this row immediately after the `/admin` row:

```markdown
| `/admin/users` | Server Component | User & permission management. Admin-only listing of all registered users (`admin_users_list` view) with inline promote/demote. Last admin cannot be demoted. |
```

- [ ] **Step 2: CLAUDE.md — extend the "Admin role" subsection**

Locate the "Admin role" subsection under "Data & auth boundary". Append after the bullet about `admin_users_with_email`:

```markdown
- **Admin CRUD on the `admin_users` table goes through two SECURITY DEFINER RPCs**: `public.promote_admin(uuid)` and `public.demote_admin(uuid)`. Both reject non-admin callers; `demote_admin` also refuses to remove the last remaining admin (server-enforced, independent of UI). Phase 2's `/admin/users` page is the first-class path for managing admins; `ADMIN_BOOTSTRAP_EMAIL` stays as a zero-admin recovery fallback.
- **`public.admin_users_list` view** (SECURITY DEFINER, admin-only): one row per `auth.users` entry with join stats (`live_doors`, `deleted_doors`) and an `is_admin` flag. Consumed by `/admin/users`. Returns zero rows to non-admin callers.
- **`admin_users.user_id` FK cascades** on `auth.users` delete — deleting a user automatically removes their admin membership.
```

- [ ] **Step 3: README.md — add `/admin/users` to "What admins can do"**

Open `README.md`. Find the "What admins can do" bullet list under the Admin section. Add this item (insert before `/admin/audit`):

```markdown
- `/admin/users` — list every registered user with their email, join date, last
  sign-in, and upload counts. Promote any user to admin, or demote any admin
  (including yourself) — the system refuses to demote the last remaining admin.
```

- [ ] **Step 4: README.md — revise the bootstrap note**

Find the "### Bootstrap the first admin" section. Replace the paragraph after the `ADMIN_BOOTSTRAP_EMAIL=...` code block with:

```markdown
Sign in normally. The first time that email hits `/admin` while `admin_users`
is empty, the `bootstrap_admin()` RPC inserts the row automatically. Once the
table has any entry the RPC is one-shot — all subsequent admins are added
through `/admin/users`. The env var remains as a recovery fallback if the
`admin_users` table is ever truncated, so it's safe to keep set.
```

- [ ] **Step 5: Typecheck (catches regressions in code only; markdown won't fail)**

```bash
bunx tsc --noEmit
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: document /admin/users, promote/demote RPCs, FK cascade"
```

---

## Self-review summary

Against `docs/superpowers/specs/2026-04-22-admin-phase-2-design.md`:

| Spec section | Implemented in |
|---|---|
| §Goals (1) admin lists every registered user | Task 4 |
| §Goals (2) promote / demote via UI | Tasks 1 (RPCs), 3 (actions), 4 (UI) |
| §Goals (3) last-admin protection server-side | Task 1 (`demote_admin` RPC), Task 4 (UI affordance) |
| §Goals (4) all admin actions audited | Task 2 (types), Task 3 (action bodies) |
| §Goals (5) env-var bootstrap still works unchanged | Not touched; documented in Task 6 |
| §Non-goals (ban, bulk, detail page, invite, super-admin) | None implemented — spec enforces |
| §Decisions table (Scope B, SP1, U1, FK cascade, view not RPC for listing, no-op audit row) | All honored — verify in code |
| §Architecture / routes & files | Task 4 |
| §Data model | Task 1 |
| §Server Actions | Task 3 |
| §Audit actions | Task 2 |
| §UI | Task 4 |
| §Error handling & edge cases | Tasks 1 (RPC), 3 (action error pass-through), 4 (UI) |
| §Testing (RLS, round trip, last-admin, FK cascade, audit) | Task 5 |
| §Documentation updates | Task 6 |

**No placeholders**. All type and function names match across tasks: `AuditAction`, `UserStats`, `listUsersWithStats`, `ActionResult`, `promoteAdmin`, `demoteAdmin`, `UserRowActions`, `admin_users_list`, `promote_admin`, `demote_admin`.

**Type consistency check**: `ActionResult` is redeclared locally in `app/admin/users/_actions/admins.ts` (Task 3) to match Phase 1's pattern in `app/admin/_actions/doors.ts` — not shared from a common module, same shape. This is intentional and consistent with the Phase 0/1 precedent.
