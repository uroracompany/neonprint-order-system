-- Dynamic production routing by participating areas.
-- Only areas with classified files are assigned, notified and exposed to producers.

create or replace function public.send_order_to_production(
  p_order_id uuid,
  p_area_assignments jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_area_assignments jsonb := coalesce(p_area_assignments, '{}'::jsonb);
  v_area record;
  v_extra_area text;
  v_assigned_user_id uuid;
  v_assignment_id uuid;
  v_order public.orders;
  classified_count integer;
  unclassified_count integer;
  participating_area_count integer;
  updated_order public.orders;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
  end if;

  if jsonb_typeof(v_area_assignments) <> 'object' then
    raise exception 'Las asignaciones de produccion son invalidas.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if v_profile_role <> 'admin' and v_order.quote_id is distinct from v_uid then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  if v_order.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered', 'cancelled') then
    raise exception 'Esta orden no esta en un estado valido para enviarse a produccion.';
  end if;

  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is null)
  into classified_count, unclassified_count
  from public.order_production_files
  where order_id = p_order_id;

  if coalesce(classified_count, 0) = 0 then
    raise exception 'La orden no tiene archivos clasificados para produccion.';
  end if;

  if coalesce(unclassified_count, 0) > 0 then
    raise exception 'Todos los archivos deben tener tipo de produccion antes de enviar.';
  end if;

  if exists (
    select 1
    from public.order_production_files opf
    left join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    where opf.order_id = p_order_id
      and opf.production_area_code is not null
      and pa.code is null
  ) then
    raise exception 'La orden contiene archivos asociados a un area de produccion inactiva o inexistente.';
  end if;

  select count(distinct opf.production_area_code)
  into participating_area_count
  from public.order_production_files opf
  join public.production_areas pa
    on pa.code = opf.production_area_code
   and pa.is_active = true
  where opf.order_id = p_order_id
    and opf.production_area_code is not null;

  if coalesce(participating_area_count, 0) = 0 then
    raise exception 'La orden no tiene areas activas para produccion.';
  end if;

  select key
  into v_extra_area
  from jsonb_object_keys(v_area_assignments) as provided(key)
  where not exists (
    select 1
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    where opf.order_id = p_order_id
      and opf.production_area_code = provided.key
  )
  limit 1;

  if v_extra_area is not null then
    raise exception 'El area % no participa en esta orden.', v_extra_area;
  end if;

  for v_area in
    select distinct pa.code, pa.label, pa.producer_role
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    where opf.order_id = p_order_id
      and opf.production_area_code is not null
    order by pa.code
  loop
    if not (v_area_assignments ? v_area.code) then
      raise exception 'Debes asignar un responsable para el area %.', v_area.label;
    end if;

    begin
      v_assigned_user_id := nullif(trim(v_area_assignments ->> v_area.code), '')::uuid;
    exception when invalid_text_representation then
      raise exception 'El responsable seleccionado para el area % no es valido.', v_area.label;
    end;

    if v_assigned_user_id is null then
      raise exception 'Debes asignar un responsable para el area %.', v_area.label;
    end if;

    if not exists (
      select 1
      from public.profiles p
      where p.id = v_assigned_user_id
        and p.role = v_area.producer_role
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'El responsable seleccionado para el area % no esta activo o no pertenece a esa area.', v_area.label;
    end if;

    insert into public.order_production_assignments (
      order_id,
      production_area_code,
      assigned_to,
      assigned_by
    )
    values (
      p_order_id,
      v_area.code,
      v_assigned_user_id,
      v_uid
    )
    on conflict (order_id, production_area_code) do update
    set assigned_to = excluded.assigned_to,
        assigned_by = excluded.assigned_by,
        updated_at = now()
    returning id into v_assignment_id;

    perform public.notify_many(
      array[v_assigned_user_id],
      'order_assigned',
      'Nueva orden de produccion',
      'La orden #' || substring(p_order_id::text, 1, 8) ||
        ' de ' || coalesce(v_order.client_name, 'cliente') ||
        ' fue asignada a tu area de ' || coalesce(v_area.label, v_area.code) || '.',
      p_order_id,
      jsonb_build_object(
        'event_kind', 'production_assigned',
        'production_area_code', v_area.code,
        'production_area_label', v_area.label,
        'assignment_id', v_assignment_id,
        'assigned_by', v_uid,
        'status', 'in_Production',
        'client_name', v_order.client_name
      )
    );
  end loop;

  delete from public.order_production_assignments opa
  where opa.order_id = p_order_id
    and not exists (
      select 1
      from public.order_production_files opf
      where opf.order_id = opa.order_id
        and opf.production_area_code = opa.production_area_code
    );

  perform public.notify_many(
    array[v_uid],
    'order_assigned',
    'Orden asignada a produccion',
    'La orden #' || substring(p_order_id::text, 1, 8) ||
      ' ha sido asignada a Produccion exitosamente.',
    p_order_id,
    jsonb_build_object(
      'event_kind', 'production_assignment_confirmation',
      'status', 'in_Production',
      'client_name', v_order.client_name
    )
  );

  update public.order_production_files opf
  set status = case when opf.status = 'pending' then 'in_production' else opf.status end,
      started_at = case
        when opf.status = 'pending' then coalesce(opf.started_at, now())
        else opf.started_at
      end,
      assigned_to = opa.assigned_to,
      updated_by = v_uid
  from public.order_production_assignments opa
  where opf.order_id = p_order_id
    and opa.order_id = opf.order_id
    and opa.production_area_code = opf.production_area_code;

  update public.orders
  set status = 'in_Production',
      production_id = null,
      updated_at = now()
  where id = p_order_id
  returning * into updated_order;

  return updated_order;
end;
$$;

revoke all on function public.send_order_to_production(uuid, jsonb) from public;
revoke all on function public.send_order_to_production(uuid, jsonb) from anon;
grant execute on function public.send_order_to_production(uuid, jsonb) to authenticated;

delete from public.order_production_assignments opa
using public.orders o
where o.id = opa.order_id
  and o.status in ('in_Production', 'in_Termination')
  and not exists (
    select 1
    from public.order_production_files opf
    where opf.order_id = opa.order_id
      and opf.production_area_code = opa.production_area_code
  );

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.handle_order_change_notification()'::regprocedure)
  into v_definition;

  v_definition := regexp_replace(
    v_definition,
    E'\\n\\s*printers uuid\\[\\] := public\\.get_role_user_ids\\(''printer''\\);',
    '',
    'g'
  );
  v_definition := replace(v_definition, ' || admins || printers || production_users', ' || admins || production_users');
  v_definition := replace(v_definition, ' || admins || printers, null)', ' || admins, null)');

  if v_definition like '%|| printers%' or v_definition like '%get_role_user_ids(''printer'')%' then
    raise exception 'Could not remove generic printer recipients from handle_order_change_notification';
  end if;

  execute v_definition;
end;
$$;

revoke all on function public.handle_order_change_notification() from public;
revoke all on function public.handle_order_change_notification() from anon;
revoke all on function public.handle_order_change_notification() from authenticated;
