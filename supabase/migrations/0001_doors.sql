-- Redstone Door Archive: doors table + schematics storage bucket + RLS.
-- Apply with `supabase db push` (requires linked project).

create extension if not exists "pgcrypto";

-- ---------- table ----------
create table if not exists public.doors (
    id                 text primary key,
    title              text        not null,
    author             text        not null,
    description        text,
    minecraft_version  text,
    door_width         integer     not null check (door_width  > 0),
    door_height        integer     not null check (door_height > 0),
    non_air_blocks     integer     check (non_air_blocks >= 0),
    bbox_w             integer     check (bbox_w >= 0),
    bbox_h             integer     check (bbox_h >= 0),
    bbox_d             integer     check (bbox_d >= 0),
    open_ticks         integer     check (open_ticks  >= 0),
    close_ticks        integer     check (close_ticks >= 0),
    total_ticks        integer     check (total_ticks >= 0),
    video_url          text,
    tags               text[]      not null default '{}',
    -- files: { litematic?: url, schem?: url, mcstructure?: url }
    files              jsonb       not null default '{}'::jsonb,
    owner_id           uuid        references auth.users(id) on delete set null,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists doors_door_size_idx on public.doors (door_width, door_height);
create index if not exists doors_created_at_idx on public.doors (created_at desc);
create index if not exists doors_owner_idx      on public.doors (owner_id);
create index if not exists doors_tags_gin_idx   on public.doors using gin (tags);

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists doors_touch_updated_at on public.doors;
create trigger doors_touch_updated_at
before update on public.doors
for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
alter table public.doors enable row level security;

-- public catalog: anyone can read
drop policy if exists "doors_select_public" on public.doors;
create policy "doors_select_public"
on public.doors for select
using (true);

-- only signed-in users can upload; they must claim ownership
drop policy if exists "doors_insert_authenticated" on public.doors;
create policy "doors_insert_authenticated"
on public.doors for insert
to authenticated
with check (owner_id = auth.uid());

-- owners can edit their own entries
drop policy if exists "doors_update_own" on public.doors;
create policy "doors_update_own"
on public.doors for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- owners can delete their own entries
drop policy if exists "doors_delete_own" on public.doors;
create policy "doors_delete_own"
on public.doors for delete
to authenticated
using (owner_id = auth.uid());

-- ---------- storage ----------
-- public-read bucket; uploads must be authenticated and scoped to the owner's uid.
insert into storage.buckets (id, name, public)
values ('schematics', 'schematics', true)
on conflict (id) do update set public = excluded.public;

-- anyone can read schematic files
drop policy if exists "schematics_select_public" on storage.objects;
create policy "schematics_select_public"
on storage.objects for select
using (bucket_id = 'schematics');

-- first path segment must be the uploader's uid so collisions and cross-tenant writes are impossible
drop policy if exists "schematics_insert_own_folder" on storage.objects;
create policy "schematics_insert_own_folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'schematics'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "schematics_update_own" on storage.objects;
create policy "schematics_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'schematics'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "schematics_delete_own" on storage.objects;
create policy "schematics_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'schematics'
  and (storage.foldername(name))[1] = auth.uid()::text
);
