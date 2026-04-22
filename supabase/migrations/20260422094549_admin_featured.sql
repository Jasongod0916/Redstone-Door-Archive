-- Admin Phase 3: curation (featured flag + atomic swap RPC).
-- See docs/superpowers/specs/2026-04-22-admin-phase-3-design.md and
-- docs/superpowers/plans/2026-04-22-admin-phase-3.md

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
