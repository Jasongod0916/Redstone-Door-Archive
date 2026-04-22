-- Admin moderation Phase 0/1: soft-delete on doors, audit log table,
-- SECURITY DEFINER view + bootstrap function.
--
-- See docs/superpowers/specs/2026-04-22-admin-phase-0-1-design.md and
-- docs/superpowers/plans/2026-04-22-admin-phase-0-1.md.

-- Soft delete metadata on doors.
alter table public.doors
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null;

create index if not exists doors_deleted_at_idx
  on public.doors (deleted_at)
  where deleted_at is not null;

-- Public catalog must hide soft-deleted rows; admins see everything.
drop policy if exists "doors_select_public" on public.doors;
create policy "doors_select_public"
  on public.doors for select
  using (
    deleted_at is null
    or auth.uid() in (select user_id from public.admin_users)
  );

-- Audit log: append-only, admin-readable, admin-insertable.
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id) on delete set null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx      on public.admin_audit_log (actor_id, created_at desc);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_select_admin" on public.admin_audit_log;
create policy "admin_audit_log_select_admin"
  on public.admin_audit_log for select to authenticated
  using (auth.uid() in (select user_id from public.admin_users));

drop policy if exists "admin_audit_log_insert_admin" on public.admin_audit_log;
create policy "admin_audit_log_insert_admin"
  on public.admin_audit_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and auth.uid() in (select user_id from public.admin_users)
  );
-- No update/delete policies: audit rows are immutable.

-- SECURITY DEFINER view exposing admin user_id -> email,
-- readable only by callers who are themselves in admin_users.
create or replace view public.admin_users_with_email
  with (security_invoker = false)
  as
  select
    au.user_id,
    u.email::text as email
  from public.admin_users au
  join auth.users u on u.id = au.user_id
  where auth.uid() in (select user_id from public.admin_users);

comment on view public.admin_users_with_email is
  'Exposes admin emails to admin users only. Used by /admin UI to render actor email.';

grant select on public.admin_users_with_email to authenticated;

-- Bootstrap function: admin_users has no INSERT policy, so the first admin must
-- be inserted via a SECURITY DEFINER function that bypasses RLS.
-- Contract: returns true iff the caller was inserted this call. One-shot —
-- once admin_users has any row, it always returns false.
create or replace function public.bootstrap_admin(bootstrap_email text)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
begin
  if caller_id is null then
    return false;
  end if;
  if bootstrap_email is null or btrim(bootstrap_email) = '' then
    return false;
  end if;

  select email into caller_email from auth.users where id = caller_id;
  if caller_email is null then
    return false;
  end if;

  if lower(btrim(caller_email)) <> lower(btrim(bootstrap_email)) then
    return false;
  end if;

  if exists (select 1 from public.admin_users) then
    return false;
  end if;

  insert into public.admin_users (user_id) values (caller_id)
    on conflict (user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.bootstrap_admin(text) from public;
grant execute on function public.bootstrap_admin(text) to authenticated;
