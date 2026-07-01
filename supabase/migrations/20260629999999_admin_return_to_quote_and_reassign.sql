-- Add return_to_quote and reassign_production actions to external admin workflow
-- return_to_quote: return order from Production/Termination back to Caja
-- reassign_production: reassign production area users

-- 1) Update admin_order_action_blockers to support return_to_quote
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
    'return_to_quote', 'mark_delivered', 'return_to_completed'
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

  if p_action = 'route_design' and order_row.order_design_type = 'EXTERNAL_DESING' then
    blockers := blockers || jsonb_build_array(jsonb_build_object(
      'code', 'external_design',
      'message', 'Una orden de diseno externo no puede enviarse a Diseno.'
    ));
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

  return blockers;
end;
$$;

-- 2) Update get_admin_external_order_actions to expose return_to_quote and reassign_production
create or replace function public.get_admin_external_order_actions(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  order_row public.orders;
  quote_blockers jsonb;
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
  if order_row.order_design_type <> 'EXTERNAL_DESING' then
    raise exception 'Esta configuracion solo aplica a ordenes de Diseno Externo.';
  end if;

  if order_row.status not in ('cancelled', 'in_Delivered') then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'manage_files', 'label', 'Gestionar archivos')
    );
  end if;

  if order_row.status = 'Pending' then
    quote_blockers := public.admin_order_action_blockers(p_order_id, 'route_quote');
    if jsonb_array_length(quote_blockers) = 0 then
      actions := actions || jsonb_build_array(jsonb_build_object(
        'key', 'route_quote', 'label', 'Enviar a Caja', 'target_role', 'quote'
      ));
    end if;
  elsif order_row.status = 'in_Quote' then
    actions := actions || jsonb_build_array(
      jsonb_build_object('key', 'set_quote_assignee', 'label', 'Gestionar usuario de Caja', 'target_role', 'quote'),
      jsonb_build_object('key', 'route_sales', 'label', 'Regresar orden a Ventas', 'target_role', 'seller'),
      jsonb_build_object('key', 'register_payment', 'label', 'Registrar pago')
    );
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
    'actions', actions
  );
end;
$$;

-- 3) Update admin_manage_external_order to support return_to_quote and reassign_production
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
  if p_action not in ('route_quote', 'set_quote_assignee', 'route_sales', 'route_production', 'return_to_quote', 'reassign_production', 'mark_delivered', 'return_to_completed') then
    raise exception 'La accion no pertenece al flujo de Diseno Externo.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if old_order.order_design_type <> 'EXTERNAL_DESING' then
    raise exception 'Esta accion solo aplica a ordenes de Diseno Externo.';
  end if;
  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

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

  if p_action = 'route_quote' and old_order.status <> 'Pending' then
    raise exception 'Solo una orden en Ventas puede enviarse a Caja desde este flujo.';
  end if;
  if p_action in ('route_sales', 'route_production') and old_order.status <> 'in_Quote' then
    raise exception 'La orden debe encontrarse en Caja para realizar esta accion.';
  end if;

  -- return_to_quote: return from Production/Termination to Caja, preserve file states
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

  -- reassign_production: delegate to the generic function
  if p_action = 'reassign_production' then
    return public.admin_intervene_order(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
    );
  end if;

  -- mark_delivered: move from in_Completed to in_Delivered
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

  -- return_to_completed: revert from in_Delivered back to in_Completed
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

  -- route_quote, route_sales, route_production: use generic function
  return public.admin_intervene_order(
    p_order_id, p_action, p_reason_category, trim(p_reason_detail),
    p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.admin_order_action_blockers(uuid, text) from public, anon, authenticated;
revoke all on function public.get_admin_external_order_actions(uuid) from public, anon;
revoke all on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.get_admin_external_order_actions(uuid) to authenticated;
grant execute on function public.admin_manage_external_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
