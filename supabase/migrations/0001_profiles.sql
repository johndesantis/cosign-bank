-- CoSign Bank — optional Supabase profile table
--
-- Run this in the Supabase dashboard → SQL Editor (or `supabase db push`).
--
-- You do NOT need this file to use email/password sign-in: Supabase Auth already
-- stores accounts in the `auth.users` table (email + a bcrypt hash of the password,
-- managed by GoTrue). Passwords are never stored by this application.
--
-- What this adds:
--   * a public `profiles` row per user, holding the display name and the role the
--     application authorises against;
--   * a trigger that creates the row on sign-up;
--   * row-level security so a user can read only their own profile.
--
-- Role grants remain a server decision: `src/lib/auth/supabaseIdentity.ts` grants
-- `account:joint-owner` from JOINT_OWNER_EMAILS (when set) or to every authenticated
-- account (demo-open). This table mirrors that for display purposes and gives you a
-- place to record grants without touching auth metadata.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'account:joint-owner',
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile mirror. Credentials live in auth.users and are managed by Supabase Auth.';

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles: update own display name" on public.profiles;
create policy "profiles: update own display name"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Insert/delete are intentionally NOT granted to clients: rows are created by the
-- trigger below and removed by cascade when the auth user is deleted.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill existing accounts (safe to re-run).
insert into public.profiles (id, email, display_name)
select
  u.id,
  coalesce(u.email, ''),
  coalesce(u.raw_user_meta_data ->> 'full_name', split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (id) do nothing;
