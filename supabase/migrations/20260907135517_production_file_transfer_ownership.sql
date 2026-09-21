-- File-level production handoffs.  The area assignment remains the initial
-- routing record; assigned_to on each production file is the operational owner.

-- Existing active production files were historically controlled only through
-- the area assignment.  Backfill that initial owner once, without changing a
-- file that is already explicitly owned.
update public.order_production_files opf
set assigned_to = opa.assigned_to,
    updated_at = now()
from public.order_production_assignments opa
where opf.order_id = opa.order_id
  and opf.production_area_code = opa.production_area_code
  and opf.assigned_to is null;

-- SemiAdmin's asset command can add or reclassify an asset after the order is
-- already in Production. Preserve a compatible explicit file owner (including
-- a prior partial handoff); otherwise resolve the initial area owner. Never
-- leave an active-production file ownerless or owned by another area.
create or replace function public.reconcile_active_production_file_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status text;
  v_assignment_owner uuid;
begin
  select status into v_order_status
  from public.orders
  where id = new.order_id;

  if v_order_status not in ('in_Production', 'in_Termination', 'in_Completed') then
    return new;
  end if;

  if exists (
    select 1
    from public.profiles profile
    join public.production_areas area
      on area.producer_role = profile.role
     and area.code = new.production_area_code
     and area.is_active = true
    where profile.id = new.assigned_to
      and profile.deleted_at is null
      and coalesce(profile.employment_status, true) = true
  ) then
    return new;
  end if;

  select assignment.assigned_to
  into v_assignment_owner
  from public.order_production_assignments assignment
  join public.production_areas area
    on area.code = assignment.production_area_code
   and area.is_active = true
  join public.profiles profile
    on profile.id = assignment.assigned_to
   and profile.role = area.producer_role
   and profile.deleted_at is null
   and coalesce(profile.employment_status, true) = true
  where assignment.order_id = new.order_id
    and assignment.production_area_code = new.production_area_code;

  if v_assignment_owner is null then
    raise exception 'No existe un responsable activo para el área de Producción del archivo.';
  end if;

  new.assigned_to := v_assignment_owner;
  return new;
end;
$$;

drop trigger if exists trg_reconcile_active_production_file_owner on public.order_production_files;
create trigger trg_reconcile_active_production_file_owner
  before insert or update of production_area_code, assigned_to
  on public.order_production_files
  for each row
  execute function public.reconcile_active_production_file_owner();

revoke all on function public.reconcile_active_production_file_owner() from public, anon, authenticated;

create or replace function public.producer_can_access_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_order_id is not null and exists (
    select 1
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
     and pa.is_active = true
    join public.profiles profile
      on profile.id = (select auth.uid())
     and profile.role = pa.producer_role
     and profile.deleted_at is null
     and coalesce(profile.employment_status, true) = true
    where opf.order_id = p_order_id
      and opf.assigned_to = (select auth.uid())
  );
$$;

revoke all on function public.producer_can_access_order(uuid) from public, anon;
grant execute on function public.producer_can_access_order(uuid) to authenticated;

-- A recipient sees only the files they own (plus the pre-existing operator and
-- order-role exceptions).  Writes remain RPC-only.
drop policy if exists order_production_files_select_by_role on public.order_production_files;
create policy order_production_files_select_by_role
  on public.order_production_files for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or public.current_profile_is_order_operator()
    or (
      assigned_to = (select auth.uid())
      and exists (
        select 1
        from public.production_areas pa
        join public.profiles profile
          on profile.id = (select auth.uid())
         and profile.role = pa.producer_role
         and profile.deleted_at is null
         and coalesce(profile.employment_status, true) = true
        where pa.code = order_production_files.production_area_code
          and pa.is_active = true
      )
    )
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_files.order_id
        and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
    )
  );

revoke insert, update, delete on public.order_production_files from public, anon, authenticated;

