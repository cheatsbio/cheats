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
