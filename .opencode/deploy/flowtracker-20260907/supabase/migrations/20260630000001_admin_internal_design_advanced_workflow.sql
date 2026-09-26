-- Generalize Configuración avanzada for INTERNAL_DESING and EXTERNAL_DESING
-- Internal flow: Pending → in_Design → in_Quote → in_Production → ...
-- Returns: in_Quote → in_Design, in_Design → Pending
-- External flow unchanged

-- 1) Private completeness validation shared by action blockers
create or replace function public._admin_validate_order_completeness(
  p_order_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
  blockers jsonb := '[]'::jsonb;
  file_count integer := 0;
  invalid_file_count integer := 0;
begin
  select * into order_row from public.orders where id = p_order_id;

  if nullif(trim(coalesce(order_row.preview_image, '')), '') is null then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'missing_preview',
      'message', 'Falta la imagen de la orden de trabajo.'
    ));
  end if;

  select
    count(*),
    count(*) filter (
      where opf.production_area_code is null
        or nullif(trim(coalesce(opf.public_label, '')), '') is null
        or pa.code is null
    )
  into file_count, invalid_file_count
  from public.order_production_files opf
  left join public.production_areas pa
    on pa.code = opf.production_area_code
   and pa.is_active = true
  where opf.order_id = p_order_id;

  if file_count = 0 then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'missing_work_files',
      'message', 'Debe existir al menos un archivo de trabajo.'
    ));
  elsif invalid_file_count > 0 then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'unclassified_files',
      'message', 'Todos los archivos deben tener nombre y un area de produccion activa.'
    ));
  end if;

  return blockers;
end;
$$;

revoke all on function public._admin_validate_order_completeness(uuid, text) from public, anon, authenticated;