create or replace function public.get_production_file_transfer_candidates(p_order_id uuid)
returns table (id uuid, name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_area_code text;
begin
  if v_actor is null then
    raise exception 'No tienes una sesión activa.';
  end if;

  select profile.role, pa.code
  into v_role, v_area_code
  from public.profiles profile
  join public.production_areas pa
    on pa.producer_role = profile.role
   and pa.is_active = true
  where profile.id = v_actor
    and profile.deleted_at is null
    and coalesce(profile.employment_status, true) = true
  limit 1;

  if v_area_code is null then
    raise exception 'Tu usuario no pertenece a un área activa de Producción.';
  end if;

  if not exists (
    select 1
    from public.order_production_files opf
    join public.orders o on o.id = opf.order_id
    where opf.order_id = p_order_id
      and opf.production_area_code = v_area_code
      and opf.assigned_to = v_actor
      and opf.status in ('pending', 'in_production')
      and o.status not in ('cancelled', 'in_Delivered')
  ) then
    raise exception 'No tienes archivos transferibles en esta orden.';
  end if;

  return query
  select profile.id, coalesce(nullif(btrim(profile.name), ''), 'Operador de producción')
  from public.profiles profile
  where profile.id <> v_actor
    and profile.role = v_role
    and profile.deleted_at is null
    and coalesce(profile.employment_status, true) = true
  order by coalesce(nullif(btrim(profile.name), ''), 'Operador de producción'), profile.id;
end;
$$;

create or replace function public.transfer_production_files(
  p_order_id uuid,
  p_files jsonb,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_name text;
  v_actor_role text;
  v_area_code text;
  v_area_label text;
  v_target_name text;
  v_order public.orders;
  v_item jsonb;
  v_file public.order_production_files;
  v_file_id uuid;
  v_expected_updated_at timestamptz;
  v_file_ids uuid[] := array[]::uuid[];
  v_files jsonb := '[]'::jsonb;
  v_event_id uuid;
  v_count integer := 0;
begin
  if v_actor is null then
    raise exception 'No tienes una sesión activa.';
  end if;
  if p_order_id is null or p_target_user_id is null then
    raise exception 'La orden y el destinatario son obligatorios.';
  end if;
  if p_target_user_id = v_actor then
    raise exception 'Debes seleccionar otro operador de tu misma área.';
  end if;
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) = 0 then
    raise exception 'Debes seleccionar al menos un archivo.';
  end if;

  select profile.role,
         coalesce(nullif(btrim(profile.name), ''), 'Operador de producción'),
         pa.code,
         pa.label
  into v_actor_role, v_actor_name, v_area_code, v_area_label
  from public.profiles profile
  join public.production_areas pa
    on pa.producer_role = profile.role
   and pa.is_active = true
  where profile.id = v_actor
    and profile.deleted_at is null
    and coalesce(profile.employment_status, true) = true
  limit 1;

  if v_area_code is null then
    raise exception 'Tu usuario no pertenece a un área activa de Producción.';
  end if;

  select coalesce(nullif(btrim(profile.name), ''), 'Operador de producción')
  into v_target_name
  from public.profiles profile
  where profile.id = p_target_user_id
    and profile.role = v_actor_role
    and profile.deleted_at is null
    and coalesce(profile.employment_status, true) = true;

  if v_target_name is null then
    raise exception 'El destinatario debe ser un operador activo de tu misma área.';
  end if;

  for v_item in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_item) <> 'object'
      or not (v_item ? 'id' and v_item ? 'expected_updated_at')
      or (v_item - 'id' - 'expected_updated_at') <> '{}'::jsonb
      or jsonb_typeof(v_item->'id') <> 'string'
      or jsonb_typeof(v_item->'expected_updated_at') <> 'string' then
      raise exception 'La selección de archivos no es válida.';
    end if;

    begin
      v_file_id := (v_item->>'id')::uuid;
      v_expected_updated_at := (v_item->>'expected_updated_at')::timestamptz;
    exception when invalid_text_representation then
      raise exception 'La selección de archivos contiene una versión inválida.';
    end;

    if v_file_id = any(v_file_ids) then
      raise exception 'No puedes repetir un archivo en el traspaso.';
    end if;
    v_file_ids := array_append(v_file_ids, v_file_id);
  end loop;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'La orden ya no está disponible para Producción.';
  end if;

  for v_file in
    select *
    from public.order_production_files
    where id = any(v_file_ids)
    order by id
    for update
  loop
    v_count := v_count + 1;
    select (item->>'expected_updated_at')::timestamptz
    into v_expected_updated_at
    from jsonb_array_elements(p_files) item
    where item->>'id' = v_file.id::text;

    if v_file.order_id <> p_order_id
      or v_file.production_area_code <> v_area_code
      or v_file.assigned_to is distinct from v_actor then
      raise exception 'Solo puedes traspasar tus propios archivos de esta área.';
    end if;
    if v_file.status not in ('pending', 'in_production') then
      raise exception 'Solo se pueden traspasar archivos pendientes o en producción.';
    end if;
    if v_file.updated_at is distinct from v_expected_updated_at then
      raise exception 'FILE_STALE';
    end if;

    v_files := v_files || jsonb_build_array(jsonb_build_object(
      'id', v_file.id,
      'filename', coalesce(v_file.filename, 'Archivo de producción'),
      'status', v_file.status,
      'previous_responsible_id', v_actor,
      'new_responsible_id', p_target_user_id
    ));
  end loop;

  if v_count <> cardinality(v_file_ids) then
    raise exception 'Uno o más archivos no existen.';
  end if;

  update public.order_production_files
  set assigned_to = p_target_user_id,
      updated_by = v_actor,
      updated_at = now()
  where id = any(v_file_ids);

  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (
    p_order_id,
    v_actor,
    'production_files_transferred',
    jsonb_build_object(
      'source_module', 'production',
      'actor_id', v_actor,
      'actor_name', v_actor_name,
      'recipient_id', p_target_user_id,
      'recipient_name', v_target_name,
      'production_area_code', v_area_code,
      'production_area_label', v_area_label,
      'files', v_files
    )
  )
  returning id into v_event_id;

  perform public.record_order_assignment_receipt(
    p_order_id,
    p_target_user_id,
    'production',
    'production_file_transfer',
    v_event_id
  );

  perform public.notify_many(
    array[v_actor],
    'order_assigned',
    'Archivos traspasados correctamente',
    'Traspasaste ' || v_count || ' archivo' || case when v_count = 1 then '' else 's' end
      || ' de ' || coalesce(v_area_label, 'Producción') || ' a ' || v_target_name || '.',
    p_order_id,
    jsonb_build_object(
      'event_kind', 'production_file_transfer_confirmation',
      'variant', 'success',
      'event_id', v_event_id,
      'actor_id', v_actor,
      'assignee_id', p_target_user_id,
      'assignee_name', v_target_name,
      'production_area_code', v_area_code,
      'file_ids', to_jsonb(v_file_ids)
    )
  );

  perform public.notify_many(
    array[p_target_user_id],
    'order_assigned',
    'Archivos asignados correctamente',
    v_actor_name || ' te traspasó ' || v_count || ' archivo' || case when v_count = 1 then '' else 's' end
      || ' de ' || coalesce(v_area_label, 'Producción') || '.',
    p_order_id,
    jsonb_build_object(
      'event_kind', 'production_file_transfer_assigned',
      'variant', 'success',
      'event_id', v_event_id,
      'actor_id', v_actor,
      'assignee_id', p_target_user_id,
      'assignee_name', v_target_name,
      'production_area_code', v_area_code,
      'file_ids', to_jsonb(v_file_ids)
    )
  );

  return jsonb_build_object(
    'event_id', v_event_id,
    'transferred_file_ids', to_jsonb(v_file_ids),
    'recipient_id', p_target_user_id,
    'recipient_name', v_target_name
  );
