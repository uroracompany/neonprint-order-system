-- Keep the Semi-Admin Design -> Caja command out of row and detail catalogs
-- until the persisted work-order and design assets pass the same validator
-- used by the mutation. The mutation remains the final authority.

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated;

create or replace function private.semi_admin_order_ready_for_quote_catalog(
  p_order_id uuid
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  perform public.assert_order_ready_for_quote(p_order_id);
  return true;
exception when others then
  -- Catalogs are read-only UX projections: any validation failure or
  -- unexpected validator error must hide the action rather than break the list.
  return false;
end;
$$;

revoke all on function private.semi_admin_order_ready_for_quote_catalog(uuid)
  from public, anon, authenticated;

-- Preserve the current singular catalog behavior and permissions. Batch and
-- fallback catalogs already derive their actions from this function, so this
-- single gate keeps all projections consistent without duplicating readiness
-- rules in the API or client.
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
  select coalesce(jsonb_agg(action.value order by action.ordinality), '[]'::jsonb) into v_actions
  from jsonb_array_elements(v_actions) with ordinality action(value, ordinality)
  where action.value->>'key' not in ('register_payment', 'set_payment', 'mark_credit', 'grant_credit', 'payment_operations', 'route_production');

  if exists (
    select 1
    from jsonb_array_elements(v_actions) action(value)
    where action.value->>'key' = 'send_design_to_quote'
  ) and not private.semi_admin_order_ready_for_quote_catalog(p_order_id) then
    select coalesce(jsonb_agg(action.value order by action.ordinality), '[]'::jsonb)
    into v_actions
    from jsonb_array_elements(v_actions) with ordinality action(value, ordinality)
    where action.value->>'key' <> 'send_design_to_quote';
  end if;

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
