-- Persistent per-user preference for the client-side notification tone.
alter table public.profiles
  add column if not exists notification_sound_enabled boolean not null default true;

update public.profiles
set notification_sound_enabled = true
where notification_sound_enabled is null;

create or replace function public.set_notification_sound_enabled(p_enabled boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  update public.profiles
  set notification_sound_enabled = coalesce(p_enabled, true)
  where id = auth.uid();

  if not found then
    raise exception 'Active profile was not found';
  end if;

  return coalesce(p_enabled, true);
end;
$$;

revoke all on function public.set_notification_sound_enabled(boolean) from public;
revoke all on function public.set_notification_sound_enabled(boolean) from anon;
grant execute on function public.set_notification_sound_enabled(boolean) to authenticated;
