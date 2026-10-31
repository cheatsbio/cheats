-- =====================================================================
-- Murmur — Supabase schema. Run once in: Dashboard → SQL Editor → New query
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  username          text not null unique,
  display_name      text,
  bio               text,
  avatar_url        text,
  background_url    text,
  background_type   text not null default 'color'
                      check (background_type in ('image', 'video', 'color')),
  theme_color       text not null default '#0d0c14',
  accent_color      text not null default '#8b7bff',
  music_url         text,
  custom_cursor_url text,
  created_at        timestamptz not null default now(),
  constraint username_format check (username ~ '^[a-z0-9_]{3,24}$')
);

create table if not exists public.links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  title      text not null,
  url        text not null,
  icon       text not null default 'link',
  position   integer not null default 0,
  is_active  boolean not null default true,
  clicks     integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists links_user_position_idx on public.links (user_id, position);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.links    enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select using (true);

drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "Users delete own profile" on public.profiles;
create policy "Users delete own profile"
  on public.profiles for delete using (auth.uid() = id);

-- Active links are public; owners can also see their own inactive links.
drop policy if exists "Active links are publicly readable" on public.links;
create policy "Active links are publicly readable"
  on public.links for select using (is_active = true or auth.uid() = user_id);

drop policy if exists "Users insert own links" on public.links;
create policy "Users insert own links"
  on public.links for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own links" on public.links;
create policy "Users update own links"
  on public.links for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users delete own links" on public.links;
create policy "Users delete own links"
  on public.links for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Click tracking: visitors are anonymous, so increment through a
-- security-definer function instead of opening UPDATE on links.
-- ---------------------------------------------------------------------
create or replace function public.increment_link_click(link_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.links
     set clicks = clicks + 1
   where id = link_id and is_active = true;
$$;

revoke all on function public.increment_link_click(uuid) from public;
grant execute on function public.increment_link_click(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Auto-create a profile when a user signs up
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_name  text;
  final_name text;
  suffix     integer := 0;
begin
  base_name := lower(regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    '[^a-zA-Z0-9_]', '', 'g'
  ));
  if length(base_name) < 3 then
    base_name := 'user' || base_name;
  end if;
  base_name  := left(base_name, 20);
  final_name := base_name;

  while exists (select 1 from public.profiles where username = final_name) loop
    suffix     := suffix + 1;
    final_name := base_name || suffix::text;
  end loop;

  insert into public.profiles (id, username, display_name)
  values (new.id, final_name, final_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Storage: public buckets. Files live under "<user_id>/<file>" so each
-- user can only write inside their own folder.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('avatars',     'avatars',     true,  5242880),     --  5 MB
  ('backgrounds', 'backgrounds', true,  52428800),    -- 50 MB (images, video, cursors)
  ('audio',       'audio',       true,  20971520)     -- 20 MB
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "Public read of media buckets" on storage.objects;
create policy "Public read of media buckets"
  on storage.objects for select
  using (bucket_id in ('avatars', 'backgrounds', 'audio'));

drop policy if exists "Users upload to own folder" on storage.objects;
create policy "Users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'backgrounds', 'audio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users update own files" on storage.objects;
create policy "Users update own files"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'backgrounds', 'audio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own files" on storage.objects;
create policy "Users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'backgrounds', 'audio')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------
-- Profile views (also available standalone in migrations/002_profile_views.sql)
-- ---------------------------------------------------------------------
-- Profile view counter. Safe to run more than once.

alter table public.profiles
  add column if not exists views integer not null default 0;

-- Visitors are anonymous, so increment through a security-definer function
-- and return the new total so the page can show it immediately.
create or replace function public.increment_profile_views(profile_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set views = views + 1
   where id = profile_id
  returning views;
$$;

revoke all on function public.increment_profile_views(uuid) from public;
grant execute on function public.increment_profile_views(uuid) to anon, authenticated;

-- Owners can edit their own row, but must not be able to set their own view count.
create or replace function public.protect_profile_views()
returns trigger
language plpgsql
as $$
begin
  if new.views is distinct from old.views
     and current_user in ('anon', 'authenticated') then
    new.views := old.views;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_views on public.profiles;
create trigger protect_profile_views
  before update on public.profiles
  for each row execute function public.protect_profile_views();

-- Broadcast profile updates so open pages see the counter move live.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Storage limits (also available standalone in migrations/003_storage_limits.sql)
-- ---------------------------------------------------------------------
-- Server-side storage guardrails. Client checks can be bypassed; these can't.
-- Safe to run more than once. Existing files are not touched.

update storage.buckets
   set file_size_limit    = 102400,                         -- 100 KB (avatars are ~10–20 KB)
       allowed_mime_types = array['image/webp']
 where id = 'avatars';

update storage.buckets
   set file_size_limit    = 307200,                         -- 300 KB (backgrounds ~40–80 KB, cursors ≤100 KB)
       allowed_mime_types = array['image/webp', 'image/png', 'image/x-icon']
 where id = 'backgrounds';

update storage.buckets
   set file_size_limit    = 3145728,                        -- 3 MB
       allowed_mime_types = array['audio/mpeg']
 where id = 'audio';
