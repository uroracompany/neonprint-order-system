-- Role-aware cancellation notifications and persistent notification dismissal.
-- This migration keeps existing notification contracts while making hidden rows
-- durable across login/realtime refreshes.

alter table public.notifications
  add column if not exists deleted_at timestamptz;

create index if not exists idx_notifications_user_visible_created
  on public.notifications (user_id, created_at desc)
  where deleted_at is null and coalesce(is_archived, false) = false;

create or replace function public.notification_order_status_label(p_status text)
returns text
language sql
immutable
as $$
  select case p_status
    when 'Pending' then 'Pendiente'
    when 'in_Design' then 'En diseno'
    when 'In_Design' then 'En diseno'
    when 'in_Quote' then 'En cotizacion'
    when 'in_Production' then 'En produccion'
    when 'in_Termination' then 'En terminacion'
    when 'in_Completed' then 'Completada'
    when 'in_Delivered' then 'Entregada'
    when 'cancelled' then 'Cancelada'
    else coalesce(nullif(p_status, ''), 'Sin estado')
  end;
$$;

revoke all on function public.notification_order_status_label(text) from public;
revoke all on function public.notification_order_status_label(text) from anon;
grant execute on function public.notification_order_status_label(text) to authenticated;

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

create or replace function public.handle_order_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := coalesce(public.current_profile_role(), '');
  admins uuid[] := public.get_admin_user_ids();
  printers uuid[] := public.get_role_user_ids('printer');
  base_recipients uuid[];
  affected_recipients uuid[];
  designer_recipients uuid[] := array[]::uuid[];
  quote_recipients uuid[] := array[]::uuid[];
  actor_confirmation_recipients uuid[] := array[]::uuid[];
  meta jsonb;
  event_type text := 'order_updated';
  is_return_event boolean := false;
  has_seller_edit_changes boolean := false;
