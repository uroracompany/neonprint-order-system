-- Semi-Admin may choose only active, non-deleted Caja profiles as the
-- responsible user for the quote stage. Other stage role rules are unchanged.

create or replace function public.semi_admin_transition_order(
  p_order_id uuid,
  p_action text,
  p_target_user_id uuid default null,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders;
  v_new public.orders;
  v_target_role text;
begin
  if p_action not in ('send_to_designer', 'send_to_quote') then
    raise exception 'Acción de orden no permitida para Semi-Administración.';
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada.';
  end if;
  if v_old.status not in ('Pending', 'pending') then
    raise exception 'La orden debe estar en Ventas antes de asignar su siguiente etapa.';
  end if;

  select role into v_target_role
  from public.profiles
  where id = p_target_user_id and coalesce(employment_status, true) and deleted_at is null;

  if p_action = 'send_to_designer'
     and v_target_role is distinct from 'designer'
     and v_target_role is distinct from 'semi_admin' then
    raise exception 'Selecciona un Diseñador o Semi-Administrador activo.';
  end if;
  if p_action = 'send_to_quote'
     and v_old.order_design_type is distinct from 'EXTERNAL_DESING' then
    raise exception 'Solo órdenes de Diseño Externo pueden enviarse a Caja directamente desde Ventas.';
  end if;
  if p_action = 'send_to_quote'
     and not public.semi_admin_is_order_routing_responsible(p_order_id, v_actor) then
    raise exception 'Solo el responsable Semi-Admin de Ventas puede enviar esta orden externa a Caja.';
  end if;
  if p_action = 'send_to_quote' and v_target_role is distinct from 'quote' then
    raise exception 'Selecciona un usuario de Caja activo para un diseño externo.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    status = case when p_action = 'send_to_designer' then 'in_Design' else 'in_Quote' end,
    designer_id = case when p_action = 'send_to_designer' then p_target_user_id else designer_id end,
    quote_id = case when p_action = 'send_to_quote' then p_target_user_id else quote_id end,
    updated_at = now(),
    updated_by = v_actor
  where id = p_order_id returning * into v_new;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (
    p_order_id,
    v_actor,
    'semi_admin_' || p_action,
    v_old.status,
    v_new.status,
    jsonb_build_object('target_user_id', p_target_user_id)
  );
  return v_new;
end;
$$;

-- This is an implementation helper. Semi-Admin calls it only through the
-- SECURITY DEFINER command gateway, which is the authenticated entry point.
revoke all on function public.semi_admin_transition_order(uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated;

create or replace function public.semi_admin_send_design_to_quote(
  p_order_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_new public.orders%rowtype;
  v_role text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada.';
  end if;
  if not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then
    raise exception 'Asígnate como responsable de Diseño antes de avanzar la orden.';
  end if;

  select role into v_role
  from public.profiles
  where id = p_quote_id
    and coalesce(employment_status, true)
    and deleted_at is null;
  if v_role is distinct from 'quote' then
    raise exception 'Selecciona un responsable activo de Caja.';
  end if;

  perform public.assert_order_ready_for_quote(p_order_id);
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Quote',
      quote_id = p_quote_id,
      return_reason = null,
      returned_to_designer_at = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_new;

  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (
    p_order_id,
    v_actor,
    'semi_admin_send_design_to_quote',
    v_order.status,
    v_new.status,
    jsonb_build_object('quote_id', p_quote_id, 'asset_validation', 'passed')
  );
  return v_new;
end;
$$;

revoke all on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.semi_admin_assign_stage_responsibility(
  p_order_id uuid,
  p_stage text,
  p_assignee_id uuid,
  p_expected_updated_at timestamptz,
  p_production_area_code text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_assignee_role text;
  v_previous uuid;
  v_area text := nullif(trim(p_production_area_code), '');
begin
  if p_stage = 'production' then
    raise exception 'Semi-Administración no puede asignar ni reasignar responsables de Producción.';
  end if;
  if p_stage is null or p_stage not in ('design', 'quote', 'delivery') then
    raise exception 'Etapa inválida.';
  end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'La orden no está disponible para reasignación.';
  end if;

  select role into v_assignee_role
  from public.profiles
  where id = p_assignee_id and coalesce(employment_status, true) and deleted_at is null;
  if v_assignee_role is null then raise exception 'Selecciona un usuario activo.'; end if;

  if p_stage = 'design' then
    if v_order.status not in ('in_Design', 'In_Design') then
      raise exception 'La responsabilidad de Diseño solo se asigna durante Diseño.';
    end if;
    if v_assignee_role not in ('designer', 'semi_admin') then
      raise exception 'Diseño requiere un Diseñador o Semi-Administrador.';
    end if;
    if (
      (nullif(trim(coalesce(v_order.order_file_url, '')), '') is not null and trim(v_order.order_file_url) <> '[]')
      or nullif(trim(coalesce(v_order.preview_image, '')), '') is not null
      or exists (
        select 1 from public.order_files file
        where file.order_id = v_order.id and file.category in ('design', 'preview', 'reference')
          and file.status = 'uploaded' and file.deleted_at is null
      )
      or exists (select 1 from public.order_production_files file where file.order_id = v_order.id)
    ) then
      raise exception 'No se puede reasignar Diseño mientras la orden tenga archivos u Orden de Trabajo. Elimina todos los archivos antes de reasignar.';
    end if;
    v_previous := v_order.designer_id;
    update public.orders
    set designer_id = p_assignee_id, updated_by = v_actor, updated_at = now()
    where id = v_order.id returning * into v_order;
  elsif p_stage = 'quote' then
    if v_order.status <> 'in_Quote' then
      raise exception 'La responsabilidad de Caja solo se asigna durante Caja.';
    end if;
    if v_assignee_role is distinct from 'quote' then
      raise exception 'Caja requiere un usuario activo de Caja.';
    end if;
    v_previous := v_order.quote_id;
    update public.orders
    set quote_id = p_assignee_id, updated_by = v_actor, updated_at = now()
    where id = v_order.id returning * into v_order;
  else
    if v_order.status <> 'in_Completed' then
      raise exception 'La responsabilidad de Entrega solo se asigna cuando la orden está completada.';
    end if;
    if v_assignee_role not in ('delivery', 'semi_admin') then
      raise exception 'Entrega requiere un Delivery o Semi-Administrador.';
    end if;
    v_previous := v_order.delivery_id;
    update public.orders
    set delivery_id = p_assignee_id, updated_by = v_actor, updated_at = now()
    where id = v_order.id returning * into v_order;
  end if;

  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (
    v_order.id,
    v_actor,
    'semi_admin_stage_responsibility_changed',
    jsonb_build_object('stage', p_stage, 'production_area_code', v_area,
      'previous_responsible_id', v_previous, 'responsible_id', p_assignee_id,
      'self_assigned', p_assignee_id = v_actor)
  );
  perform public.notify_many(
    array_remove(array[p_assignee_id], v_actor),
    'order_assigned',
    'Responsabilidad de etapa asignada',
    'Se te asignó la responsabilidad de ' || case p_stage
      when 'design' then 'Diseño' when 'quote' then 'Caja' else 'Entrega' end || '.',
    v_order.id,
    jsonb_build_object('event_kind', 'stage_responsibility_assigned', 'stage', p_stage,
      'production_area_code', v_area, 'assigned_by', v_actor)
  );
  return v_order;
end;
$$;

revoke all on function public.semi_admin_assign_stage_responsibility(uuid, text, uuid, timestamptz, text)
  from public, anon, authenticated;

create or replace function public.semi_admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_quote_candidates jsonb;
  v_ready boolean;
begin
  v_catalog := public.semi_admin_get_order_command_catalog_before_cashier_routing(p_order_id);
  select * into v_order from public.orders where id = p_order_id;
  if not found then return v_catalog; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role) order by p.name), '[]'::jsonb)
  into v_quote_candidates
  from public.profiles p
  where p.role = 'quote'
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;

  v_catalog := jsonb_set(
    v_catalog,
    '{candidates}',
    case when jsonb_typeof(v_catalog->'candidates') = 'object'
      then v_catalog->'candidates' else '{}'::jsonb end,
    true
  );
  v_catalog := jsonb_set(v_catalog, '{candidates,quote}', v_quote_candidates, true);

  v_actions := coalesce(v_catalog->'actions', '[]'::jsonb);
  select coalesce(jsonb_agg(action.value), '[]'::jsonb) into v_actions
  from jsonb_array_elements(v_actions) action(value)
  where action.value->>'key' not in ('register_payment', 'set_payment', 'mark_credit', 'grant_credit', 'payment_operations', 'route_production');

  select exists (select 1 from public.order_production_files f where f.order_id = p_order_id)
    and not exists (
      select 1 from public.order_production_files f
      left join public.production_areas a on a.code = f.production_area_code and a.is_active = true
      where f.order_id = p_order_id and (a.code is null or coalesce(cardinality(f.material_names), 0) = 0
        or nullif(btrim(coalesce(f.termination_name, '')), '') is null)
    ) into v_ready;

  if not coalesce((v_catalog->>'locked')::boolean, false)
     and v_actor is not null
     and v_order.status = 'in_Quote'
     and v_order.payment_status in ('pagado', 'parcial', 'credito')
     and v_order.production_authorized_at is not null and v_order.production_authorized_by is not null
     and not coalesce(v_order.is_archived, false) and not coalesce(v_order.is_archived_admin, false)
     and not coalesce(v_order.is_archived_quote, false) and not coalesce(v_order.is_archived_designer, false)
     and not coalesce(v_order.is_archived_production, false) and not coalesce(v_order.is_archived_delivery, false)
     and v_order.operational_status is distinct from 'blocked'
     and v_ready
     and public.semi_admin_is_order_routing_responsible(p_order_id, v_actor) then
    v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'route_production', 'title', 'Enviar a Producción'));
  end if;
  v_catalog := jsonb_set(v_catalog, '{actions}', v_actions, true);
  return v_catalog;
end;
$$;

revoke all on function public.semi_admin_get_order_command_catalog(uuid) from public, anon;
grant execute on function public.semi_admin_get_order_command_catalog(uuid) to authenticated;

notify pgrst, 'reload schema';