-- 2) Update action labels for internal design actions
create or replace function public.admin_intervention_action_label(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'assign_seller' then 'Reasignada por Administracion'
    when 'route_sales' then 'Movida a Ventas por Administracion'
    when 'route_design' then 'Movida a Diseno por Administracion'
    when 'route_quote' then 'Movida a Caja por Administracion'
    when 'route_production' then 'Movida a Produccion por Administracion'
    when 'reassign_production' then 'Produccion reasignada por Administracion'
    when 'route_completed' then 'Asignada a Entrega por Administracion'
    when 'production_file_status' then 'Archivo actualizado por Administracion'
    when 'production_file_reopened' then 'Archivo reabierto por Administracion'
    when 'set_designer_assignee' then 'Disenador reasignado por Administracion'
    when 'return_to_design' then 'Regresada a Diseno por Administracion'
    when 'design_assets_updated' then 'Archivos de diseno actualizados por Administracion'
    when 'mark_delivered' then 'Marcada como Entregada por Administracion'
    when 'return_to_completed' then 'Regresada a Completado por Administracion'
    else 'Intervenida por Administracion'
  end
$$;

-- 3) Recipient determination for internal design actions
create or replace function public.admin_internal_intervention_recipient_ids(
  p_old public.orders,
  p_new public.orders,
  p_action text
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with candidates(user_id) as (
    select case
      when p_action in ('route_design', 'set_designer_assignee')
        then coalesce(p_old.designer_id, p_new.designer_id)
    end
    union all select case
      when p_action = 'route_design' then p_new.designer_id
    end
    union all select case
      when p_action = 'route_design' then coalesce(p_old.seller_id, p_old.created_by)
    end
    union all select case
      when p_action = 'route_quote' then coalesce(p_old.designer_id, p_old.created_by)
    end
    union all select case
      when p_action = 'route_quote' then coalesce(p_new.quote_id, p_new.quote_id)
    end
    union all select case
      when p_action = 'route_quote' then coalesce(p_old.seller_id, p_old.created_by)
    end
    union all select case
      when p_action = 'set_quote_assignee' then p_old.quote_id
    end
    union all select case
      when p_action = 'set_quote_assignee' then p_new.quote_id
    end
    union all select case
      when p_action = 'route_sales' then coalesce(p_old.designer_id, p_old.quote_id)
    end
    union all select case
      when p_action = 'route_sales' then coalesce(p_new.seller_id, p_new.created_by)
    end
    union all select case
      when p_action = 'route_sales' then p_old.quote_id
    end
    union all select case
      when p_action = 'return_to_design' then p_old.quote_id
    end
    union all select case
      when p_action = 'return_to_design' then coalesce(p_new.designer_id, p_new.designer_id)
    end
    union all select case
      when p_action = 'assign_seller' then coalesce(p_old.seller_id, p_old.created_by)
    end
    union all select case
      when p_action = 'assign_seller' then coalesce(p_new.seller_id, p_new.created_by)
    end
    union all select case
      when p_action = 'route_production' then coalesce(p_old.quote_id, p_old.designer_id)
    end
  )
  select coalesce(array_agg(distinct p.id), array[]::uuid[])
  from candidates c
  join public.profiles p on p.id = c.user_id
  where c.user_id is not null
    and coalesce(p.employment_status, true) = true
$$;

revoke all on function public.admin_internal_intervention_recipient_ids(public.orders, public.orders, text) from public, anon, authenticated;

-- 4) Update record_admin_intervention to handle internal design actions
create or replace function public.record_admin_intervention(
  p_old public.orders,
  p_new public.orders,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_started_at timestamptz,
  p_custom_changed_fields jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  event_id uuid;
  recipients uuid[];
  changed_fields jsonb;
  event_label text := public.admin_external_intervention_label(p_old, p_new, p_action);
  reason_label text := public.admin_intervention_reason_label(p_reason_category);
begin
  if p_custom_changed_fields is null then
    select coalesce(jsonb_agg(
      item || jsonb_build_object(
        'old_value', public.admin_order_edit_value(p_old, item->>'field'),
        'new_value', public.admin_order_edit_value(p_new, item->>'field')
      )
    ), '[]'::jsonb)
    into changed_fields
    from jsonb_array_elements(public.order_business_changed_fields(p_old, p_new)) as changed(item);
  else
    changed_fields := p_custom_changed_fields;
  end if;

  delete from public.order_events
  where order_id = p_new.id
    and public.order_events.actor_id is not distinct from v_actor_id
    and event_type in ('order_updated', 'admin_edited_order')
    and created_at >= p_started_at;

  insert into public.order_events (
    order_id, actor_id, event_type, old_status, new_status,
    old_payment_status, new_payment_status, changes
  ) values (
    p_new.id, v_actor_id, 'admin_intervention', p_old.status, p_new.status,
    p_old.payment_status, p_new.payment_status,
    jsonb_build_object(
      'source_module', 'admin', 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_fields', changed_fields,
      'old', to_jsonb(p_old), 'new', to_jsonb(p_new)
    )
  ) returning id into event_id;

  if p_old.order_design_type = 'EXTERNAL_DESING'
    and p_action in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production') then
    select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
      into recipients
    from unnest(public.admin_external_intervention_recipient_ids(p_old, p_new, p_action)) recipient_id
    where recipient_id is distinct from v_actor_id;
  elsif p_old.order_design_type = 'INTERNAL_DESING'
    and p_action in ('route_design', 'set_designer_assignee', 'route_quote', 'set_quote_assignee', 'route_sales', 'return_to_design', 'route_production', 'assign_seller') then
    select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
      into recipients
    from unnest(public.admin_internal_intervention_recipient_ids(p_old, p_new, p_action)) recipient_id
    where recipient_id is distinct from v_actor_id;
  else
    select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
      into recipients
    from unnest(public.order_realtime_recipient_ids(p_old, p_new)) recipient_id
    where recipient_id is not null and recipient_id is distinct from v_actor_id;
  end if;

  perform public.create_order_event_reviews(
    event_id, p_new.id, recipients, event_label, 'admin', 'admin_intervention',
    changed_fields,
    event_label || '. Motivo: ' || reason_label || '. ' || p_reason_detail,
    jsonb_build_object(
      'actor_id', v_actor_id, 'actor_role', 'admin', 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_at', now()
    )
  );

  perform public.notify_many(
    recipients, 'order_updated', event_label,
    'La orden #' || left(p_new.id::text, 8) || ' fue actualizada por Administracion. Motivo: ' || reason_label || '.',
    p_new.id,
    jsonb_build_object(
      'event_kind', 'admin_intervention', 'event_id', event_id,
      'actor_id', v_actor_id, 'action', p_action,
      'reason_category', p_reason_category, 'reason_label', reason_label,
      'reason_detail', p_reason_detail, 'changed_fields', changed_fields,
      'deep_link', '/dashboard?order=' || p_new.id::text
    )
  );
  return event_id;
end;
$$;

revoke all on function public.record_admin_intervention(public.orders, public.orders, text, text, text, timestamptz, jsonb) from public, anon, authenticated;

-- 5) Update admin_external_intervention_label for new internal labels
create or replace function public.admin_external_intervention_label(
  p_old public.orders,
  p_new public.orders,
  p_action text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_action = 'set_quote_assignee' and p_old.quote_id is null and p_new.quote_id is not null
      then 'Asignada a Caja por Administracion'
    when p_action = 'set_quote_assignee' and p_old.quote_id is not null and p_new.quote_id is null
      then 'Asignacion de Caja retirada por Administracion'
    when p_action = 'set_quote_assignee'
      then 'Caja reasignada por Administracion'
    when p_action = 'mark_delivered'
      then 'Marcada como Entregada por Administracion'
    when p_action = 'return_to_completed'
      then 'Regresada a Completado por Administracion'
    when p_action = 'route_design'
      then 'Enviada a Diseno por Administracion'
    when p_action = 'set_designer_assignee'
      then 'Diseno reasignado por Administracion'
    when p_action = 'return_to_design'
      then 'Regresada a Diseno por Administracion'
    when p_action = 'design_assets_updated'
      then 'Archivos de diseno actualizados por Administracion'
    when p_action = 'assign_seller'
      then 'Vendedor reasignado por Administracion'
    else public.admin_intervention_action_label(p_action)
  end
$$;

-- 6) Fix admin_force_file_status: guard recalculate to only run in production
create or replace function public.admin_force_file_status(
  p_file_id uuid,
  p_new_status text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_delivery_id uuid default null
)
returns public.order_production_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  file_row public.order_production_files;
  old_file_status text;
  old_order public.orders;
  new_order public.orders;
  other_incomplete integer;
  action_key text := 'production_file_status';
  started_at timestamptz := clock_timestamp();
  changed_fields jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede cambiar archivos de Produccion.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into file_row
  from public.order_production_files
  where id = p_file_id
  for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  old_file_status := file_row.status;
  if p_expected_updated_at is null or file_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'El archivo cambio mientras lo editabas. Actualiza e intenta nuevamente.';
  end if;

  if p_new_status not in ('pending', 'in_production', 'in_termination', 'completed') then
    raise exception 'El estado seleccionado no es valido.';
  end if;

  if p_new_status = old_file_status then
    raise exception 'El archivo ya se encuentra en el estado seleccionado.';
  end if;

  select * into old_order from public.orders where id = file_row.order_id for update;
  if old_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se pueden modificar archivos de una orden terminal.';
  end if;

  perform set_config('app.admin_intervention_context', 'production_file_status', true);

  if old_file_status = 'completed' and p_new_status in ('pending', 'in_production', 'in_termination') then
    action_key := 'production_file_reopened';
  end if;

  if p_new_status = 'completed' then
    select count(*) into other_incomplete
    from public.order_production_files
    where order_id = file_row.order_id and id <> file_row.id and status <> 'completed';
    if other_incomplete = 0 then
      if not exists (
        select 1 from public.profiles p
        where p.id = p_delivery_id and p.role = 'delivery'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.';
      end if;
      update public.orders set delivery_id = p_delivery_id where id = old_order.id;
    end if;
  end if;

  update public.order_production_files
  set status = p_new_status, updated_by = actor_id, updated_at = now()
  where id = p_file_id
  returning * into file_row;

  if old_order.status in ('in_Production', 'in_Termination', 'in_Completed') then
    perform public.recalculate_order_production_status(file_row.order_id);
  end if;

  update public.orders
  set last_admin_intervention_at = now(),
      last_admin_intervention_by = actor_id,
      last_admin_intervention_kind = action_key,
      updated_at = now()
  where id = file_row.order_id
  returning * into new_order;

  changed_fields := jsonb_build_array(jsonb_build_object(
    'field', 'production_file_status',
    'label', coalesce(file_row.public_label, 'Archivo de Produccion'),
    'old_value', case old_file_status
      when 'pending' then 'Pendiente'
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'new_value', case p_new_status
      when 'pending' then 'Pendiente'
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'area', file_row.production_area_code
  ));

  perform public.record_admin_intervention(
    old_order, new_order, action_key, p_reason_category,
    trim(p_reason_detail), started_at, changed_fields
  );
  return file_row;
end;
$$;

revoke all on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;

-- 7) Update admin_order_action_blockers for internal design actions
create or replace function public.admin_order_action_blockers(
  p_order_id uuid,
  p_action text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  order_row public.orders;
  blockers jsonb := '[]'::jsonb;
  file_count integer := 0;
  invalid_file_count integer := 0;
  completed_count integer := 0;
  completeness_blockers jsonb;
begin
  select * into order_row
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_array(jsonb_build_object('code', 'order_not_found', 'message', 'La orden no existe.'));
  end if;

  if p_action not in (
    'assign_seller', 'route_sales', 'route_design', 'route_quote',
    'route_production', 'reassign_production', 'route_completed',
    'return_to_quote', 'mark_delivered', 'return_to_completed',
    'set_designer_assignee', 'return_to_design'
  ) then
    return jsonb_build_array(jsonb_build_object('code', 'invalid_action', 'message', 'La accion administrativa no es valida.'));
  end if;

  if order_row.status in ('cancelled', 'in_Delivered')
    and p_action <> 'return_to_completed' then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'terminal_order',
      'message', 'Las ordenes canceladas o entregadas no pueden reabrirse.'
    ));
  end if;

  if p_action in ('assign_seller') and order_row.status in ('cancelled', 'in_Delivered') then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'terminal_order',
      'message', 'No se puede reasignar vendedor en ordenes canceladas o entregadas.'
    ));
  end if;

  -- assign_seller guard: must have target user
  if p_action = 'assign_seller' and order_row.status not in ('cancelled', 'in_Delivered') then
    -- assign_seller is always available (target user validated at execution time)
    null;
  end if;

  if p_action = 'route_design' and order_row.order_design_type = 'EXTERNAL_DESING' then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'external_design',
      'message', 'Una orden de diseno externo no puede enviarse a Diseno.'
    ));
  end if;

  if p_action = 'route_design' and order_row.order_design_type = 'INTERNAL_DESING' then
    if order_row.status <> 'Pending' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_pending',
        'message', 'La orden debe estar en Ventas para enviarse a Diseno.'
      ));
    end if;
  end if;

  if p_action = 'set_designer_assignee' and order_row.status <> 'in_Design' then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_in_design',
      'message', 'La orden debe estar en Diseno para gestionar su responsable.'
    ));
  end if;

  if p_action = 'return_to_design' then
    if order_row.order_design_type = 'EXTERNAL_DESING' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'external_design',
        'message', 'Una orden de diseno externo no puede regresar a Diseno.'
      ));
    end if;
    if order_row.status <> 'in_Quote' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_quote',
        'message', 'La orden debe estar en Caja para regresar a Diseno.'
      ));
    end if;
  end if;

  if p_action = 'route_quote' and order_row.order_design_type = 'INTERNAL_DESING' then
    if order_row.status <> 'in_Design' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_eligible',
        'message', 'La orden debe estar en Diseno para enviarse a Caja.'
      ));
    end if;
  end if;

  if p_action in ('route_quote', 'route_production', 'reassign_production', 'route_completed') then
    select
      count(*),
      count(*) filter (
        where opf.production_area_code is null
          or nullif(trim(coalesce(opf.public_label, '')), '') is null
          or pa.code is null
      ),
      count(*) filter (where opf.status = 'completed')
    into file_count, invalid_file_count, completed_count
    from public.order_production_files opf
    left join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    where opf.order_id = p_order_id;
  end if;

  if p_action in ('route_quote', 'route_production') then
    if nullif(trim(coalesce(order_row.preview_image, '')), '') is null then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_preview',
        'message', 'Falta la imagen de la orden de trabajo.'
      ));
    end if;
    if file_count = 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'missing_work_files',
        'message', 'Debe existir al menos un archivo de trabajo.'
      ));
    elsif invalid_file_count > 0 then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'unclassified_files',
        'message', 'Todos los archivos deben tener nombre y un area de produccion activa.'
      ));
    end if;
  end if;

  if p_action = 'route_production' then
    if order_row.status <> 'in_Quote' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_quote',
        'message', 'La orden debe encontrarse en Caja antes de entrar a Produccion.'
      ));
    end if;
    if order_row.payment_status not in ('pagado', 'parcial', 'credito') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'invalid_payment',
        'message', 'Produccion requiere pago pagado, parcial o aprobado a credito.'
      ));
    end if;
    if file_count > 0 and completed_count = file_count then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'all_files_completed',
        'message', 'Todos los archivos siguen completados. Reabre al menos uno antes de volver a Produccion.'
      ));
    end if;
  end if;

  if p_action = 'reassign_production'
    and order_row.status not in ('in_Production', 'in_Termination') then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_in_production',
      'message', 'Solo se puede reasignar Produccion mientras la orden esta en Produccion o Terminacion.'
    ));
  end if;

  if p_action = 'return_to_quote'
    and order_row.status not in ('in_Production', 'in_Termination') then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_in_production',
      'message', 'La orden debe estar en Produccion o Terminacion para regresar a Caja.'
    ));
  end if;

  if p_action = 'route_completed' then
    if order_row.status not in ('in_Production', 'in_Termination', 'in_Completed') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_production',
        'message', 'La orden debe estar en Produccion o Terminacion para enviarse a Entrega.'
      ));
    end if;
    if file_count = 0 or completed_count <> file_count then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'incomplete_files',
        'message', 'Todos los archivos de Produccion deben estar completados.'
      ));
    end if;
    if order_row.payment_status not in ('pagado', 'credito') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'delivery_payment',
        'message', 'Entrega requiere pago total o credito aprobado.'
      ));
    end if;
  end if;

  if p_action = 'route_sales' then
    if order_row.order_design_type = 'INTERNAL_DESING'
      and order_row.status not in ('in_Quote', 'in_Design') then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_quote_or_design',
        'message', 'La orden debe estar en Caja o Diseno para regresar a Ventas.'
      ));
    end if;
    if order_row.order_design_type = 'EXTERNAL_DESING'
      and order_row.status <> 'in_Quote' then
      blockers := blockers || jsonb_build_array(jsonb_build_object(
        'code', 'not_in_quote',
        'message', 'La orden debe estar en Caja para regresar a Ventas.'
      ));
    end if;
  end if;

  return blockers;