begin
  if new.designer_id is not null and exists (
    select 1
    from public.profiles p
    where p.id = new.designer_id
      and p.role = 'designer'
      and coalesce(p.employment_status, true) = true
  ) then
    designer_recipients := array[new.designer_id];
  end if;

  if new.quote_id is not null and exists (
    select 1
    from public.profiles p
    where p.id = new.quote_id
      and p.role = 'quote'
      and coalesce(p.employment_status, true) = true
  ) then
    quote_recipients := array[new.quote_id];
  end if;

  actor_confirmation_recipients := array_remove(array[actor_id], null);

  meta := jsonb_build_object(
    'status', new.status,
    'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
    'payment_status', new.payment_status,
    'client_name', new.client_name,
    'order_type', new.order_type,
    'order_design_type', new.order_design_type,
    'actor_id', actor_id
  );

  if tg_op = 'UPDATE' then
    is_return_event := new.return_reason is distinct from old.return_reason
      and new.return_reason is not null
      and (
        (new.order_design_type = 'EXTERNAL_DESING' and new.status = 'Pending')
        or (coalesce(new.order_design_type, '') <> 'EXTERNAL_DESING' and new.status = 'in_Design')
      );

    has_seller_edit_changes := actor_role = 'seller'
      and coalesce(array_length(designer_recipients, 1), 0) > 0
      and (
        new.client_name is distinct from old.client_name
        or new.client_contact is distinct from old.client_contact
        or new.description is distinct from old.description
        or new.material is distinct from old.material
        or new.termination_type is distinct from old.termination_type
        or new.delivery_date is distinct from old.delivery_date
        or new.order_file_url is distinct from old.order_file_url
        or new.preview_image is distinct from old.preview_image
      );
  end if;

  if tg_op = 'INSERT' then
    event_type := 'new_order';
    base_recipients := array_remove(array[new.created_by, new.seller_id, actor_id] || admins, null);

    perform public.notify_many(
      base_recipients,
      'new_order',
      'Nueva orden creada',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' creada correctamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_created')
    );

    insert into public.order_events(order_id, actor_id, event_type, new_status, new_payment_status, changes)
    values (new.id, actor_id, 'order_created', new.status, new.payment_status, to_jsonb(new));

    return new;
  end if;

  insert into public.order_events(
    order_id,
    actor_id,
    event_type,
    old_status,
    new_status,
    old_payment_status,
    new_payment_status,
    changes
  )
  values (
    new.id,
    actor_id,
    'order_updated',
    old.status,
    new.status,
    old.payment_status,
    new.payment_status,
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );

  if new.designer_id is distinct from old.designer_id
    and new.designer_id is not null
    and coalesce(array_length(designer_recipients, 1), 0) > 0 then
    perform public.notify_many(
      actor_confirmation_recipients,
      'order_assigned',
      'Enviada a diseno',
      'La orden fue asignada a diseno exitosamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'designer_assigned_confirmation')
    );

    perform public.notify_many(
      designer_recipients,
      'order_assigned',
      'Nueva orden para diseno',
      'Se te ha asignado una nueva orden para diseno.',
      new.id,
      meta || jsonb_build_object('event_kind', 'designer_assigned')
    );
  end if;

  if new.quote_id is distinct from old.quote_id
    and new.quote_id is not null
    and coalesce(array_length(quote_recipients, 1), 0) > 0 then
    perform public.notify_many(
      actor_confirmation_recipients,
      'order_assigned',
      'Enviada a cotizacion',
      'La orden fue enviada a Cotizacion exitosamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'quote_assignment_confirmation')
    );

    perform public.notify_many(
      quote_recipients,
      'order_assigned',
      'Nueva orden para cotizar',
      'Se te ha asignado una nueva orden para cotizar.',
      new.id,
      meta || jsonb_build_object('event_kind', 'quote_assigned')
    );
  end if;

  if is_return_event then
    perform public.notify_many(
      actor_confirmation_recipients,
      'order_returned',
      case
        when new.order_design_type = 'EXTERNAL_DESING' then 'Orden devuelta al seller'
        else 'Orden devuelta a diseno'
      end,
      case
        when new.order_design_type = 'EXTERNAL_DESING' then 'La orden fue devuelta al Seller exitosamente.'
        else 'La orden fue devuelta al area de Diseno exitosamente.'
      end,
      new.id,
      meta || jsonb_build_object(
        'event_kind',
        case
          when new.order_design_type = 'EXTERNAL_DESING' then 'returned_to_seller_confirmation'
          else 'returned_to_designer_confirmation'
        end,
        'return_reason', new.return_reason
      )
    );

    if new.order_design_type = 'EXTERNAL_DESING' then
      perform public.notify_many(
        array_remove(array_remove(array[new.seller_id, new.created_by], null), actor_id),
        'order_returned',
        'Orden devuelta desde cotizacion',
        'La orden fue devuelta desde Cotizacion y requiere revision.',
        new.id,
        meta || jsonb_build_object('event_kind', 'returned_to_seller', 'return_reason', new.return_reason)
      );
    else
      perform public.notify_many(
        array_remove(designer_recipients, actor_id),
        'order_returned',
        'Orden devuelta desde cotizacion',
        'La orden fue devuelta desde Cotizacion y requiere revision.',
        new.id,
        meta || jsonb_build_object('event_kind', 'returned_to_designer', 'return_reason', new.return_reason)
      );
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    perform public.notify_many(
      array_remove(quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers, null),
      'order_updated',
      'Pago actualizado',
      'Pago de la orden de ' || coalesce(new.client_name, 'cliente') || ' actualizado a ' || new.payment_status || '.',
      new.id,
      meta || jsonb_build_object('event_kind', 'payment_updated', 'previous_payment_status', old.payment_status)
    );
  end if;

  if has_seller_edit_changes then
    perform public.notify_many(
      actor_confirmation_recipients,
      'order_updated',
      'Orden actualizada',
      'La orden fue actualizada exitosamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'seller_update_confirmation')
    );

    perform public.notify_many(
      array_remove(designer_recipients, actor_id),
      'order_updated',
      'Orden actualizada por seller',
      'La orden asignada a Diseno fue actualizada por el Seller.',
      new.id,
      meta || jsonb_build_object('event_kind', 'seller_updated_order')
    );
  end if;

  if new.status is distinct from old.status
    and new.status = 'cancelled'
    and not is_return_event then
    affected_recipients := array_remove(
      array_remove(designer_recipients || quote_recipients || array[new.seller_id, new.created_by] || admins || printers, null),
      actor_id
    );

    perform public.notify_many(
      actor_confirmation_recipients,
      'order_cancelled',
      'Orden cancelada',
      'La orden de ' || coalesce(new.client_name, 'cliente') || ' ha sido cancelada exitosamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_cancelled_confirmation', 'cancellation_reason', new.cancellation_reason)
    );

    perform public.notify_many(
      affected_recipients,
      'order_cancelled',
      'Orden cancelada',
      'La orden de ' || coalesce(new.client_name, 'cliente') || ' ha sido cancelada.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_cancelled', 'cancellation_reason', new.cancellation_reason)
    );
  end if;

  if new.status is distinct from old.status
    and new.status <> 'cancelled'
    and not (
      new.designer_id is distinct from old.designer_id
      and new.designer_id is not null
      and new.status in ('in_Design', 'In_Design')
    )
    and not (
      new.quote_id is distinct from old.quote_id
      and new.quote_id is not null
      and new.status = 'in_Quote'
    )
    and not is_return_event then
    event_type := case
      when new.status = 'in_Completed' then 'order_completed'
      else 'order_updated'
    end;

    perform public.notify_many(
      array_remove(designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers, null),
      event_type,
      case
        when new.status = 'in_Completed' then 'Orden completada'
        when new.status in ('in_Design', 'In_Design') then 'Orden en diseno'
        when new.status = 'in_Quote' then 'Orden en cotizacion'
        when new.status = 'in_Production' then 'Orden en produccion'
        when new.status = 'in_Termination' then 'Orden lista para entrega'
        when new.status = 'in_Delivered' then 'Orden entregada'
        else 'Estado actualizado'
      end,
      'La orden de ' || coalesce(new.client_name, 'cliente') || ' cambio de ' ||
        public.notification_order_status_label(old.status) || ' a ' ||
        public.notification_order_status_label(new.status) || '.',
      new.id,
      meta || jsonb_build_object('event_kind', 'status_changed')
    );
  end if;

  if new.is_archived is distinct from old.is_archived
    or new.is_archived_admin is distinct from old.is_archived_admin
    or new.is_archived_designer is distinct from old.is_archived_designer
    or new.is_archived_quote is distinct from old.is_archived_quote then
    perform public.notify_many(
      array_remove(array[actor_id, new.seller_id, new.created_by] || admins, null),
      'order_archived',
      'Orden archivada',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' archivada correctamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_archived')
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_order_change_notification() from public;
revoke all on function public.handle_order_change_notification() from anon;
revoke all on function public.handle_order_change_notification() from authenticated;

update public.notifications n
set
  type = 'order_cancelled',
  title = 'Orden cancelada',
  message = case
    when n.user_id::text = n.metadata->>'actor_id'
      then 'La orden de ' || coalesce(nullif(n.metadata->>'client_name', ''), 'cliente') || ' ha sido cancelada exitosamente.'
    else 'La orden de ' || coalesce(nullif(n.metadata->>'client_name', ''), 'cliente') || ' ha sido cancelada.'
  end,
  metadata = n.metadata || jsonb_build_object(
    'event_kind',
    case
      when n.user_id::text = n.metadata->>'actor_id' then 'order_cancelled_confirmation'
      else 'order_cancelled'
    end
  )
where coalesce(n.metadata->>'event_kind', '') = 'status_changed'
  and coalesce(n.metadata->>'status', '') = 'cancelled'
  and n.message ilike '% cambio de % a cancelled.%';

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
