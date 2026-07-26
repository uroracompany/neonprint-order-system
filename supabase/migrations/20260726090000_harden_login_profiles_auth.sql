-- Harden login/profile authorization surface.
-- Authenticated users can read only their own profile unless they are active admins.

create or replace function public.current_profile_role_secure()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = (select auth.uid())
    and coalesce(employment_status, true) = true
$$;

create or replace function public.current_profile_is_admin_secure()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role_secure() = 'admin', false)
$$;

revoke all on function public.current_profile_role_secure() from public;
revoke all on function public.current_profile_role_secure() from anon;
revoke all on function public.current_profile_is_admin_secure() from public;
revoke all on function public.current_profile_is_admin_secure() from anon;

grant execute on function public.current_profile_role_secure() to authenticated;
grant execute on function public.current_profile_is_admin_secure() to authenticated;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_select_self_or_admin on public.profiles;

create policy profiles_select_self_or_admin
  on public.profiles for select
  to authenticated
  using (
    (select auth.uid()) = id
    or public.current_profile_is_admin_secure()
  );
