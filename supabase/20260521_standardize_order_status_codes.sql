-- Standardize order workflow statuses to internal English codes.
-- UI labels remain Spanish in the application layer.

create or replace function public.normalize_order_status_value(p_status text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_status, '')))
    when '' then p_status
    when 'pending' then 'Pending'
    when 'pendiente' then 'Pending'
    when 'in_design' then 'in_Design'
    when 'in design' then 'in_Design'
    when 'diseño' then 'in_Design'
    when 'diseno' then 'in_Design'
    when 'in_quote' then 'in_Quote'
    when 'in_quotation' then 'in_Quote'
    when 'cotizacion' then 'in_Quote'
    when 'cotización' then 'in_Quote'
    when 'quote' then 'in_Quote'
    when 'en produccion' then 'in_Production'
    when 'en producción' then 'in_Production'
    when 'produccion' then 'in_Production'
    when 'producción' then 'in_Production'
    when 'in_production' then 'in_Production'
    when 'terminacion' then 'in_Termination'
    when 'terminación' then 'in_Termination'
    when 'terminada' then 'in_Termination'
    when 'in_termination' then 'in_Termination'
    when 'en entrega' then 'in_Delivered'
    when 'entrega' then 'in_Delivered'
    when 'entregado' then 'in_Delivered'
    when 'entregada' then 'in_Delivered'
    when 'in_delivered' then 'in_Delivered'
    when 'completada' then 'in_Completed'
    when 'completado' then 'in_Completed'
    when 'completed' then 'in_Completed'
    when 'in_completed' then 'in_Completed'
    when 'cancelada' then 'cancelled'
    when 'cancelado' then 'cancelled'
    when 'cancelled' then 'cancelled'
    else p_status
  end;
$$;

update public.orders
set status = public.normalize_order_status_value(status)
where status is distinct from public.normalize_order_status_value(status);

update public.order_events
set
  old_status = public.normalize_order_status_value(old_status),
  new_status = public.normalize_order_status_value(new_status)
where
  old_status is distinct from public.normalize_order_status_value(old_status)
  or new_status is distinct from public.normalize_order_status_value(new_status);

update public.notifications
set metadata =
  case
    when metadata ? 'previous_status'
      then jsonb_set(metadata, '{previous_status}', to_jsonb(public.normalize_order_status_value(metadata->>'previous_status')), false)
    else metadata
  end
where metadata ? 'previous_status'
  and metadata->>'previous_status' is not null;

update public.notifications
set metadata =
  case
    when metadata ? 'status'
      then jsonb_set(metadata, '{status}', to_jsonb(public.normalize_order_status_value(metadata->>'status')), false)
    else metadata
  end
where metadata ? 'status'
  and metadata->>'status' is not null;

create or replace function public.normalize_order_status_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.status := public.normalize_order_status_value(new.status);
  return new;
end;
$$;

revoke all on function public.normalize_order_status_before_write() from public;
revoke all on function public.normalize_order_status_before_write() from anon;
revoke all on function public.normalize_order_status_before_write() from authenticated;

drop trigger if exists trg_normalize_order_status_before_write on public.orders;
create trigger trg_normalize_order_status_before_write
  before insert or update of status on public.orders
  for each row
  execute function public.normalize_order_status_before_write();

alter table public.orders
  drop constraint if exists orders_status_internal_codes_check;

alter table public.orders
  add constraint orders_status_internal_codes_check
  check (
    status in (
      'Pending',
      'in_Design',
      'in_Quote',
      'in_Production',
      'in_Termination',
      'in_Delivered',
      'in_Completed',
      'cancelled'
    )
  )
  not valid;

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
    and not (
      new.designer_id is distinct from old.designer_id
      and new.designer_id is not null
      and new.status = 'in_Design'
    )
    and not (
      new.quote_id is distinct from old.quote_id
      and new.quote_id is not null
      and new.status = 'in_Quote'
    )
    and not is_return_event then
    event_type := case
      when new.status = 'cancelled' then 'order_cancelled'
      when new.status = 'in_Completed' then 'order_completed'
      else 'order_updated'
    end;

    perform public.notify_many(
      array_remove(designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers, null),
      event_type,
      case
        when new.status = 'cancelled' then 'Orden cancelada'
        when new.status = 'in_Completed' then 'Orden completada'
        when new.status = 'in_Design' then 'Orden en diseno'
        when new.status = 'in_Quote' then 'Orden en cotizacion'
        when new.status = 'in_Production' then 'Orden en produccion'
        when new.status = 'in_Termination' then 'Orden lista para entrega'
        when new.status = 'in_Delivered' then 'Orden entregada'
        else 'Estado actualizado'
      end,
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' cambio de ' ||
        coalesce(old.status, 'sin estado') || ' a ' || coalesce(new.status, 'sin estado') || '.',
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

drop policy if exists orders_select_by_role on public.orders;
drop policy if exists orders_insert_by_seller on public.orders;
drop policy if exists orders_update_by_role on public.orders;
drop policy if exists orders_delete_admin on public.orders;

create policy orders_select_by_role
  on public.orders for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('in_Production', 'in_Termination', 'in_Delivered', 'in_Completed')
    )
  );

create policy orders_insert_by_seller
  on public.orders for insert
  to authenticated
  with check (
    public.current_profile_is_admin()
    or auth.uid() = created_by
    or auth.uid() = seller_id
  );

create policy orders_update_by_role
  on public.orders for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('in_Production', 'in_Termination', 'in_Delivered', 'in_Completed')
    )
  )
  with check (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('in_Production', 'in_Termination', 'in_Delivered', 'in_Completed')
    )
  );

create policy orders_delete_admin
  on public.orders for delete
  to authenticated
  using (public.current_profile_is_admin());

drop policy if exists order_events_select_by_order_access on public.order_events;
create policy order_events_select_by_order_access
  on public.order_events for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
          or (
            public.current_profile_role() = 'printer'
            and o.status in ('in_Production', 'in_Termination', 'in_Delivered', 'in_Completed')
          )
        )
    )
  );

delete from public.notifications n
where
  coalesce(n.metadata->>'event_kind', '') = 'status_changed'
  and coalesce(n.metadata->>'previous_status', '') = 'in_Quote'
  and coalesce(n.metadata->>'status', '') in ('in_Design', 'Pending');
