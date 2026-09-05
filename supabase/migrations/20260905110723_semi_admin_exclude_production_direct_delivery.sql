-- Semi-Administración may prepare a route from Caja, but never operates Production.

create or replace function public.semi_admin_can_operate_stage(
  p_order_id uuid,
  p_stage text,
  p_production_area_code text default null
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then return false; end if;
  if p_stage = 'design' then
    return v_order.status in ('in_Design', 'In_Design') and v_order.designer_id = v_actor;
  elsif p_stage = 'quote' then
    return v_order.status = 'in_Quote' and v_order.quote_id = v_actor;
  elsif p_stage = 'delivery' then
    return v_order.status = 'in_Completed' and v_order.delivery_id = v_actor;
  elsif p_stage = 'production' then
    return false;
  end if;
  return false;
end $$;

alter function public.semi_admin_get_order_command_catalog(uuid) rename to semi_admin_get_order_command_catalog_base;

create function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_catalog jsonb;
  v_actions jsonb;
  v_unavailable jsonb;
  v_payment_status text;
begin
  perform public.require_active_semi_admin_actor();
  v_catalog := public.semi_admin_get_order_command_catalog_base(p_order_id);
  if coalesce((v_catalog->>'locked')::boolean, false) then return v_catalog; end if;

  if v_catalog->>'active_stage' = 'production' then
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
      from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
      where action->>'key' not in ('stage_responsibility', 'reassign_production_file', 'manage_production');
    v_catalog := jsonb_set(v_catalog, '{actions}', v_actions, true);
    v_catalog := jsonb_set(v_catalog, '{can_operate_current_stage}', 'false'::jsonb, true);
    v_catalog := jsonb_set(v_catalog, '{unavailable_actions}', coalesce(v_catalog->'unavailable_actions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('key', 'production_operations', 'title', 'Producción', 'next_safe_step', 'Producción se gestiona exclusivamente por el operador asignado.')), true);
  elsif v_catalog->>'active_stage' = 'delivery' then
    select payment_status into v_payment_status from public.orders where id = p_order_id;
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_actions
      from jsonb_array_elements(coalesce(v_catalog->'actions', '[]'::jsonb)) action
      where action->>'key' <> 'mark_delivered';
    select coalesce(jsonb_agg(action), '[]'::jsonb) into v_unavailable
      from jsonb_array_elements(coalesce(v_catalog->'unavailable_actions', '[]'::jsonb)) action
      where action->>'key' <> 'delivery_operations';
    if v_payment_status in ('pagado', 'credito') then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'mark_delivered', 'title', 'Confirmar entrega'));
    else
      v_unavailable := v_unavailable || jsonb_build_array(jsonb_build_object('key', 'delivery_operations', 'title', 'Acciones de Entrega', 'next_safe_step', 'La orden debe estar pagada o a crédito antes de entregarse.'));
    end if;
    v_catalog := jsonb_set(v_catalog, '{actions}', v_actions, true);
    v_catalog := jsonb_set(v_catalog, '{unavailable_actions}', v_unavailable, true);
  end if;
  return v_catalog;
end $$;

alter function public.semi_admin_route_order_to_production_v2(uuid,jsonb,timestamptz) rename to semi_admin_route_order_to_production_v2_base;

create function public.semi_admin_route_order_to_production_v2(
  p_order_id uuid, p_area_assignments jsonb, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_area record;
  v_assignee uuid;
  v_role text;
begin
  for v_area in
    select distinct a.code, a.label, a.producer_role
    from public.order_production_files f
    join public.production_areas a on a.code = f.production_area_code and a.is_active
    where f.order_id = p_order_id
  loop
    begin v_assignee := nullif(p_area_assignments ->> v_area.code, '')::uuid;
    exception when invalid_text_representation then raise exception 'Responsable inválido para %.', v_area.label;
    end;
    select role into v_role from public.profiles
      where id = v_assignee and coalesce(employment_status, true) and deleted_at is null;
    if v_role is distinct from v_area.producer_role then
      raise exception 'Selecciona un operador activo para %.', v_area.label;
    end if;
  end loop;
  return public.semi_admin_route_order_to_production_v2_base(p_order_id, p_area_assignments, p_expected_updated_at);
end $$;

create or replace function public.semi_admin_mark_order_delivered(
  p_order_id uuid, p_delivery_note text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders;
  v_new public.orders;
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status <> 'in_Completed' or v_old.payment_status not in ('pagado', 'credito') then
    raise exception 'La orden no es elegible para entrega.';
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set status = 'in_Delivered', delivery_note = coalesce(nullif(trim(p_delivery_note), ''), delivery_note), updated_by = v_actor, updated_at = now()
    where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values (p_order_id, v_actor, 'semi_admin_order_delivered', v_old.status, v_new.status, jsonb_build_object('delivery_id', v_old.delivery_id, 'direct_delivery', true));
  return v_new;
end $$;

alter function public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) rename to semi_admin_execute_order_command_base;

create function public.semi_admin_execute_order_command(
  p_order_id uuid, p_action text, p_payload jsonb default '{}'::jsonb, p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_result public.orders;
begin
  if p_action in ('production_file_status', 'reassign_production_file')
    or (p_action = 'stage_responsibility' and p_payload->>'stage' = 'production') then
    raise exception 'Semi-Administración no puede gestionar Producción.';
  end if;
  if p_action = 'mark_delivered' then
    select public.semi_admin_mark_order_delivered(p_order_id, nullif(p_payload->>'delivery_note', ''), p_expected_updated_at) into v_result;
    return jsonb_build_object('order', to_jsonb(v_result));
  end if;
  return public.semi_admin_execute_order_command_base(p_order_id, p_action, p_payload, p_expected_updated_at);
end $$;

revoke all on function public.semi_admin_get_order_command_catalog_base(uuid), public.semi_admin_route_order_to_production_v2_base(uuid,jsonb,timestamptz), public.semi_admin_execute_order_command_base(uuid,text,jsonb,timestamptz), public.semi_admin_route_order_to_production_v2(uuid,jsonb,timestamptz), public.semi_admin_mark_order_delivered(uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid), public.semi_admin_execute_order_command(uuid,text,jsonb,timestamptz) to authenticated;

notify pgrst, 'reload schema';
