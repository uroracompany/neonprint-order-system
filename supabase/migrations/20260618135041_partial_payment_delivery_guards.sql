-- Payment partial guards across production, delivery, archive and cancellation.

create or replace function public.check_production_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_Production' and old.status is distinct from new.status then
    if coalesce(new.payment_status, old.payment_status) not in ('pagado', 'parcial') then
      raise exception 'La orden no puede pasar a produccion hasta que el pago sea confirmado o marcado como parcial.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_production_eligibility on public.orders;
create trigger trg_check_production_eligibility
  before update of status on public.orders
  for each row
  execute function public.check_production_eligibility();

create or replace function public.enforce_partial_payment_order_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.current_profile_is_admin();
begin
  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status not in ('parcial', 'pagado') then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status = 'pagado'
    and nullif(trim(coalesce(new.invoice_payment, '')), '') is null then
    raise exception 'Debes adjuntar la factura para marcar como pagado.';
  end if;

  if new.payment_status = 'parcial' then
    new.invoice_payment := null;
  end if;

  if new.status = 'in_Delivered' and new.payment_status is distinct from 'pagado' then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada.';
  end if;

  if new.payment_status = 'parcial' and new.status = 'cancelled' then
    raise exception 'No se puede cancelar una orden con pago parcial.';
  end if;

  if new.payment_status = 'pagado'
    and new.status = 'cancelled'
    and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden pagada.';
  end if;

  if new.payment_status = 'parcial' and (
    coalesce(new.is_archived, false)
    or coalesce(new.is_archived_admin, false)
    or coalesce(new.is_archived_designer, false)
    or coalesce(new.is_archived_quote, false)
    or coalesce(new.is_archived_delivery, false)
    or coalesce(new.is_archived_production, false)
  ) then
    raise exception 'No se puede archivar una orden con pago parcial.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_partial_payment_order_guards() from public;
revoke all on function public.enforce_partial_payment_order_guards() from anon;
revoke all on function public.enforce_partial_payment_order_guards() from authenticated;

drop trigger if exists trg_enforce_partial_payment_order_guards on public.orders;
create trigger trg_enforce_partial_payment_order_guards
  before insert or update on public.orders
  for each row
  execute function public.enforce_partial_payment_order_guards();

create or replace function public.set_production_order_archive(
  p_order_id uuid,
  p_archived boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_order_status text;
  v_payment_status text;
  v_should_archive boolean := coalesce(p_archived, false);
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null then
    raise exception 'Tu perfil no esta activo.';
  end if;

  if not exists (
    select 1
    from public.production_areas pa
    where pa.producer_role = v_profile_role
      and pa.is_active = true
  ) then
    raise exception 'Tu rol no pertenece a un area de produccion.';
  end if;

  select o.status, o.payment_status
  into v_order_status, v_payment_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if not public.producer_can_access_order(p_order_id) then
    raise exception 'No tienes acceso a esta orden de produccion.';
  end if;

  if v_should_archive then
    if v_payment_status = 'parcial' then
      raise exception 'No se puede archivar una orden con pago parcial.';
    end if;

    if v_order_status not in ('in_Completed', 'in_Delivered') then
      raise exception 'Solo puedes archivar ordenes completadas o entregadas.';
    end if;

    insert into public.order_production_user_archives (order_id, user_id, archived_at)
    values (p_order_id, v_uid, now())
    on conflict (order_id, user_id) do update
    set archived_at = excluded.archived_at;

    return true;
  end if;

  delete from public.order_production_user_archives
  where order_id = p_order_id
    and user_id = v_uid;

  return false;
end;
$$;

revoke all on function public.set_production_order_archive(uuid, boolean) from public, anon;
grant execute on function public.set_production_order_archive(uuid, boolean) to authenticated;

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
  delivery_users uuid[] := public.get_role_user_ids('delivery');
  production_users uuid[] := array[]::uuid[];
  base_recipients uuid[];
  affected_recipients uuid[];
  designer_recipients uuid[] := array[]::uuid[];
  quote_recipients uuid[] := array[]::uuid[];
  actor_confirmation_recipients uuid[] := array[]::uuid[];
  meta jsonb;
  event_type text := 'order_updated';
  is_return_event boolean := false;
  has_seller_edit_changes boolean := false;
  has_seller_edit_for_quote boolean := false;
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

  select coalesce(array_agg(distinct opa.assigned_to), array[]::uuid[])
  into production_users
  from public.order_production_assignments opa
  where opa.order_id = new.id;

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

    has_seller_edit_for_quote := actor_role = 'seller'
      and new.quote_id is not null
      and new.quote_id is not distinct from old.quote_id
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
      case
        when new.payment_status = 'parcial' then 'La orden de ' || coalesce(new.client_name, 'cliente') || ' fue marcada con pago parcial.'
        when new.payment_status = 'pagado' then 'La orden de ' || coalesce(new.client_name, 'cliente') || ' fue marcada como pagada.'
        else 'Pago de la orden de ' || coalesce(new.client_name, 'cliente') || ' actualizado a ' || new.payment_status || '.'
      end,
      new.id,
      meta || jsonb_build_object('event_kind', 'payment_updated', 'previous_payment_status', old.payment_status)
    );

    if old.payment_status = 'parcial'
      and new.payment_status = 'pagado'
      and new.status in ('in_Completed', 'in_Delivered') then
      perform public.notify_many(
        array_remove(delivery_users, actor_id),
        'order_updated',
        'Orden pagada',
        'La orden de ' || coalesce(new.client_name, 'cliente') || ' ya fue pagada y ahora puede ser entregada.',
        new.id,
        meta || jsonb_build_object('event_kind', 'partial_payment_completed', 'previous_payment_status', old.payment_status)
      );
    end if;
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

  if has_seller_edit_for_quote then
    perform public.notify_many(
      array_remove(array[new.quote_id], actor_id),
      'order_updated',
      'Orden editada por seller',
      'La orden #' || substring(new.id::text, 1, 8) ||
        ' ha sido editada. Por favor, revisa los cambios pendientes.',
      new.id,
      meta || jsonb_build_object('event_kind', 'seller_edited_quote_order')
    );
  end if;

  if new.status is distinct from old.status
    and new.status = 'cancelled'
    and not is_return_event then
    affected_recipients := array_remove(
      array_remove(designer_recipients || quote_recipients || array[new.seller_id, new.created_by] || admins || printers || production_users, null),
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
    and new.status not in ('cancelled', 'in_Production')
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
      array_remove(designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers || production_users, null),
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
