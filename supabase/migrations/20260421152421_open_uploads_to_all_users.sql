-- Open redstone-door uploads to any signed-in user (was admin-only).
-- doors.owner_id anchors ownership; admin_users stays as a moderator override.
--
-- NOTE: this migration assumes the prior remote baseline already exists on the
-- target project: `initial_schema`, `admin_users_self_read`,
-- `door_size_free_form`, `storage_admin_policies`, `schematics_bucket_public`.
-- Those were applied via the Supabase Dashboard before this repo started
-- tracking migrations. To realign a fresh clone with the remote, run:
--
--   supabase link --project-ref <ref>
--   supabase migration repair --status applied 00001 00002 00003 00004 20260417033136
--
-- before `supabase db push`.

alter table public.doors
  add column if not exists owner_id uuid references auth.users(id) on delete set null;

create index if not exists doors_owner_id_idx on public.doors (owner_id);

-- doors: swap admin-only writes for owner-based writes (+ admin override on mutate).
drop policy if exists "doors_insert_admin" on public.doors;
drop policy if exists "doors_update_admin" on public.doors;
drop policy if exists "doors_delete_admin" on public.doors;

create policy "doors_insert_owner"
  on public.doors for insert to authenticated
  with check (owner_id = auth.uid());

create policy "doors_update_owner_or_admin"
  on public.doors for update to authenticated
  using (
    owner_id = auth.uid()
    or auth.uid() in (select user_id from public.admin_users)
  )
  with check (
    owner_id = auth.uid()
    or auth.uid() in (select user_id from public.admin_users)
  );

create policy "doors_delete_owner_or_admin"
  on public.doors for delete to authenticated
  using (
    owner_id = auth.uid()
    or auth.uid() in (select user_id from public.admin_users)
  );

-- door_files: inherit ownership via parent door (+ admin override).
drop policy if exists "door_files_insert_admin" on public.door_files;
drop policy if exists "door_files_update_admin" on public.door_files;
drop policy if exists "door_files_delete_admin" on public.door_files;

create policy "door_files_insert_owner"
  on public.door_files for insert to authenticated
  with check (
    exists (
      select 1 from public.doors d
      where d.id = door_files.door_id
        and (
          d.owner_id = auth.uid()
          or auth.uid() in (select user_id from public.admin_users)
        )
    )
  );

create policy "door_files_update_owner_or_admin"
  on public.door_files for update to authenticated
  using (
    exists (
      select 1 from public.doors d
      where d.id = door_files.door_id
        and (
          d.owner_id = auth.uid()
          or auth.uid() in (select user_id from public.admin_users)
        )
    )
  )
  with check (
    exists (
      select 1 from public.doors d
      where d.id = door_files.door_id
        and (
          d.owner_id = auth.uid()
          or auth.uid() in (select user_id from public.admin_users)
        )
    )
  );

create policy "door_files_delete_owner_or_admin"
  on public.door_files for delete to authenticated
  using (
    exists (
      select 1 from public.doors d
      where d.id = door_files.door_id
        and (
          d.owner_id = auth.uid()
          or auth.uid() in (select user_id from public.admin_users)
        )
    )
  );

-- storage (schematics bucket): swap admin-only writes for user-prefix path (+ admin override).
drop policy if exists "admin can insert schematics" on storage.objects;
drop policy if exists "admin can update schematics" on storage.objects;
drop policy if exists "admin can delete schematics" on storage.objects;

create policy "users can insert own schematics"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'schematics'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can update own schematics"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'schematics'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or auth.uid() in (select user_id from public.admin_users)
    )
  );

create policy "users can delete own schematics"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'schematics'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or auth.uid() in (select user_id from public.admin_users)
    )
  );
