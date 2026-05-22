-- Role helpers do not need elevated privileges because authenticated users
-- can read profiles through RLS. Keeping them as invoker reduces exposed
-- SECURITY DEFINER surface area.

create or replace function public.current_profile_role()
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.get_role_user_ids(p_role text)
returns uuid[]
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles
  where role = p_role and coalesce(employment_status, true) = true
$$;

create or replace function public.get_admin_user_ids()
returns uuid[]
language sql
stable
security invoker
set search_path = public
as $$
  select public.get_role_user_ids('admin')
$$;

revoke all on function public.current_profile_role() from public;
revoke all on function public.current_profile_is_admin() from public;
revoke all on function public.get_role_user_ids(text) from public;
revoke all on function public.get_admin_user_ids() from public;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_is_admin() to authenticated;
grant execute on function public.get_role_user_ids(text) to authenticated;
grant execute on function public.get_admin_user_ids() to authenticated;
