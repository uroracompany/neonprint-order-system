-- Read-only batch projection for the two direct order-assignment actions.
-- It does not grant or alter any order command permission.
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

    -- Expose only the matching effective command from the unitary catalog,
    -- and only for the design type and state supported by the current flow.
    select coalesce(jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'key', action.value->'key',
        'title', action.value->'title'
      )) order by action.ordinality
    ), '[]'::jsonb)
    into v_actions
    from jsonb_array_elements(v_actions) with ordinality action(value, ordinality)
    where not coalesce((v_catalog->>'locked')::boolean, false)
      and v_order.status in ('Pending', 'pending')
      and (
        (v_order.order_design_type = 'INTERNAL_DESING' and action.value->>'key' = 'send_to_designer')
        or (v_order.order_design_type = 'EXTERNAL_DESING' and action.value->>'key' = 'send_to_quote')
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