end;
$$;

revoke all on function public.admin_order_action_blockers(uuid, text) from public, anon, authenticated;

-- 8) Create unified get_admin_order_actions
create or replace function public.get_admin_order_actions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  order_row public.orders;
  design_type text;
  quote_blockers jsonb;
  design_blockers jsonb;
  production_blockers jsonb;
  return_blockers jsonb;
  reassign_blockers jsonb;
  actions jsonb := '[]'::jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede consultar estas acciones.';
  end if;

  select * into order_row from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  design_type := order_row.order_design_type;

  if order_row.status not in ('cancelled', 'in_Delivered')
     and not (order_row.order_design_type = 'INTERNAL_DESING' and order_row.status = 'Pending') then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'manage_files', 'label', 'Gestionar archivos')
    );
  end if;

  if order_row.status not in ('cancelled', 'in_Delivered') then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'assign_seller', 'label', 'Reasignar vendedor', 'target_role', 'seller')
    );
  end if;

  if order_row.status = 'Pending' then
    if design_type = 'INTERNAL_DESING' then
      design_blockers := public.admin_order_action_blockers(p_order_id, 'route_design');
      if jsonb_array_length(design_blockers) = 0 then
        actions := actions || jsonb_build_array(jsonb_build_object(
          'key', 'route_design', 'label', 'Enviar a Diseno', 'target_role', 'designer'
        ));
      end if;
    else
      quote_blockers := public.admin_order_action_blockers(p_order_id, 'route_quote');
      if jsonb_array_length(quote_blockers) = 0 then
        actions := actions || jsonb_build_array(jsonb_build_object(
          'key', 'route_quote', 'label', 'Enviar a Caja', 'target_role', 'quote'
        ));
      end if;
    end if;
  elsif order_row.status = 'in_Design' then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'set_designer_assignee', 'label', 'Gestionar disenador', 'target_role', 'designer')
    );
    quote_blockers := public.admin_order_action_blockers(p_order_id, 'route_quote');
    if jsonb_array_length(quote_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_quote', 'label', 'Enviar a Caja', 'target_role', 'quote'
      ));
    end if;
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'route_sales', 'label', 'Regresar orden a Ventas', 'target_role', 'seller')
    );
  elsif order_row.status = 'in_Quote' then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'set_quote_assignee', 'label', 'Gestionar usuario de Caja', 'target_role', 'quote'),
      jsonb_build_object('key', 'register_payment', 'label', 'Registrar pago')
    );
    if design_type = 'INTERNAL_DESING' then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'return_to_design', 'label', 'Regresar a Diseno'
      ));
    else
      actions := actions || jsonb_build_array(
        jsonb_build_object('key', 'route_sales', 'label', 'Regresar orden a Ventas', 'target_role', 'seller')
      );
    end if;
    production_blockers := public.admin_order_action_blockers(p_order_id, 'route_production');
    if jsonb_array_length(production_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_production', 'label', 'Enviar a Produccion',
        'requires_area_assignments', true
      ));
    end if;
  elsif order_row.status in ('in_Production', 'in_Termination') then
    return_blockers := public.admin_order_action_blockers(p_order_id, 'return_to_quote');
    if jsonb_array_length(return_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'return_to_quote', 'label', 'Regresar a Caja'
      ));
    end if;
    reassign_blockers := public.admin_order_action_blockers(p_order_id, 'reassign_production');
    if jsonb_array_length(reassign_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'reassign_production', 'label', 'Reasignar Produccion',
        'requires_area_assignments', true
      ));
    end if;
  elsif order_row.status = 'in_Completed' then
    actions := actions || jsonb_build_array(jsonb_build_object(
      'key', 'mark_delivered', 'label', 'Marcar como entregado'
    ));
  elsif order_row.status = 'in_Delivered' then
    actions := actions || jsonb_build_array(jsonb_build_object(
      'key', 'return_to_completed', 'label', 'Volver a Completado'
    ));
  end if;

  return jsonb_build_object(
    'order_id', order_row.id,
    'expected_updated_at', order_row.updated_at,
    'design_type', design_type,
    'actions', actions
  );
