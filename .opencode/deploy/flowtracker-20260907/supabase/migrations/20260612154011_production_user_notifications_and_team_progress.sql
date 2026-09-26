-- Production user notifications and read-only team progress summary.

alter table public.notifications
  add column if not exists deleted_at timestamptz;

create or replace function public.send_order_to_production(
  p_order_id uuid,
  p_area_assignments jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_area_assignments jsonb := coalesce(p_area_assignments, '{}'::jsonb);
  v_area record;
  v_assigned_user_id uuid;
  v_assignment_id uuid;
  v_order public.orders;
  classified_count integer;
  unclassified_count integer;
  updated_order public.orders;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
  end if;

  if jsonb_typeof(v_area_assignments) <> 'object' then
    raise exception 'Las asignaciones de produccion son invalidas.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if v_profile_role <> 'admin' and v_order.quote_id is distinct from v_uid then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  if v_order.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled') then
    raise exception 'Esta orden no esta en un estado valido para enviarse a produccion.';
  end if;

  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is null)
  into classified_count, unclassified_count
  from public.order_production_files
  where order_id = p_order_id;

  if coalesce(classified_count, 0) = 0 then
    raise exception 'La orden no tiene archivos clasificados para produccion.';
  end if;

  if coalesce(unclassified_count, 0) > 0 then
    raise exception 'Todos los archivos deben tener tipo de produccion antes de enviar.';
  end if;

  for v_area in
    select code, label, producer_role
    from public.production_areas
    where is_active = true
    order by code
  loop
    if not (v_area_assignments ? v_area.code) then
      raise exception 'Debes asignar un responsable para el area %.', v_area.label;
    end if;

    begin
      v_assigned_user_id := nullif(trim(v_area_assignments ->> v_area.code), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'El responsable seleccionado para el area % no es valido.', v_area.label;
    end;

    if v_assigned_user_id is null then
      raise exception 'Debes asignar un responsable para el area %.', v_area.label;
    end if;

    if not exists (
      select 1
      from public.profiles p
      where p.id = v_assigned_user_id
        and p.role = v_area.producer_role
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'El responsable seleccionado para el area % no esta activo o no pertenece a esa area.', v_area.label;
    end if;

    insert into public.order_production_assignments (
      order_id,
      production_area_code,
      assigned_to,
      assigned_by
    )
    values (
      p_order_id,
      v_area.code,
      v_assigned_user_id,
      v_uid
    )
    on conflict (order_id, production_area_code) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        updated_at = now()
    returning id into v_assignment_id;

    perform public.notify_many(
      array[v_assigned_user_id],
      'order_assigned',
      'Nueva orden de produccion',
      'La orden de ' || coalesce(v_order.client_name, 'cliente') ||
        ' fue asignada a tu bandeja de ' || coalesce(v_area.label, v_area.code) || '.',
      p_order_id,
      jsonb_build_object(
        'event_kind', 'production_assigned',
        'production_area_code', v_area.code,
        'production_area_label', v_area.label,
        'assignment_id', v_assignment_id,
        'assigned_by', v_uid,
        'status', 'in_Production',
        'client_name', v_order.client_name
      )
    );
  end loop;

  update public.order_production_files opf
  set status = case when opf.status = 'pending' then 'in_production' else opf.status end,
      started_at = case
        when opf.status = 'pending' then coalesce(opf.started_at, now())
        else opf.started_at
      end,
      assigned_to = opa.assigned_to,
      updated_by = v_uid
  from public.order_production_assignments opa
  where opf.order_id = p_order_id
    and opa.order_id = opf.order_id
    and opa.production_area_code = opf.production_area_code;

  update public.orders
  set status = 'in_Production',
      production_id = null,
      updated_at = now()
  where id = p_order_id
  returning * into updated_order;

  return updated_order;
end;
$$;

revoke all on function public.send_order_to_production(uuid, jsonb) from public;
revoke all on function public.send_order_to_production(uuid, jsonb) from anon;
grant execute on function public.send_order_to_production(uuid, jsonb) to authenticated;

create or replace function public.get_production_order_team(p_order_id uuid)
returns table (
  production_area_code text,
  production_area_label text,
  assigned_to uuid,
  assigned_name text,
  assigned_role text,
  total_files integer,
  pending_count integer,
  in_production_count integer,
  in_termination_count integer,
  completed_count integer,
  summary_status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if not (
    public.current_profile_is_admin()
    or v_uid = any(array[v_order.created_by, v_order.seller_id, v_order.designer_id, v_order.quote_id, v_order.delivery_id])
    or public.producer_can_access_order(p_order_id)
  ) then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  return query
  with file_summary as (
    select
      opf.production_area_code,
      count(*)::integer as total_files,
      count(*) filter (where coalesce(opf.status, 'pending') = 'pending')::integer as pending_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'in_production')::integer as in_production_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'in_termination')::integer as in_termination_count,
      count(*) filter (where coalesce(opf.status, 'pending') = 'completed')::integer as completed_count
    from public.order_production_files opf
    where opf.order_id = p_order_id
    group by opf.production_area_code
  )
  select
    opa.production_area_code::text,
    pa.label::text,
    opa.assigned_to,
    coalesce(nullif(p.name, ''), 'Usuario de produccion')::text,
    p.role::text,
    coalesce(fs.total_files, 0)::integer,
    coalesce(fs.pending_count, 0)::integer,
    coalesce(fs.in_production_count, 0)::integer,
    coalesce(fs.in_termination_count, 0)::integer,
    coalesce(fs.completed_count, 0)::integer,
    case
      when coalesce(fs.total_files, 0) = 0 then 'pending'
      when coalesce(fs.completed_count, 0) = coalesce(fs.total_files, 0) then 'completed'
      when coalesce(fs.in_termination_count, 0) > 0 then 'in_termination'
      when coalesce(fs.in_production_count, 0) > 0 then 'in_production'
      else 'pending'
    end::text,
    greatest(opa.updated_at, coalesce(max_files.max_updated_at, opa.updated_at))
  from public.order_production_assignments opa
  join public.production_areas pa
    on pa.code = opa.production_area_code
  join public.profiles p
    on p.id = opa.assigned_to
  left join file_summary fs
    on fs.production_area_code = opa.production_area_code
  left join lateral (
    select max(opf.updated_at) as max_updated_at
    from public.order_production_files opf
    where opf.order_id = opa.order_id
      and opf.production_area_code = opa.production_area_code
  ) max_files on true
  where opa.order_id = p_order_id
  order by pa.code;
end;
$$;

revoke all on function public.get_production_order_team(uuid) from public;
revoke all on function public.get_production_order_team(uuid) from anon;
grant execute on function public.get_production_order_team(uuid) to authenticated;

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
set deleted_at = coalesce(n.deleted_at, now())
where coalesce(n.metadata->>'event_kind', '') = 'status_changed'
  and coalesce(n.metadata->>'status', '') = 'in_Production'
  and exists (
    select 1
    from public.profiles p
    where p.id = n.user_id
      and p.role = 'printer'
  );