end;
$$;

create or replace function public.get_production_file_transfer_history(p_order_id uuid)
returns table (
  event_id uuid,
  transferred_at timestamptz,
  actor_id uuid,
  actor_name text,
  recipient_id uuid,
  recipient_name text,
  production_area_code text,
  production_area_label text,
  files jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'No tienes una sesión activa.';
  end if;
  if not (public.current_profile_is_admin() or public.producer_can_access_order(p_order_id)) then
    raise exception 'No tienes acceso al historial de esta orden.';
  end if;

  return query
  select
    event.id,
    event.created_at,
    event.actor_id,
    coalesce(event.changes->>'actor_name', 'Operador de producción'),
    nullif(event.changes->>'recipient_id', '')::uuid,
    coalesce(event.changes->>'recipient_name', 'Operador de producción'),
    event.changes->>'production_area_code',
    event.changes->>'production_area_label',
    coalesce(event.changes->'files', '[]'::jsonb)
  from public.order_events event
  where event.order_id = p_order_id
    and event.event_type = 'production_files_transferred'
  order by event.created_at desc;
end;
$$;

-- The production status command must follow current file ownership.  It
-- preserves the existing delivery/rework completion safeguards.
create or replace function public.update_production_file_status(
  p_file_id uuid,
  p_next_status text,
  p_delivery_id uuid default null
) returns public.order_production_files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_role text;
  v_area_code text;
  file_row public.order_production_files;
  order_row public.orders;
  v_handoff public.delivery_rework_handoffs;
  is_last_pending_file boolean := false;
begin
  if v_uid is null then raise exception 'No tienes una sesión activa.'; end if;
  select profile.role, pa.code into v_profile_role, v_area_code
  from public.profiles profile
  join public.production_areas pa on pa.producer_role = profile.role and pa.is_active = true
  where profile.id = v_uid and profile.deleted_at is null and coalesce(profile.employment_status, true) = true
  limit 1;
  if v_area_code is null then raise exception 'Tu rol no pertenece a un área de Producción.'; end if;
  if p_next_status not in ('in_production', 'in_termination', 'completed') then raise exception 'Transición de estado no permitida.'; end if;

  select opf.* into file_row
  from public.order_production_files opf
  where opf.id = p_file_id
    and opf.production_area_code = v_area_code
    and opf.assigned_to = v_uid
  for update;
  if not found then raise exception 'No tienes acceso a este archivo de Producción.'; end if;
  if file_row.status = 'completed' then raise exception 'No se puede cambiar el estado de un archivo completado.'; end if;
  if p_next_status = 'in_production' and file_row.status <> 'in_termination' then raise exception 'Solo archivos en terminación pueden volver a Producción.'; end if;
  if p_next_status = 'completed' and file_row.status <> 'in_termination' then raise exception 'El archivo debe estar en terminación antes de completarse.'; end if;

  select * into order_row from public.orders where id = file_row.order_id for update;
  if order_row.status in ('cancelled', 'in_Delivered') then raise exception 'La orden ya no está disponible para Producción.'; end if;

  if p_next_status = 'completed' then
    select not exists (
      select 1 from public.order_production_files opf
      where opf.order_id = file_row.order_id and opf.id <> file_row.id and opf.status <> 'completed'
    ) into is_last_pending_file;
    if is_last_pending_file then
      select * into v_handoff from public.delivery_rework_handoffs
      where order_id = order_row.id and returned_to_delivery_at is null for update;
      if p_delivery_id is null then raise exception 'Selecciona un usuario Delivery activo para completar el último archivo.'; end if;
      if v_handoff.id is not null and p_delivery_id is distinct from v_handoff.returning_delivery_id then
        raise exception 'Esta orden devuelta solo puede reenviarse al Delivery que la devolvió.';
      end if;
      if not exists (
        select 1 from public.profiles profile where profile.id = p_delivery_id and profile.role = 'delivery'
          and profile.deleted_at is null and coalesce(profile.employment_status, true) = true
      ) then raise exception 'Selecciona un usuario Delivery activo para completar el último archivo.'; end if;
    elsif p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el último archivo.'; end if;
  elsif p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el último archivo.'; end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  if is_last_pending_file then
    update public.orders set delivery_id = p_delivery_id, updated_at = now() where id = order_row.id;
  end if;
  update public.order_production_files
  set status = p_next_status, updated_by = v_uid, updated_at = now()
  where id = p_file_id
  returning * into file_row;
  perform public.recalculate_order_production_status(file_row.order_id);
  if is_last_pending_file and v_handoff.id is not null then
    update public.delivery_rework_handoffs set returned_to_delivery_at = now(), returned_to_delivery_by = v_uid
    where id = v_handoff.id and returned_to_delivery_at is null;
    if not found then raise exception 'La devolución ya no está activa. Actualiza la orden e intenta nuevamente.'; end if;
  end if;
  return file_row;
end;
$$;

-- Several operators can now own files in one area, so aggregate by both area
-- and file owner rather than by the area-level routing assignment.
create or replace function public.get_production_order_team(p_order_id uuid)
returns table (
  production_area_code text,
  production_area_label text,
  assigned_to uuid,
  assigned_name text,
  assigned_role text,
  total_files integer,
  pending_count integer,
  in_production_count integer,
  in_termination_count integer,
  completed_count integer,
  summary_status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'No tienes una sesión activa.'; end if;
  if not (public.current_profile_is_admin() or public.producer_can_access_order(p_order_id)) then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  return query
  select
    opf.production_area_code::text,
    coalesce(pa.label, opf.production_area_code)::text,
    opf.assigned_to,
    coalesce(nullif(profile.name, ''), 'Usuario de producción')::text,
    profile.role::text,
    count(*)::integer,
    count(*) filter (where coalesce(opf.status, 'pending') = 'pending')::integer,
    count(*) filter (where coalesce(opf.status, 'pending') = 'in_production')::integer,
    count(*) filter (where coalesce(opf.status, 'pending') = 'in_termination')::integer,
    count(*) filter (where coalesce(opf.status, 'pending') = 'completed')::integer,
    case
      when count(*) filter (where coalesce(opf.status, 'pending') = 'completed') = count(*) then 'completed'
      when count(*) filter (where coalesce(opf.status, 'pending') = 'in_termination') > 0 then 'in_termination'
      when count(*) filter (where coalesce(opf.status, 'pending') = 'in_production') > 0 then 'in_production'
      else 'pending'
    end::text,
    max(opf.updated_at)
  from public.order_production_files opf
  join public.production_areas pa on pa.code = opf.production_area_code
  join public.profiles profile on profile.id = opf.assigned_to
  where opf.order_id = p_order_id
    and opf.assigned_to is not null
  group by opf.production_area_code, pa.label, opf.assigned_to, profile.name, profile.role
  order by opf.production_area_code, coalesce(nullif(profile.name, ''), 'Usuario de producción');
end;
$$;

create or replace function public.get_active_delivery_rework_handoffs(p_order_ids uuid[])
returns table (order_id uuid, handoff_id uuid, returned_at timestamptz, returning_delivery_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null or p_order_ids is null or cardinality(p_order_ids) = 0 then return; end if;
  select profile.role into v_role from public.profiles profile
  where profile.id = v_actor and profile.deleted_at is null and profile.employment_status is distinct from false;
  if v_role is null or not exists (
    select 1 from public.production_areas pa where pa.producer_role = v_role and pa.is_active
  ) then raise exception 'No tienes acceso a los reingresos de Producción.'; end if;

  return query
  select handoff.order_id, handoff.id, handoff.opened_at, handoff.returning_delivery_id
  from public.delivery_rework_handoffs handoff
  where handoff.returned_to_delivery_at is null
    and handoff.order_id = any(p_order_ids)
    and public.producer_can_access_order(handoff.order_id);
end;
$$;

-- This is the current page-level rework context contract. A recipient of a
-- transferred file is a current production participant even when they are not
-- the original area-level assignee.
create or replace function public.get_active_delivery_rework_context(
  p_order_ids uuid[]
) returns table (
  order_id uuid,
  handoff_id uuid,
  returned_at timestamptz,
  returning_delivery_id uuid,
  returned_files jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null or p_order_ids is null or cardinality(p_order_ids) = 0 then return; end if;
  select profile.role into v_role from public.profiles profile
  where profile.id = v_actor and profile.deleted_at is null and coalesce(profile.employment_status, true) = true;
  if v_role is null or not exists (
    select 1 from public.production_areas pa where pa.producer_role = v_role and pa.is_active
  ) then raise exception 'No tienes acceso a los reingresos de Producción.'; end if;

  return query
  select
    handoff.order_id,
    handoff.id,
    handoff.opened_at,
    handoff.returning_delivery_id,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'production_file_id', item.production_file_id,
        'filename', coalesce(file.filename, 'Archivo de producción'),
        'reason', item.correction_note,
        'returned_at', item.created_at
      ) order by item.created_at, item.production_file_id)
      from public.delivery_rework_event_items item
      left join public.order_production_files file on file.id = item.production_file_id
      where item.event_id = handoff.event_id
    ), '[]'::jsonb)
  from public.delivery_rework_handoffs handoff
  where handoff.returned_to_delivery_at is null
    and handoff.order_id = any(p_order_ids)
    and public.producer_can_access_order(handoff.order_id);
end;
$$;

revoke all on function public.get_production_file_transfer_candidates(uuid),
  public.transfer_production_files(uuid, jsonb, uuid),
  public.get_production_file_transfer_history(uuid),
  public.update_production_file_status(uuid, text, uuid),
  public.get_production_order_team(uuid),
  public.get_active_delivery_rework_handoffs(uuid[]),
  public.get_active_delivery_rework_context(uuid[]) from public, anon;
grant execute on function public.get_production_file_transfer_candidates(uuid),
  public.transfer_production_files(uuid, jsonb, uuid),
  public.get_production_file_transfer_history(uuid),
  public.update_production_file_status(uuid, text, uuid),
  public.get_production_order_team(uuid),
  public.get_active_delivery_rework_handoffs(uuid[]),
  public.get_active_delivery_rework_context(uuid[]) to authenticated;

notify pgrst, 'reload schema';
