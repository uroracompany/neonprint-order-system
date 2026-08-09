-- Delivery ownership must be persisted on orders.delivery_id before an order
-- enters the delivery queue. Do not backfill historical NULL values here: an
-- administrator must verify the intended Delivery user first.

create index if not exists idx_orders_delivery_status_created_at
  on public.orders (delivery_id, status, created_at desc)
  where delivery_id is not null;

-- Keep the delivery assignment when production calculates the completed state.
create or replace function public.recalculate_order_production_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  total_count integer;
  completed_count integer;
  ready_count integer;
  next_status text;
begin
  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is not null and status = 'completed'),
    count(*) filter (where production_area_code is not null and status in ('in_termination', 'completed'))
  into total_count, completed_count, ready_count
  from public.order_production_files
  where order_id = p_order_id;

  if total_count = 0 then
    select status into next_status from public.orders where id = p_order_id;
    return next_status;
  end if;

  if completed_count = total_count then
    next_status := 'in_Completed';
  elsif ready_count = total_count then
    next_status := 'in_Termination';
  else
    next_status := 'in_Production';
  end if;

  update public.orders
  set status = next_status,
      updated_at = now()
  where id = p_order_id
    and status not in ('cancelled', 'in_Delivered');

  return next_status;
end;
$$;

revoke all on function public.recalculate_order_production_status(uuid) from public, anon;
grant execute on function public.recalculate_order_production_status(uuid) to authenticated;

-- Assign the Delivery user and complete the final production file atomically.
-- The previous two-argument function is dropped to avoid ambiguous RPC calls
-- when the new optional p_delivery_id parameter is introduced.
drop function if exists public.update_production_file_status(uuid, text);

create function public.update_production_file_status(
  p_file_id uuid,
  p_next_status text,
  p_delivery_id uuid default null
)
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
  order_row public.orders;
  is_last_pending_file boolean := false;
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

  if p_next_status not in ('in_production', 'in_termination', 'completed') then
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

  if file_row.status = 'completed' then
    raise exception 'No se puede cambiar el estado de un archivo completado.';
  end if;

  if p_next_status = 'in_production' and file_row.status <> 'in_termination' then
    raise exception 'Solo archivos en terminacion pueden volver a produccion.';
  end if;

  if p_next_status = 'completed' and file_row.status <> 'in_termination' then
    raise exception 'El archivo debe estar en terminacion antes de completarse.';
  end if;

  select *
  into order_row
  from public.orders
  where id = file_row.order_id
  for update;

  if p_next_status = 'completed' then
    select not exists (
      select 1
      from public.order_production_files opf
      where opf.order_id = file_row.order_id
        and opf.id <> file_row.id
        and opf.status <> 'completed'
    ) into is_last_pending_file;

    if is_last_pending_file then
      if p_delivery_id is null then
        raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.';
      end if;

      if not exists (
        select 1
        from public.profiles p
        where p.id = p_delivery_id
          and p.role = 'delivery'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.';
      end if;

      update public.orders
      set delivery_id = p_delivery_id,
          updated_at = now()
      where id = order_row.id;
    elsif p_delivery_id is not null then
      raise exception 'El Delivery solo se asigna al completar el ultimo archivo.';
    end if;
  elsif p_delivery_id is not null then
    raise exception 'El Delivery solo se asigna al completar el ultimo archivo.';
  end if;

  update public.order_production_files
  set status = p_next_status,
      updated_by = v_uid,
      updated_at = now()
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  return file_row;
end;
$$;

revoke all on function public.update_production_file_status(uuid, text, uuid) from public, anon;
grant execute on function public.update_production_file_status(uuid, text, uuid) to authenticated;

-- Broadcast assignment/status changes to the responsible Delivery user (from
-- both the old and new order versions), never to every Delivery account.
create or replace function public.order_realtime_recipient_ids(
  p_old public.orders,
  p_new public.orders
)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  with order_versions as (
    select p_old as order_row
    where (p_old).id is not null
    union all
    select p_new as order_row
    where (p_new).id is not null
  ),
  candidate_recipients as (
    select unnest(public.get_admin_user_ids()) as recipient_id

    union all

    select unnest(array[
      (order_row).created_by,
      (order_row).seller_id,
      (order_row).designer_id,
      (order_row).quote_id,
      (order_row).production_id,
      (order_row).delivery_id
    ]) as recipient_id
    from order_versions

    union all

    select unnest(public.admin_order_edit_production_recipients(order_row)) as recipient_id
    from order_versions
  )
  select coalesce(array_agg(distinct candidate.recipient_id), array[]::uuid[])
  from candidate_recipients candidate
  join public.profiles profile on profile.id = candidate.recipient_id
  where candidate.recipient_id is not null
    and coalesce(profile.employment_status, true) = true
$$;

revoke all on function public.order_realtime_recipient_ids(public.orders, public.orders) from public, anon, authenticated;

-- Delivery users may access only the orders explicitly assigned to them. The
-- shared status-based exception made every completed order appear assigned.
drop policy if exists orders_select_by_role on public.orders;
drop policy if exists orders_update_by_role on public.orders;

create policy orders_select_by_role
  on public.orders for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or (select auth.uid()) in (created_by, seller_id, designer_id, quote_id, delivery_id)
    or public.producer_can_access_order(id)
  );

create policy orders_update_by_role
  on public.orders for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or (select auth.uid()) in (created_by, seller_id, designer_id, quote_id, delivery_id)
  )
  with check (
    public.current_profile_is_admin()
    or (select auth.uid()) in (created_by, seller_id, designer_id, quote_id, delivery_id)
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
        and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
    )
  );

drop policy if exists order_production_assignments_select_assigned on public.order_production_assignments;
create policy order_production_assignments_select_assigned
  on public.order_production_assignments for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or assigned_to = (select auth.uid())
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_assignments.order_id
        and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
    )
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
          (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
          or public.producer_can_access_order(o.id)
        )
    )
  );
