# Admin interface — Phase 2 (user & permission management)

**Status:** approved, ready for implementation plan
**Date:** 2026-04-22
**Scope:** Phase 2 only. Phase 1 (moderation) shipped separately. Phase 3 (curation) and Phase 4 (ops dashboard) are each their own future spec.

## Context

Phase 0/1 shipped with admin membership managed entirely via the `public.admin_users` table, seeded through a one-shot SECURITY DEFINER RPC (`bootstrap_admin`) gated by `ADMIN_BOOTSTRAP_EMAIL`. That works for the first admin but offers no path for promoting a second, for demoting someone who leaves, or for understanding who has registered in the app.

Phase 2 adds a `/admin/users` page and the minimum DB surface to manage admin membership through the UI. It also exposes a full registered-user listing so admins can see who's active on the platform before taking any action.

## Goals

1. An admin can list every registered user (email, join date, activity, door counts, admin flag) from `/admin/users` without touching SQL.
2. An admin can promote any user to admin, and demote any admin (including themselves), through the UI.
3. The system **never** allows the last remaining admin to be demoted — the action is blocked server-side in the RPC, not just hidden in the UI.
4. All admin promotion and demotion actions write to `admin_audit_log`.
5. Phase 1's env-var bootstrap continues to work as a fallback but becomes irrelevant once any admin exists (unchanged behavior).

## Non-goals

- No user banning (`auth.users.banned_until`). If spam becomes a real problem, add as a Phase 2.5 extension.
- No bulk operations on a user's content (e.g., "soft-delete all their uploads"). Phase 1's per-row delete on `/admin/doors` covers this manually for small N.
- No user deletion from the admin UI. Deleting an auth user requires the service-role key; keep that in the Supabase Dashboard for now.
- No invite / account-creation flow. Users self-register via the existing `/auth/login` page.
- No super-admin tier. Flat model: any admin can promote or demote any other admin, subject to the last-admin protection.
- No per-user detail page. All actions happen inline on the single list page.
- No password resets / email changes on behalf of users.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **B — admin management + full user list** | A (admin-only listing) is too narrow; C (ban) is reactive and can wait. |
| Self-protection | **SP1 — block last-admin demote, confirm self-demote, flat hierarchy** | The only universally-required rule. Super-admin tiering (SP3) is enterprise overkill. |
| UI shape | **U1 — single-page table with inline actions** | Only 1 user today; adding a detail page duplicates `/admin/doors` functionality. |
| FK behavior on `admin_users.user_id` | **Change from NO ACTION to CASCADE** | So auth-level user deletion doesn't leave orphan admin_users rows or block the delete. |
| View vs RPC for user listing | **SECURITY DEFINER view** | Server Components can call it with the normal `.from(...)` pattern, matching the existing `admin_users_with_email` precedent. |
| Audit on no-op promote/demote | **Still write a row** | The intent is what matters for accountability; cheaper than branching logic. |

## Architecture

### Routes & file layout

```
app/admin/users/
  page.tsx                     U1 single-page table; server component calling requireAdmin() at the top
  _actions/
    admins.ts                  promoteAdmin / demoteAdmin Server Actions ('use server')

lib/admin/
  queries.ts                   (existing) add listUsersWithStats()
  audit.ts                     (existing) extend AuditAction with 'admin.promote' | 'admin.demote'

components/admin/
  admin-nav.tsx                (existing) flip 'Users' from disabled to enabled, drop its "Phase 2" tag
  user-row-actions.tsx         Promote/Demote button per row with AlertDialog (client component)

supabase/migrations/<ts>_admin_user_management.sql
```

### Data model

Single migration.

