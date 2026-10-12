-- Allow the Semi-Admin who owns/created an internal Pending order to open
-- the existing designer assignment flow before designer_id is set.
-- Preserve eligibility for an order already assigned to this Semi-Admin.
create or replace function public.semi_admin_get_orders_command_catalog(p_order_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_catalog jsonb;
  v_actions jsonb;
  v_result jsonb := '{}'::jsonb;
begin
  if p_order_ids is null then
    raise exception 'La lista de órdenes es obligatoria.';
  end if;
  if cardinality(p_order_ids) > 100 then
    raise exception 'El lote de órdenes no puede exceder 100 IDs.';
  end if;
  if exists (select 1 from unnest(p_order_ids) requested(id) where requested.id is null) then
    raise exception 'La lista de órdenes contiene un ID inválido.';
  end if;
  if cardinality(p_order_ids) = 0 then return '{}'::jsonb; end if;

  for v_order_id in
    select distinct requested.id
    from unnest(p_order_ids) requested(id)
    order by requested.id
  loop
    select * into v_order
    from public.orders candidate
    where candidate.id = v_order_id
      and v_actor in (candidate.created_by, candidate.seller_id, candidate.designer_id,
                      candidate.quote_id, candidate.delivery_id);
    if not found then
      continue;
    end if;

    v_catalog := public.semi_admin_get_order_command_catalog(v_order.id);
    v_actions := coalesce(v_catalog->'actions', '[]'::jsonb);

    select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'key', action.value->'key',
        'title', action.value->'title'
      )) order by action.ordinality
    ), '[]'::jsonb)
    into v_actions
    from jsonb_array_elements(v_actions) with ordinality action(value, ordinality)
    where not coalesce((v_catalog->>'locked')::boolean, false)
      and not coalesce(v_order.is_archived_admin, false)
      and v_order.status in ('Pending', 'pending')
      and (
        (v_order.order_design_type = 'INTERNAL_DESING'
          and action.value->>'key' = 'send_to_designer'
          and (v_order.seller_id = v_actor or v_order.created_by = v_actor or v_order.designer_id = v_actor))
        or (v_order.order_design_type = 'EXTERNAL_DESING'
          and action.value->>'key' = 'send_to_quote'
          and (v_order.seller_id = v_actor or v_order.created_by = v_actor))
      );

    if jsonb_array_length(v_actions) > 0 then
      v_result := jsonb_set(v_result, array[v_order.id::text], jsonb_build_object(
        'order_id', v_order.id,
        'order_updated_at', v_order.updated_at,
        'actions', v_actions
      ), true);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.semi_admin_get_orders_command_catalog(uuid[]) from public, anon;
grant execute on function public.semi_admin_get_orders_command_catalog(uuid[]) to authenticated;

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
  if coalesce(v_old.is_archived, false)
     or coalesce(v_old.is_archived_admin, false)
     or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada.';
  end if;
  if v_old.status not in ('Pending', 'pending') then
    raise exception 'La orden debe estar en Ventas antes de asignar su siguiente etapa.';
  end if;

  if p_action = 'send_to_designer' then
    if v_old.order_design_type is distinct from 'INTERNAL_DESING' then
      raise exception 'Solo órdenes de Diseño Interno pueden enviarse a Diseño desde este flujo.';
    end if;
    if v_actor is distinct from v_old.seller_id
       and v_actor is distinct from v_old.created_by
       and v_actor is distinct from v_old.designer_id then
      raise exception 'Solo el vendedor, creador o diseñador Semi-Admin asignado puede enviar esta orden a Diseño.';
    end if;
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

revoke all on function public.semi_admin_transition_order(uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
