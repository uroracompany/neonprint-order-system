-- Close the direct-RPC authorization gap identified during the security audit:
-- only an assigned designer may send an INTERNAL_DESING order to Caja, and
-- admin-archived orders remain immutable through this helper.
create or replace function public.semi_admin_send_design_to_quote(
  p_order_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_new public.orders%rowtype;
  v_role text;
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_order.order_design_type is distinct from 'INTERNAL_DESING' then
    raise exception 'Solo órdenes de Diseño Interno pueden enviarse a Caja desde Diseño.';
  end if;
  if coalesce(v_order.is_archived_admin, false) then
    raise exception 'La orden está archivada por Administración.';
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
  perform pg_catalog.set_config('app.neonprint_order_command', 'on', true);
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

-- Expose the existing, catalog-authorized Design -> Caja action in the
-- Semi-Admin batch row catalog. The singular catalog remains the source of
-- truth for readiness, responsibility, and current action availability.
create or replace function public.semi_admin_get_orders_command_catalog(p_order_ids uuid[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
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
      and not coalesce(v_order.is_archived, false)
      and not coalesce(v_order.is_archived_admin, false)
      and v_order.operational_status is distinct from 'blocked'
      and (
        (v_order.status in ('Pending', 'pending')
          and (
            (v_order.order_design_type = 'INTERNAL_DESING'
              and action.value->>'key' = 'send_to_designer'
              and (v_order.seller_id = v_actor or v_order.created_by = v_actor or v_order.designer_id = v_actor))
            or (v_order.order_design_type = 'EXTERNAL_DESING'
              and action.value->>'key' = 'send_to_quote'
              and (v_order.seller_id = v_actor or v_order.created_by = v_actor))
          ))
        or (v_order.status in ('in_Design', 'In_Design')
          and v_order.order_design_type = 'INTERNAL_DESING'
          and v_order.designer_id = v_actor
          and action.value->>'key' = 'send_design_to_quote')
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

notify pgrst, 'reload schema';