```sql
-- 1. FK cleanup: cascade so deleting an auth.user removes their admin_users row.
alter table public.admin_users
  drop constraint admin_users_user_id_fkey,
  add constraint admin_users_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

-- 2. SECURITY DEFINER view: admin-only, one row per auth user + join stats.
create or replace view public.admin_users_list
  with (security_invoker = false)
  as
  select
    u.id as user_id,
    u.email::text,
    u.created_at,
    u.last_sign_in_at,
    u.banned_until,
    (select count(*) from public.doors d where d.owner_id = u.id and d.deleted_at is null) as live_doors,
    (select count(*) from public.doors d where d.owner_id = u.id and d.deleted_at is not null) as deleted_doors,
    exists(select 1 from public.admin_users au where au.user_id = u.id) as is_admin
  from auth.users u
  where auth.uid() in (select user_id from public.admin_users);

comment on view public.admin_users_list is
  'Admin-only listing of every auth user + door counts + admin flag. Non-admin callers see zero rows.';

grant select on public.admin_users_list to authenticated;

-- 3. Promote / demote RPCs. admin_users has no INSERT/DELETE policy, so both
-- operations go through SECURITY DEFINER functions that re-verify the caller
-- and enforce the last-admin invariant.
create or replace function public.promote_admin(target_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
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

create or replace function public.demote_admin(target_user_id uuid)
returns boolean
language plpgsql security definer set search_path = public, auth
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

### Server Actions

`app/admin/users/_actions/admins.ts`:

- `promoteAdmin(targetUserId: string): Promise<ActionResult>` — calls `requireAdmin()`, then `rpc('promote_admin')`, then writes an `admin.promote` audit row. Revalidates `/admin/users` and `/admin`.
- `demoteAdmin(targetUserId: string): Promise<ActionResult>` — calls `requireAdmin()`, then `rpc('demote_admin')`, then writes an `admin.demote` audit row with `details: { selfDemote: actor.id === targetUserId }`.

The `ActionResult` shape follows Phase 1: `{ ok: true } | { ok: false; error: string }`. The `error` propagates the RPC exception text (`not_admin` / `last_admin` / `target_not_found`) directly to the toast.

### Audit actions

`lib/admin/audit.ts`'s `AuditAction` type gains:

```ts
| 'admin.promote'
| 'admin.demote'
```

`target_type` is `'user'`; `target_id` is the affected user's UUID.

### UI — `/admin/users/page.tsx`

Server component. At top: `await requireAdmin()`. Fetches `admin_users_list` filtered by search + role filter.

Filter bar (all via `searchParams`):
- `q` — email contains (ilike)
- `role` — `all` | `admins` | `non_admins`

Table columns:

| Email | Joined | Last sign-in | Live doors | Deleted | Role | Actions |
|---|---|---|---|---|---|---|

- "Joined" and "Last sign-in" render as `YYYY-MM-DD HH:MM` in UTC to match other admin tables.
- "Role" is a `Badge` (primary color for admin, muted outline for not).
- "Actions" renders a single button via `components/admin/user-row-actions.tsx`:
  - `is_admin = false` → `Promote`. AlertDialog: "Promote {email} to admin? They will be able to moderate all content and manage other admins."
  - `is_admin = true` && not self → `Demote`. AlertDialog: "Demote {email}? They will immediately lose admin access."
  - `is_admin = true` && self → `Demote (self)`. AlertDialog with destructive styling: "You will immediately lose admin access. `/admin` will 404 on your next request. Another admin will need to restore you."
  - `is_admin = true` && the list has exactly one admin in total → button `disabled`, with a tooltip "Cannot demote the last remaining admin." The RPC also enforces this; the disabled button is UX, not a security boundary.

`components/admin/admin-nav.tsx` change: `{ href: '/admin/users', label: 'Users' }` (drop `disabled` and `phase`).

## Error handling & edge cases

| Case | Behavior |
|---|---|
| Non-admin hits `/admin/users` | Layout's `requireAdmin()` 404s. |
| Non-admin invokes a Server Action directly | Action's `requireAdmin()` 404s; never reaches the RPC. |
| Non-admin calls the RPC directly (via the anon key) | RPC raises `not_admin`. |
| `demoteAdmin` on the last admin | RPC raises `last_admin`; action returns `{ ok: false, error: 'last_admin' }`; UI toasts "Cannot demote the last admin." |
| Promote someone who's already admin | `on conflict do nothing` — DB no-op, audit row written. |
| Demote someone who isn't admin | `delete where ... ` — 0 rows affected, audit row written. |
| Admin A demotes admin B while B is viewing `/admin/users` | B's next navigation hits the layout guard and 404s. No in-page broadcast needed. |
| Admin self-demotes from the list | Success. Their current server response completes; the next request 404s. Cookie session is unaffected (they're still signed in as a normal user). |
| `admin_users_list` returns zero rows to an admin (shouldn't happen — the admin themselves is a user) | Render the empty-state message. Logically impossible unless `auth.users` and `admin_users` are inconsistent — which can't happen with FK CASCADE in place. |

## Testing

Same constraints as Phase 1: no test runner. Verification plan:

1. **Typecheck + lint + build pass**: `bunx tsc --noEmit && bun run lint && bun run build`.
2. **RLS smoke via Supabase MCP**:
   - With an anon JWT: `select * from admin_users_list` returns 0 rows; `select promote_admin('00000000-...');` raises `not_admin`.
   - With a non-admin authenticated JWT: same as above.
3. **Happy-path round trip**:
   - As the sole admin, visit `/admin/users` → table shows 1 row (self) with `Demote` disabled + tooltip.
   - Register a second account via `/auth/login`.
   - From admin's session, promote the second account → both rows show `Demote` enabled.
   - From the second account's session, `Demote` the first admin → success, first admin's `/admin` now 404s.
   - Re-promote from the second account → access restored.
4. **Last-admin protection**:
   - With two admins, second account demotes first. Now only second account is admin.
   - Second account tries to demote self → RPC raises `last_admin`; UI toast fires; row unchanged.
5. **Audit log verification**:
   - `/admin/audit` should show the four admin-management actions above with correct `actor` and `target_id`.
6. **FK cascade verification** (via MCP, using a throwaway user):
   - Create a test user, promote them, then `delete from auth.users where id = '<test>'` via the dashboard/MCP → `admin_users` row for that user is gone automatically, no FK error.

## Documentation to update after implementation

- **`CLAUDE.md`**: add `/admin/users` to the routes table; under "Admin role", mention `admin_users_list` view and `promote_admin` / `demote_admin` RPCs.
- **`README.md`**: add `/admin/users` to the "What admins can do" list; note that the last admin cannot be demoted; clarify that the env-var bootstrap is now effectively for zero-admin recovery only.
- The existing `ADMIN_BOOTSTRAP_EMAIL` entry in docs stays as-is — it's still the recovery path if someone manually truncates `admin_users`.

## Implementation delegation

Implementation will be handed to the `codex:codex-rescue` subagent once this spec is approved and the implementation plan is written by the `writing-plans` skill. Phase 2 is ~5–6 tasks vs Phase 1's 11 (smaller surface area: one migration, one page, one components file, one actions file, one queries addition, docs).