end;
$$;

revoke all on function public.get_admin_order_actions(uuid) from public, anon;
grant execute on function public.get_admin_order_actions(uuid) to authenticated;

-- 9) Create unified admin_manage_order
create or replace function public.admin_manage_order(
  p_order_id uuid,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_target_user_id uuid default null,
  p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_order public.orders;
  new_order public.orders;
  started_at timestamptz := clock_timestamp();
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;
  if p_action not in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production',
    'return_to_quote', 'reassign_production', 'mark_delivered', 'return_to_completed',
    'route_design', 'set_designer_assignee', 'return_to_design', 'assign_seller') then
    raise exception 'La accion no es valida.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  -- route_design: Pending → in_Design (internal only)
  if p_action = 'route_design' then
    if old_order.order_design_type <> 'INTERNAL_DESING' then
      raise exception 'Esta accion solo aplica a Diseno Interno.';
    end if;
    if old_order.status <> 'Pending' then
      raise exception 'Solo una orden en Ventas puede enviarse a Diseno.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and p.role = 'designer'
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un disenador activo.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Design',
           designer_id = p_target_user_id,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- set_designer_assignee: change/remove designer in in_Design
  if p_action = 'set_designer_assignee' then
    if old_order.status <> 'in_Design' then
      raise exception 'La orden debe encontrarse en Diseno para gestionar su responsable.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and p.role = 'designer'
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un disenador activo.';
    end if;
    if old_order.designer_id is not distinct from p_target_user_id then
      raise exception 'La asignacion de Diseno no ha cambiado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set designer_id = p_target_user_id,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- return_to_design: in_Quote → in_Design (internal only, preserve designer & quote_id)
  if p_action = 'return_to_design' then
    if old_order.order_design_type <> 'INTERNAL_DESING' then
      raise exception 'Esta accion solo aplica a Diseno Interno.';
    end if;
    if old_order.status <> 'in_Quote' then
      raise exception 'La orden debe estar en Caja para regresar a Diseno.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Design',
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- assign_seller: update seller_id in allowed states
  if p_action = 'assign_seller' then
    if old_order.status in ('cancelled', 'in_Delivered') then
      raise exception 'No se puede reasignar vendedor en ordenes canceladas o entregadas.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and p.role = 'seller'
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un vendedor activo.';
    end if;
    if coalesce(old_order.seller_id, old_order.created_by) is not distinct from p_target_user_id then
      raise exception 'La asignacion de Ventas no ha cambiado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set seller_id = p_target_user_id,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- set_quote_assignee: change/remove cashier
  if p_action = 'set_quote_assignee' then
    if old_order.status <> 'in_Quote' then
      raise exception 'La orden debe encontrarse en Caja para gestionar su responsable.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and p.role = 'quote'
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un usuario de Caja activo.';
    end if;
    if old_order.quote_id is not distinct from p_target_user_id then
      raise exception 'La asignacion de Caja no ha cambiado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set quote_id = p_target_user_id,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- route_sales: in_Quote → Pending (external) or in_Design → Pending (internal)
  if p_action = 'route_sales' then
    if old_order.order_design_type = 'INTERNAL_DESING' then
      if old_order.status <> 'in_Design' then
        raise exception 'La orden debe estar en Diseno para regresar a Ventas.';
      end if;
      if p_target_user_id is null then
        raise exception 'Debes seleccionar un vendedor.';
      end if;
      if not exists (
        select 1 from public.profiles p
        where p.id = p_target_user_id and p.role = 'seller'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un vendedor activo.';
      end if;
      perform set_config('app.admin_intervention_context', p_action, true);
      update public.orders
         set status = 'Pending',
             seller_id = p_target_user_id,
             designer_id = null,
             quote_id = null,
             last_admin_intervention_at = now(),
             last_admin_intervention_by = actor_id,
             last_admin_intervention_kind = p_action,
             updated_at = now()
       where id = p_order_id
       returning * into new_order;
      perform public.record_admin_intervention(
        old_order, new_order, p_action, p_reason_category,
        trim(p_reason_detail), started_at, null
      );
      return new_order;
    end if;
    -- For external: same as before (via intervene_order)
    return public.admin_intervene_order(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
    );
  end if;

  -- route_quote: Pending → in_Quote (external) or in_Design → in_Quote (internal)
  if p_action = 'route_quote' then
    if old_order.order_design_type = 'INTERNAL_DESING' then
      if old_order.status <> 'in_Design' then
        raise exception 'La orden debe estar en Diseno para enviarse a Caja.';
      end if;
      if p_target_user_id is not null and not exists (
        select 1 from public.profiles p
        where p.id = p_target_user_id and p.role = 'quote'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un usuario de Caja activo.';
      end if;
      perform set_config('app.admin_intervention_context', p_action, true);
      update public.orders
         set status = 'in_Quote',
             quote_id = coalesce(p_target_user_id, old_order.quote_id),
             last_admin_intervention_at = now(),
             last_admin_intervention_by = actor_id,
             last_admin_intervention_kind = p_action,
             updated_at = now()
       where id = p_order_id
       returning * into new_order;
      perform public.record_admin_intervention(
        old_order, new_order, p_action, p_reason_category,
        trim(p_reason_detail), started_at, null
      );
      return new_order;
    end if;
    -- For external: same as before (via intervene_order)
    return public.admin_intervene_order(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
    );
  end if;

  -- return_to_quote: Production/Termination → in_Quote
  if p_action = 'return_to_quote' then
    if old_order.status not in ('in_Production', 'in_Termination') then
      raise exception 'La orden debe estar en Produccion o Terminacion para regresar a Caja.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Quote',
           production_id = null,
           delivery_id = null,
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- reassign_production: delegate to generic function
  if p_action = 'reassign_production' then
    return public.admin_intervene_order(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
    );
  end if;

  -- mark_delivered: in_Completed → in_Delivered
  if p_action = 'mark_delivered' then
    if old_order.status <> 'in_Completed' then
      raise exception 'La orden debe estar en Completado para marcar como entregada.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Delivered',
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- return_to_completed: in_Delivered → in_Completed
  if p_action = 'return_to_completed' then
    if old_order.status <> 'in_Delivered' then
      raise exception 'La orden debe estar en Entregado para volver a Completado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Completed',
           last_admin_intervention_at = now(),
           last_admin_intervention_by = actor_id,
           last_admin_intervention_kind = p_action,
           updated_at = now()
     where id = p_order_id
     returning * into new_order;
    perform public.record_admin_intervention(
      old_order, new_order, p_action, p_reason_category,
      trim(p_reason_detail), started_at, null
    );
    return new_order;
  end if;

  -- route_production: delegate to generic function
  return public.admin_intervene_order(
    p_order_id, p_action, p_reason_category, trim(p_reason_detail),
    p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;

-- 10) Create admin_save_design_assets (admin-only)
create or replace function public.admin_save_design_assets(
  p_order_id uuid,
  p_files jsonb,
  p_preview_url text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  old_order public.orders;
  new_order public.orders;
  started_at timestamptz := clock_timestamp();
  file_record jsonb;
  v_file_url text;
  v_label text;
  v_area_code text;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede guardar archivos de diseno.';
  end if;
  if p_files is null or jsonb_array_length(p_files) = 0 then
    raise exception 'Debe proporcionar al menos un archivo.';
  end if;
  if nullif(trim(coalesce(p_preview_url, '')), '') is null then
    raise exception 'Debe proporcionar una imagen de preview.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if old_order.order_design_type <> 'INTERNAL_DESING' then
    raise exception 'Esta accion solo aplica a Diseno Interno.';
  end if;
  if old_order.status <> 'in_Design' then
    raise exception 'Solo se pueden guardar archivos de diseno cuando la orden esta en Diseno.';
  end if;
  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  for file_record in select * from jsonb_array_elements(p_files)
  loop
    v_file_url := file_record->>'url';
    v_label := file_record->>'label';
    v_area_code := file_record->>'production_area_code';
    if nullif(trim(coalesce(v_label, '')), '') is null then
      raise exception 'Cada archivo debe tener una etiqueta visible.';
    end if;
    if v_area_code is null then
      raise exception 'Cada archivo debe tener un area de produccion.';
    end if;
    if not exists (
      select 1 from public.production_areas where code = v_area_code and is_active = true
    ) then
      raise exception 'El area de produccion % no es valida.', v_area_code;
    end if;
    insert into public.order_production_files (order_id, url, public_label, production_area_code, status, updated_by)
    values (p_order_id, v_file_url, v_label, v_area_code, 'pending', actor_id);
  end loop;

  update public.orders
     set preview_image = p_preview_url,
         last_admin_intervention_at = now(),
         last_admin_intervention_by = actor_id,
         last_admin_intervention_kind = 'design_assets_updated',
         updated_at = now()
   where id = p_order_id
   returning * into new_order;

  perform public.record_admin_intervention(
    old_order, new_order, 'design_assets_updated', p_reason_category,
    trim(p_reason_detail), started_at, null
  );
  return new_order;
end;
$$;

revoke all on function public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_save_design_assets(uuid, jsonb, text, text, text, timestamptz) to authenticated;

-- 11) Update get_admin_external_order_actions as backward-compatible wrapper
create or replace function public.get_admin_external_order_actions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  filtered_actions jsonb := '[]'::jsonb;
  action_item jsonb;
begin
  result := public.get_admin_order_actions(p_order_id);
  if result->>'design_type' <> 'EXTERNAL_DESING' then
    raise exception 'Esta configuracion solo aplica a ordenes de Diseno Externo.';
  end if;
  for action_item in select * from jsonb_array_elements(result->'actions')
  loop
    if action_item->>'key' in ('manage_files', 'route_quote', 'set_quote_assignee', 'route_sales', 'route_production', 'register_payment',
      'return_to_quote', 'reassign_production', 'mark_delivered', 'return_to_completed') then
      filtered_actions := filtered_actions || jsonb_build_array(action_item);
    end if;
  end loop;
  return jsonb_build_object(
    'order_id', result->>'order_id',
    'expected_updated_at', result->>'expected_updated_at',
    'actions', filtered_actions
  );
end;
$$;

revoke all on function public.get_admin_external_order_actions(uuid) from public, anon;
grant execute on function public.get_admin_external_order_actions(uuid) to authenticated;

-- 12) Update admin_manage_external_order as backward-compatible wrapper
create or replace function public.admin_manage_external_order(
  p_order_id uuid,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_target_user_id uuid default null,
  p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_order public.orders;
begin
  select * into old_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  if old_order.order_design_type <> 'EXTERNAL_DESING' then
    raise exception 'Esta accion solo aplica a ordenes de Diseno Externo.';
  end if;
  if p_action not in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production',
    'return_to_quote', 'reassign_production', 'mark_delivered', 'return_to_completed') then
    raise exception 'La accion no pertenece al flujo de Diseno Externo.';
  end if;
  return public.admin_manage_order(
    p_order_id, p_action, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_target_user_id, p_area_assignments
  );
end;
$$;

revoke all on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
