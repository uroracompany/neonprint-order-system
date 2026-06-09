-- Corrective hardening for production area assignment writes.
-- The client calls only this RPC; direct INSERT/UPDATE access to
-- order_production_assignments is intentionally not exposed.

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
  v_assigned_user_id uuid;
  v_order public.orders;
  classified_count integer;
  unclassified_count integer;
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

  for v_area in
    select code, label, producer_role
    from public.production_areas
    where is_active = true
    order by code
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
        updated_at = now();
  end loop;

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

revoke all on function public.send_order_to_production(uuid, jsonb) from public, anon;
grant execute on function public.send_order_to_production(uuid, jsonb) to authenticated;

revoke all on table public.order_production_assignments from public, anon;
revoke insert, update, delete on table public.order_production_assignments from authenticated;
grant select on table public.order_production_assignments to authenticated;

alter table public.order_production_assignments enable row level security;

drop policy if exists order_production_assignments_select_assigned on public.order_production_assignments;
drop policy if exists order_production_assignments_insert_sender on public.order_production_assignments;
drop policy if exists order_production_assignments_update_sender on public.order_production_assignments;

create policy order_production_assignments_select_assigned
  on public.order_production_assignments for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or assigned_to = auth.uid()
  );

drop function if exists public.debug_auth_uid();
