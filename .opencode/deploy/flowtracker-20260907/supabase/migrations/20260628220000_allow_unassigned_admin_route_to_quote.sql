-- Administration may move an order to Caja without assigning a quote user.
-- Every other administrative movement keeps its existing assignee requirement.

create or replace function public.admin_intervene_order(
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
  blockers jsonb;
  expected_role text;
  area_row record;
  assigned_user_id uuid;
  started_at timestamptz := clock_timestamp();
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;

  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into old_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then raise exception 'La orden no existe.'; end if;

  if p_expected_updated_at is null or old_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  blockers := public.admin_order_action_blockers(p_order_id, p_action);
  if jsonb_array_length(blockers) > 0 then
    raise exception '%', blockers->0->>'message';
  end if;

  expected_role := case
    when p_action in ('assign_seller', 'route_sales') then 'seller'
    when p_action = 'route_design' then 'designer'
    when p_action = 'route_quote' then 'quote'
    when p_action = 'route_completed' then 'delivery'
    else null
  end;

  if expected_role is not null then
    if p_target_user_id is null and p_action <> 'route_quote' then
      raise exception 'Selecciona un responsable activo del departamento correcto.';
    end if;

    if p_target_user_id is not null and not exists (
      select 1 from public.profiles p
      where p.id = p_target_user_id
        and p.role = expected_role
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'Selecciona un responsable activo del departamento correcto.';
    end if;
  end if;

  perform set_config('app.admin_intervention_context', p_action, true);

  if p_action = 'assign_seller' then
    update public.orders set seller_id = p_target_user_id, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_sales' then
    update public.orders
    set status = 'Pending', seller_id = p_target_user_id,
        designer_id = null, quote_id = null, delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_design' then
    update public.orders
    set status = 'in_Design', designer_id = p_target_user_id,
        quote_id = null, delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_quote' then
    update public.orders
    set status = 'in_Quote', quote_id = p_target_user_id,
        delivery_id = null, updated_at = now()
    where id = p_order_id;
  elsif p_action = 'route_production' then
    perform public.send_order_to_production(p_order_id, coalesce(p_area_assignments, '{}'::jsonb));
  elsif p_action = 'reassign_production' then
    if jsonb_typeof(coalesce(p_area_assignments, '{}'::jsonb)) <> 'object' then
      raise exception 'Las asignaciones de Produccion no son validas.';
    end if;
    for area_row in
      select distinct pa.code, pa.label, pa.producer_role
      from public.order_production_files opf
      join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active = true
      where opf.order_id = p_order_id
    loop
      begin
        assigned_user_id := nullif(trim(p_area_assignments->>area_row.code), '')::uuid;
      exception when invalid_text_representation then
        raise exception 'El responsable de % no es valido.', area_row.label;
      end;
      if assigned_user_id is null or not exists (
        select 1 from public.profiles p
        where p.id = assigned_user_id and p.role = area_row.producer_role
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Debes asignar un responsable activo para %.', area_row.label;
      end if;
      insert into public.order_production_assignments(order_id, production_area_code, assigned_to, assigned_by)
      values (p_order_id, area_row.code, assigned_user_id, actor_id)
      on conflict (order_id, production_area_code) do update
      set assigned_to = excluded.assigned_to,
          assigned_by = excluded.assigned_by,
          updated_at = now();
      update public.order_production_files
      set assigned_to = assigned_user_id, updated_by = actor_id
      where order_id = p_order_id and production_area_code = area_row.code;
    end loop;
    update public.orders set updated_at = now() where id = p_order_id;
  elsif p_action = 'route_completed' then
    update public.orders
    set status = 'in_Completed', delivery_id = p_target_user_id, updated_at = now()
    where id = p_order_id;
  end if;

  update public.orders
  set last_admin_intervention_at = now(),
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
end;
$$;

revoke all on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb)
  from public, anon;
grant execute on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb)
  to authenticated;
