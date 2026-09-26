-- Ensure admin order edits create visible real-time notifications for sellers.
-- The notification family fingerprint now includes event_id, so dismissing one
-- admin edit does not suppress later edits to the same order.

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
  event_id text := coalesce(p_metadata->>'event_id', '');
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
    and coalesce(metadata->>'event_id', '') = event_id
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
    and coalesce(metadata->>'event_id', '') = event_id
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
  event_id text := coalesce(p_metadata->>'event_id', '');
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
        and coalesce(metadata->>'event_id', '') = event_id
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
          and coalesce(metadata->>'event_id', '') = event_id
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

create or replace function public.order_cashier_quote_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct p_order.quote_id), array[]::uuid[])
  from public.profiles p
  where p.id = p_order.quote_id
    and p.role = 'quote'
    and coalesce(p.employment_status, true) = true
$$;

create or replace function public.admin_order_edit_production_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  with legacy_assignee as (
    select p_order.production_id as recipient_id
    where p_order.production_id is not null
  ),
  area_assignees as (
    select opa.assigned_to as recipient_id
    from public.order_production_assignments opa
    join public.production_areas pa
      on pa.code = opa.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opa.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opa.order_id = p_order.id
  ),
  file_assignees as (
    select opf.assigned_to as recipient_id
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opf.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opf.order_id = p_order.id
      and opf.assigned_to is not null
  )
  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
  from (
    select recipient_id from legacy_assignee
    union all
    select recipient_id from area_assignees
    union all
    select recipient_id from file_assignees
  ) recipients
  where recipient_id is not null
$$;

create or replace function public.admin_order_edit_notice_recipients(
  p_area text,
  p_order public.orders,
  p_actor_id uuid
)
returns uuid[]
language plpgsql
stable
set search_path = public
as $$
declare
  base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]
    || public.admin_order_edit_production_recipients(p_order);
  recipients uuid[] := array[]::uuid[];
begin
  if p_area = 'quote' then
    recipients := base_recipients
      || public.order_cashier_quote_recipients(p_order);
  elsif p_area = 'design' then
    recipients := base_recipients || public.get_role_user_ids('designer');
  elsif p_area = 'production' then
    recipients := base_recipients
      || public.admin_order_edit_production_recipients(p_order);
  elsif p_area = 'delivery' then
    recipients := base_recipients
      || array[p_order.delivery_id]
      || public.get_role_user_ids('delivery');
  elsif p_area = 'assignment' then
    recipients := base_recipients || array[
      p_order.quote_id,
      p_order.delivery_id
    ];
  else
    recipients := base_recipients;
  end if;

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
    into recipients
  from unnest(coalesce(recipients, array[]::uuid[])) as recipient_id
  where recipient_id is not null
    and recipient_id is distinct from p_actor_id;

  return recipients;
end;
$$;

revoke all on function public.order_cashier_quote_recipients(public.orders) from public;
revoke all on function public.order_cashier_quote_recipients(public.orders) from anon;
revoke all on function public.order_cashier_quote_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_production_recipients(public.orders) from public;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from anon;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from public;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from anon;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from authenticated;
