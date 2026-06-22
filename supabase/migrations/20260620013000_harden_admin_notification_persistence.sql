-- Harden notification persistence so archived or dismissed notification families
-- are never recreated as fresh active rows after a user signs back in.

alter table public.notifications
  add column if not exists deleted_at timestamptz;

drop index if exists public.idx_notifications_user_visible_created;
create index if not exists idx_notifications_user_visible_created
  on public.notifications (user_id, created_at desc)
  where deleted_at is null and coalesce(is_archived, false) = false;

create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
  caller uuid := auth.uid();
  event_kind text := coalesce(p_metadata->>'event_kind', '');
begin
  if p_user_id is null then
    raise exception 'Notification user_id is required';
  end if;

  if caller is not null and caller <> p_user_id and not public.current_profile_is_admin() then
    raise exception 'Cannot create notifications for another user';
  end if;

  select id into nid
  from public.notifications
  where user_id = p_user_id
    and type = p_type
    and order_id is not distinct from p_order_id
    and title = p_title
    and message = p_message
    and coalesce(metadata->>'event_kind', '') = event_kind
    and (deleted_at is not null or coalesce(is_archived, false) = true)
  order by created_at desc
  limit 1;

  if nid is not null then
    return nid;
  end if;

  select id into nid
  from public.notifications
  where user_id = p_user_id
    and type = p_type
    and order_id is not distinct from p_order_id
    and title = p_title
    and message = p_message
    and coalesce(metadata->>'event_kind', '') = event_kind
    and deleted_at is null
    and coalesce(is_archived, false) = false
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1;

  if nid is null then
    insert into public.notifications (user_id, type, title, message, order_id, metadata)
    values (p_user_id, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into nid;
  end if;

  return nid;
end;
$$;

revoke all on function public.create_notification(uuid, text, text, text, uuid, jsonb) from public;
revoke all on function public.create_notification(uuid, text, text, text, uuid, jsonb) from anon;
grant execute on function public.create_notification(uuid, text, text, text, uuid, jsonb) to authenticated;

create or replace function public.notify_many(
  p_recipients uuid[],
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  nid uuid;
  event_kind text := coalesce(p_metadata->>'event_kind', '');
begin
  foreach recipient in array coalesce(p_recipients, array[]::uuid[]) loop
    if recipient is not null then
      select id into nid
      from public.notifications
      where user_id = recipient
        and type = p_type
        and order_id is not distinct from p_order_id
        and title = p_title
        and message = p_message
        and coalesce(metadata->>'event_kind', '') = event_kind
        and (deleted_at is not null or coalesce(is_archived, false) = true)
      order by created_at desc
      limit 1;

      if nid is null then
        select id into nid
        from public.notifications
        where user_id = recipient
          and type = p_type
          and order_id is not distinct from p_order_id
          and title = p_title
          and message = p_message
          and coalesce(metadata->>'event_kind', '') = event_kind
          and deleted_at is null
          and coalesce(is_archived, false) = false
          and created_at > now() - interval '10 minutes'
        order by created_at desc
        limit 1;
      end if;

      if nid is null then
        insert into public.notifications (user_id, type, title, message, order_id, metadata)
        values (recipient, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb));
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from public;
revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from anon;
revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from authenticated;

create or replace function public.archive_notification(p_notification_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  target public.notifications%rowtype;
  updated_count integer := 0;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  select * into target
  from public.notifications
  where id = p_notification_id
    and user_id = caller
    and deleted_at is null;

  if not found then
    return 0;
  end if;

  update public.notifications n
  set is_archived = true
  where n.user_id = caller
    and n.deleted_at is null
    and coalesce(n.is_archived, false) = false
    and n.type = target.type
    and n.order_id is not distinct from target.order_id
    and n.title = target.title
    and n.message = target.message
    and coalesce(n.metadata->>'event_kind', '') = coalesce(target.metadata->>'event_kind', '');

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
  target public.notifications%rowtype;
  updated_count integer := 0;
begin
  if caller is null then
    raise exception 'Authentication required';
  end if;

  select * into target
  from public.notifications
  where id = p_notification_id
    and user_id = caller
    and deleted_at is null;

  if not found then
    return 0;
  end if;

  update public.notifications n
  set deleted_at = now()
  where n.user_id = caller
    and n.deleted_at is null
    and n.type = target.type
    and n.order_id is not distinct from target.order_id
    and n.title = target.title
    and n.message = target.message
    and coalesce(n.metadata->>'event_kind', '') = coalesce(target.metadata->>'event_kind', '');

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.dismiss_notification(uuid) from public;
revoke all on function public.dismiss_notification(uuid) from anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, type, order_id, title, message, coalesce(metadata->>'event_kind', '')
      order by created_at desc, id desc
    ) as row_rank
  from public.notifications
  where deleted_at is null
    and coalesce(is_archived, false) = false
)
update public.notifications n
set deleted_at = now()
from ranked r
where n.id = r.id
  and r.row_rank > 1;
