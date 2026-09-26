-- Use the same authenticated, row-count-confirmed path for reading a
-- notification as the archive and dismissal actions.

create or replace function public.mark_notification_read(p_notification_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  updated_count integer := 0;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  update public.notifications
  set is_read = true,
      read_at = now()
  where id = p_notification_id
    and user_id = caller
    and deleted_at is null
    and coalesce(is_archived, false) = false
    and coalesce(is_read, false) = false;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_notification_read(uuid) from anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;
