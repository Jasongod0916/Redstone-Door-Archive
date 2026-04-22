-- Admin Phase 4: ops dashboard + storage maintenance.
-- Only new DB object is the orphan-detection RPC. No schema changes.
-- See docs/superpowers/specs/2026-04-22-admin-phase-4-design.md and
-- docs/superpowers/plans/2026-04-22-admin-phase-4.md.

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
