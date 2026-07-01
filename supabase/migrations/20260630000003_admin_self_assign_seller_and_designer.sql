-- Migration: Allow admin to assign themselves as seller or designer
-- Changes:
--   1. Dynamic label for assign_seller ("Asignar" vs "Reasignar")
--   2. assign_seller allows admin caller as target
--   3. route_design allows admin caller as designer target

-- +--------------------------------------------------------------------+
-- | 1) Update get_admin_order_actions — dynamic assign_seller label    |
-- +--------------------------------------------------------------------+
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
      jsonb_build_object(
        'key', 'assign_seller',
        'label', case when order_row.seller_id is null then 'Asignar orden a vendedor' else 'Reasignar vendedor' end,
        'target_role', 'seller'
      )
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

-- +--------------------------------------------------------------------+
-- | 2) Update admin_manage_order — allow admin as seller/designer      |
-- +--------------------------------------------------------------------+
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
  v_completeness_blockers jsonb;
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

  -- Validate completeness for actions that advance the order from in_Quote onwards
  if p_action in ('route_quote', 'route_production', 'mark_delivered') then
    v_completeness_blockers := public._admin_validate_order_completeness(p_order_id, p_action);
    if jsonb_array_length(v_completeness_blockers) > 0 then
      raise exception '%', (v_completeness_blockers->0->>'message');
    end if;
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
      where p.id = p_target_user_id and (p.role = 'designer' or p.id = actor_id)
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un disenador activo o asignate como responsable.';
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

  -- set_designer_assignee: assign/change designer for internal orders already in Design
  if p_action = 'set_designer_assignee' then
    if old_order.order_design_type <> 'INTERNAL_DESING' then
      raise exception 'Esta accion solo aplica a Diseno Interno.';
    end if;
    if old_order.status not in ('Pending', 'in_Design') then
      raise exception 'Solo se puede cambiar el disenador cuando la orden esta en Ventas o Diseno.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and (p.role = 'designer' or p.id = actor_id)
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un disenador activo.';
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

  -- return_to_design: return from in_Quote back to in_Design
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

  -- assign_seller: allowed in all non-terminal states for all design types
  if p_action = 'assign_seller' then
    if old_order.status in ('cancelled', 'in_Delivered') then
      raise exception 'No se puede asignar vendedor a una orden cancelada o entregada.';
    end if;
    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id and (p.role = 'seller' or p.id = actor_id)
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un vendedor activo o asignate como responsable.';
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

  -- route_quote: in_Design → in_Quote (internal) or delegate to external function
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

  -- set_quote_assignee: assign/change quote user
  if p_action = 'set_quote_assignee' then
    if old_order.status not in ('Pending', 'in_Design', 'in_Quote') then
      raise exception 'Solo se puede cambiar responsable de Caja en Ventas, Diseno o Caja.';
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

  -- route_sales: in_Quote → Pending (back to sales)
  if p_action = 'route_sales' then
    if old_order.status <> 'in_Quote' then
      raise exception 'La orden debe estar en Caja para devolverse a Ventas.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'Pending',
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

  -- reassign_production: change production area assignments
  if p_action = 'reassign_production' then
    perform public.admin_reassign_production_assignments(
      p_order_id, p_area_assignments, p_action, p_reason_category,
      trim(p_reason_detail), p_expected_updated_at
    );
    select * into new_order from public.orders where id = p_order_id;
    return new_order;
  end if;

  -- mark_delivered: in_Completed → in_Delivered
  if p_action = 'mark_delivered' then
    if old_order.status <> 'in_Completed' then
      raise exception 'La orden debe estar en Lista para entrega.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Delivered',
           delivery_id = coalesce(p_target_user_id, old_order.delivery_id),
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
      raise exception 'La orden debe estar en Entregado para devolverse a Completado.';
    end if;
    perform set_config('app.admin_intervention_context', p_action, true);
    update public.orders
       set status = 'in_Completed',
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

  -- route_production: delegate to generic
  if p_action = 'route_production' then
    return public.admin_intervene_order(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, p_target_user_id, coalesce(p_area_assignments, '{}'::jsonb)
    );
  end if;

  raise exception 'La accion "%" no fue manejada.', p_action;
end;
$$;

revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
