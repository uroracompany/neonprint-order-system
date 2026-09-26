-- Persist notification state transitions and remove completed notification
-- lifecycles after their 30-day retention period.

alter table public.notifications
  add column if not exists read_at timestamptz,
  add column if not exists archived_at timestamptz;

-- Older rows do not have an exact state-transition timestamp. Starting the
-- retention clock now prevents their unexpected deletion on deployment.
update public.notifications
set read_at = now()
where coalesce(is_read, false) = true
  and read_at is null;

update public.notifications
set archived_at = now()
where coalesce(is_archived, false) = true
  and archived_at is null;

-- Existing logical deletions also begin their final 30-day retention period
-- on deployment, rather than being permanently removed immediately.
update public.notifications
set deleted_at = now()
where deleted_at is not null;

create index if not exists idx_notifications_retention_state_changed
  on public.notifications (
    (greatest(
      coalesce(read_at, '-infinity'::timestamptz),
      coalesce(archived_at, '-infinity'::timestamptz),
      coalesce(deleted_at, '-infinity'::timestamptz)
    ))
  )
  where coalesce(is_read, false) = true
    or coalesce(is_archived, false) = true
    or deleted_at is not null;

create or replace function public.archive_notification(p_notification_id uuid)
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
  set is_archived = true,
      archived_at = now()
  where id = p_notification_id
    and user_id = caller
    and deleted_at is null
    and coalesce(is_archived, false) = false;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.archive_notification(uuid) from public;
revoke all on function public.archive_notification(uuid) from anon;
grant execute on function public.archive_notification(uuid) to authenticated;

create or replace function public.dismiss_notification(p_notification_id uuid)
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
  set deleted_at = now()
  where id = p_notification_id
    and user_id = caller
    and deleted_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.dismiss_notification(uuid) from public;
revoke all on function public.dismiss_notification(uuid) from anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;

create or replace function public.purge_expired_notifications(
  p_cutoff timestamptz default now() - interval '30 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer := 0;
begin
  delete from public.notifications
  where (coalesce(is_read, false) = true or coalesce(is_archived, false) = true or deleted_at is not null)
    and greatest(
      coalesce(read_at, '-infinity'::timestamptz),
      coalesce(archived_at, '-infinity'::timestamptz),
      coalesce(deleted_at, '-infinity'::timestamptz)
    ) <= p_cutoff;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_notifications(timestamptz) from public;
revoke all on function public.purge_expired_notifications(timestamptz) from anon;
revoke all on function public.purge_expired_notifications(timestamptz) from authenticated;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'purge-expired-notifications-daily'
  ) then
    perform cron.unschedule('purge-expired-notifications-daily');
  end if;
end $$;

select cron.schedule(
  'purge-expired-notifications-daily',
  '15 3 * * *',
  $$select public.purge_expired_notifications();$$
);
