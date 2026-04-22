-- Admin Phase 2: user & permission management.
-- - FK cascade so auth user deletion cleans admin_users rows
-- - admin_users_list SECURITY DEFINER view for the /admin/users page
-- - promote_admin / demote_admin SECURITY DEFINER RPCs (admin_users has no
--   INSERT/DELETE policy for authenticated users; these are the only paths).
--
-- See docs/superpowers/specs/2026-04-22-admin-phase-2-design.md and
-- docs/superpowers/plans/2026-04-22-admin-phase-2.md.

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
