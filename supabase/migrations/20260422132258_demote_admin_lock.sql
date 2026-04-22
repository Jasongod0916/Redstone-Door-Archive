-- Fix: demote_admin race could leave zero admins.
--
-- Two concurrent demotes (A and B are the only two admins, each demoting the
-- other) both read remaining=2 under READ COMMITTED, both pass the > 1 check,
-- both delete — result: 0 admins, full lockout.
--
-- Fix: serialize all admin_users mutations through an exclusive table lock
-- inside the function. Reads (select from admin_users) still proceed.
-- promote_admin grabs the same lock so a concurrent promote cannot sneak in
-- between demote's count and delete either.
--
-- See docs/superpowers/specs/2026-04-22-admin-phase-2-design.md §Goals (3).

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

  -- Serialize all admin_users mutations (promote + demote) to prevent
  -- TOCTOU races on the last-admin invariant.
  lock table public.admin_users in exclusive mode;

  select count(*) into remaining from public.admin_users;
  if remaining <= 1 and exists(select 1 from public.admin_users where user_id = target_user_id) then
    raise exception 'last_admin';
  end if;
  delete from public.admin_users where user_id = target_user_id;
  return true;
end;
$$;

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

  -- Share the exclusive lock with demote_admin so the demote's
  -- "remaining <= 1" check cannot race against a concurrent promote.
  lock table public.admin_users in exclusive mode;

  insert into public.admin_users (user_id) values (target_user_id)
    on conflict (user_id) do nothing;
  return true;
end;
$$;
