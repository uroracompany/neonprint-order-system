-- Production order-area user assignments.
-- Producers can see production orders only when explicitly assigned to
-- their area for that order.

create table if not exists public.order_production_assignments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  production_area_code text not null references public.production_areas(code),
  assigned_to uuid not null references public.profiles(id),
  assigned_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_production_assignments_unique_order_area unique (order_id, production_area_code)
);

create index if not exists idx_order_production_assignments_assigned_to
  on public.order_production_assignments(assigned_to);
create index if not exists idx_order_production_assignments_order_id
  on public.order_production_assignments(order_id);

create or replace function public.touch_order_production_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_order_production_assignment on public.order_production_assignments;
create trigger trg_touch_order_production_assignment
  before update on public.order_production_assignments
  for each row
  execute function public.touch_order_production_assignment();

create or replace function public.current_user_assigned_to_production_area(
  p_order_id uuid,
  p_area_code text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
begin
  if v_uid is null or p_order_id is null or nullif(trim(coalesce(p_area_code, '')), '') is null then
    return false;
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null then
    return false;
  end if;

  return exists (
    select 1
    from public.order_production_assignments opa
    join public.production_areas pa
      on pa.code = opa.production_area_code
    where opa.order_id = p_order_id
      and opa.production_area_code = p_area_code
      and opa.assigned_to = v_uid
      and pa.producer_role = v_profile_role
      and pa.is_active = true
  );
end;
$$;

create or replace function public.producer_can_access_order(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
begin
  if v_uid is null or p_order_id is null then
    return false;
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_profile_role is null then
    return false;
  end if;

  return exists (
    select 1
    from public.order_production_assignments opa
    join public.production_areas pa
      on pa.code = opa.production_area_code
    where opa.order_id = p_order_id
      and opa.assigned_to = v_uid
      and pa.producer_role = v_profile_role
      and pa.is_active = true
  );
end;
$$;

drop function if exists public.send_order_to_production(uuid);

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

create or replace function public.update_production_file_status(p_file_id uuid, p_next_status text)
returns public.order_production_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  area_code text;
  file_row public.order_production_files;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_profile_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  select pa.code
  into area_code
  from public.production_areas pa
  where pa.producer_role = v_profile_role
    and pa.is_active = true
  limit 1;

  if area_code is null then
    raise exception 'Tu rol no pertenece a un area de produccion.';
  end if;

  if p_next_status not in ('in_termination', 'completed') then
    raise exception 'Transicion de estado no permitida.';
  end if;

  select opf.*
  into file_row
  from public.order_production_files opf
  where opf.id = p_file_id
    and opf.production_area_code = area_code
    and public.current_user_assigned_to_production_area(opf.order_id, area_code)
  for update;

  if not found then
    raise exception 'No tienes acceso a este archivo de produccion.';
  end if;

  if p_next_status = 'completed' and file_row.status <> 'in_termination' then
    raise exception 'El archivo debe estar en terminacion antes de completarse.';
  end if;

  update public.order_production_files
  set status = p_next_status,
      updated_by = v_uid
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  return file_row;
end;
$$;

do $$
declare
  active_order_count integer;
  invalid_area record;
begin
  select count(*)
  into active_order_count
  from public.orders
  where status in ('in_Production', 'in_Termination', 'in_Completed');

  if active_order_count > 0 then
    select pa.code, pa.label, count(p.id) as active_users
    into invalid_area
    from public.production_areas pa
    left join public.profiles p
      on p.role = pa.producer_role
     and coalesce(p.employment_status, true) = true
    where pa.is_active = true
    group by pa.code, pa.label
    having count(p.id) <> 1
    limit 1;

    if found then
      raise exception 'Backfill detenido: el area % tiene % usuarios activos. Debe existir exactamente 1 para migrar ordenes en produccion.', invalid_area.label, invalid_area.active_users;
    end if;

    insert into public.order_production_assignments (
      order_id,
      production_area_code,
      assigned_to,
      assigned_by
    )
    select
      o.id,
      pa.code,
      p.id,
      null
    from public.orders o
    cross join public.production_areas pa
    join public.profiles p
      on p.role = pa.producer_role
     and coalesce(p.employment_status, true) = true
    where o.status in ('in_Production', 'in_Termination', 'in_Completed')
      and pa.is_active = true
    on conflict (order_id, production_area_code) do nothing;

    update public.order_production_files opf
    set assigned_to = opa.assigned_to
    from public.order_production_assignments opa
    where opf.order_id = opa.order_id
      and opf.production_area_code = opa.production_area_code
      and opf.assigned_to is distinct from opa.assigned_to;
  end if;
end;
$$;

revoke all on function public.touch_order_production_assignment() from public, anon, authenticated;
revoke all on function public.current_user_assigned_to_production_area(uuid, text) from public, anon;
revoke all on function public.producer_can_access_order(uuid) from public, anon;
revoke all on function public.send_order_to_production(uuid, jsonb) from public, anon;
revoke all on function public.update_production_file_status(uuid, text) from public, anon;

grant execute on function public.current_user_assigned_to_production_area(uuid, text) to authenticated;
grant execute on function public.producer_can_access_order(uuid) to authenticated;
grant execute on function public.send_order_to_production(uuid, jsonb) to authenticated;
grant execute on function public.update_production_file_status(uuid, text) to authenticated;

create or replace function public.can_manage_order_asset_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.orders o
    where o.id::text = (storage.foldername(object_name))[2]
      and (
        public.current_profile_is_admin()
        or auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
        or public.producer_can_access_order(o.id)
      )
  );
$$;

revoke all on function public.can_manage_order_asset_path(text) from public;
grant execute on function public.can_manage_order_asset_path(text) to authenticated;

grant select on public.order_production_assignments to authenticated;
revoke insert, update, delete on public.order_production_assignments from authenticated;

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

drop policy if exists order_production_files_select_by_role on public.order_production_files;
create policy order_production_files_select_by_role
  on public.order_production_files for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or public.current_user_assigned_to_production_area(order_id, production_area_code)
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
          or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );

drop policy if exists orders_select_by_role on public.orders;
drop policy if exists orders_update_by_role on public.orders;

create policy orders_select_by_role
  on public.orders for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, delivery_id)
    or public.producer_can_access_order(id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  );

create policy orders_update_by_role
  on public.orders for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, delivery_id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  )
  with check (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, delivery_id)
    or (public.current_profile_role() = 'delivery' and status in ('in_Completed', 'in_Delivered'))
  );

drop policy if exists order_events_select_by_order_access on public.order_events;
create policy order_events_select_by_order_access
  on public.order_events for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
          or public.producer_can_access_order(o.id)
          or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );
