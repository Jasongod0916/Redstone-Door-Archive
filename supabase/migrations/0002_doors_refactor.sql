-- Redstone Door Archive: refactor doors schema to match current app types and uploads.

create extension if not exists "pgcrypto";

-- doors.id: actions.ts inserts without id; give it a uuid-string default
alter table public.doors alter column id set default gen_random_uuid()::text;

-- doors: new columns
alter table public.doors add column if not exists slug text;
update public.doors
set slug = id
where slug is null;
alter table public.doors alter column slug set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'doors_slug_key'
      and conrelid = 'public.doors'::regclass
  ) then
    alter table public.doors
    add constraint doors_slug_key unique (slug);
  end if;
end
$$;

alter table public.doors add column if not exists door_size text;
update public.doors
set door_size = door_width::text || 'x' || door_height::text
where door_size is null;
alter table public.doors alter column door_size set not null;

alter table public.doors add column if not exists block_count integer;
alter table public.doors add column if not exists bounds_width integer;
alter table public.doors add column if not exists bounds_height integer;
alter table public.doors add column if not exists bounds_depth integer;
alter table public.doors add column if not exists thumbnail_url text;

alter table public.doors add column if not exists sort_order integer default 0;
update public.doors
set sort_order = 0
where sort_order is null;
alter table public.doors alter column sort_order set default 0;
alter table public.doors alter column sort_order set not null;

-- doors: indexes
create index if not exists doors_slug_idx on public.doors (slug);

-- door_files: table
create table if not exists public.door_files (
    id           uuid primary key default gen_random_uuid(),
    door_id      text not null references public.doors(id) on delete cascade,
    format       text not null check (format in ('litematic', 'schem', 'mcstructure', 'schematic', 'nbt')),
    storage_path text not null,
    file_name    text not null,
    file_size    bigint,
    created_at   timestamptz not null default now()
);

create index if not exists door_files_door_id_idx on public.door_files (door_id);

-- door_files: rls
alter table public.door_files enable row level security;

drop policy if exists "door_files_select_public" on public.door_files;
create policy "door_files_select_public"
on public.door_files for select
to anon, authenticated
using (true);

drop policy if exists "door_files_insert_own" on public.door_files;
create policy "door_files_insert_own"
on public.door_files for insert
to authenticated
with check (
  exists (
    select 1
    from public.doors d
    where d.id = door_files.door_id
      and d.owner_id = auth.uid()
  )
);

drop policy if exists "door_files_update_own" on public.door_files;
create policy "door_files_update_own"
on public.door_files for update
to authenticated
using (
  exists (
    select 1
    from public.doors d
    where d.id = door_files.door_id
      and d.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.doors d
    where d.id = door_files.door_id
      and d.owner_id = auth.uid()
  )
);

drop policy if exists "door_files_delete_own" on public.door_files;
create policy "door_files_delete_own"
on public.door_files for delete
to authenticated
using (
  exists (
    select 1
    from public.doors d
    where d.id = door_files.door_id
      and d.owner_id = auth.uid()
  )
);
