-- Server-owned lifecycle for a Delivery -> Production rework cycle.  The
-- immutable event remains the audit record; this table only captures whether
-- that particular cycle is still active and who may receive the order again.
create table public.delivery_rework_handoffs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  event_id uuid not null unique references public.delivery_rework_events(id) on delete restrict,
  returning_delivery_id uuid not null references public.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  returned_to_delivery_at timestamptz,
  returned_to_delivery_by uuid references public.profiles(id) on delete restrict,
  constraint delivery_rework_handoffs_resolution_check check (
    (returned_to_delivery_at is null and returned_to_delivery_by is null)
    or (returned_to_delivery_at is not null and returned_to_delivery_by is not null)
  )
);

create unique index delivery_rework_handoffs_one_active_order_idx
  on public.delivery_rework_handoffs(order_id)
  where returned_to_delivery_at is null;
create index delivery_rework_handoffs_active_order_idx
  on public.delivery_rework_handoffs(order_id, opened_at desc)
  where returned_to_delivery_at is null;
create index delivery_rework_handoffs_returning_delivery_idx
  on public.delivery_rework_handoffs(returning_delivery_id)
  where returned_to_delivery_at is null;

alter table public.delivery_rework_handoffs enable row level security;
revoke all on public.delivery_rework_handoffs from public, anon, authenticated;

-- Minimal authorised read surface for the badge.  It deliberately does not
-- expose file notes, recipient IDs, or any order the current producer is not
-- already assigned to work on.
create or replace function public.get_active_delivery_rework_handoffs(p_order_ids uuid[])
returns table (
  order_id uuid,
  handoff_id uuid,
  returned_at timestamptz,
  returning_delivery_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
begin
  if v_actor is null or p_order_ids is null or cardinality(p_order_ids) = 0 then
    return;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and p.deleted_at is null
    and p.employment_status is distinct from false;

  if v_role is null or not exists (
    select 1 from public.production_areas pa
    where pa.producer_role = v_role and pa.is_active
  ) then
    raise exception 'No tienes acceso a los reingresos de produccion.';
  end if;

  return query
  select h.order_id, h.id, h.opened_at, h.returning_delivery_id
  from public.delivery_rework_handoffs h
  where h.returned_to_delivery_at is null
    and h.order_id = any(p_order_ids)
    and exists (
      select 1
      from public.order_production_files opf
      where opf.order_id = h.order_id
        and public.current_user_assigned_to_production_area(
          opf.order_id,
          opf.production_area_code
        )
    );
end;
$$;

revoke all on function public.get_active_delivery_rework_handoffs(uuid[]) from public, anon, authenticated;
grant execute on function public.get_active_delivery_rework_handoffs(uuid[]) to authenticated;

-- Replaces the existing return command so handoff creation and both sets of
-- notifications are atomic with the file/order state transition.
create or replace function public.delivery_return_completed_files_to_production(
  p_order_id uuid, p_items jsonb, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_delivery_rework_actor(); v_order public.orders; v_item jsonb;
  v_file_ids uuid[] := array[]::uuid[]; v_notes jsonb := '{}'::jsonb; v_file_id uuid; v_note text;
  v_file public.order_production_files; v_recipient uuid; v_event uuid; v_handoff uuid;
  v_returned uuid[] := array[]::uuid[]; v_recipient_ids uuid[];
begin
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Debes seleccionar al menos un archivo.'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or (v_item - 'file_id' - 'correction_note') <> '{}'::jsonb
       or not (v_item ? 'file_id' and v_item ? 'correction_note') or coalesce(v_item->>'file_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'La devolucion de archivos es invalida.';
    end if;
    if jsonb_typeof(v_item->'correction_note') <> 'string' then raise exception 'Cada nota debe ser texto.'; end if;
    v_file_id := (v_item->>'file_id')::uuid; v_note := btrim(coalesce(v_item->>'correction_note', ''));
    if char_length(v_note) not between 1 and 1000 then raise exception 'Cada archivo requiere una nota de 1 a 1000 caracteres.'; end if;
    if v_file_id = any(v_file_ids) then raise exception 'No puedes repetir un archivo.'; end if;
    v_file_ids := array_append(v_file_ids, v_file_id); v_notes := v_notes || jsonb_build_object(v_file_id::text, v_note);
  end loop;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.delivery_id is distinct from v_actor then raise exception 'No tienes asignada esta orden.'; end if;
  if coalesce(v_order.is_archived_delivery, false) then raise exception 'La orden esta archivada para Delivery.'; end if;
  if v_order.status = 'cancelled' then raise exception 'La orden esta cancelada.'; end if;
  if v_order.status <> 'in_Completed' then raise exception 'La orden debe estar completada para devolver archivos a produccion.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;

  -- The order lock plus this lock and the partial unique index prevent two
  -- active cycles from being opened concurrently.
  perform 1 from public.delivery_rework_handoffs
  where order_id = v_order.id and returned_to_delivery_at is null for update;

  for v_file in select * from public.order_production_files where id = any(v_file_ids) order by id for update loop
    if v_file.order_id <> p_order_id or v_file.production_area_code is null then raise exception 'El archivo no pertenece a esta orden o no tiene area.'; end if;
    if v_file.status <> 'completed' then raise exception 'Solo se pueden devolver archivos completados.'; end if;
    v_recipient := public.resolve_delivery_rework_recipient(v_order.id, v_file.production_area_code, v_file.assigned_to);
    v_returned := array_append(v_returned, v_file.id);
  end loop;
  if cardinality(v_returned) <> cardinality(v_file_ids) then raise exception 'Uno o mas archivos no existen o no pertenecen a la orden.'; end if;

  perform set_config('app.neonprint_order_command', 'delivery_rework', true);
  insert into public.delivery_rework_events(order_id, delivery_id, event_kind, source_order_status, target_order_status)
  values (v_order.id, v_actor, 'files_returned_to_production', 'in_Completed', 'in_Production') returning id into v_event;
  insert into public.delivery_rework_handoffs(order_id, event_id, returning_delivery_id)
  values (v_order.id, v_event, v_actor) returning id into v_handoff;

  for v_file in select * from public.order_production_files where id = any(v_file_ids) order by id loop
    v_recipient := public.resolve_delivery_rework_recipient(v_order.id, v_file.production_area_code, v_file.assigned_to);
    insert into public.delivery_rework_event_items(event_id, production_file_id, recipient_id, production_area_code, previous_file_status, next_file_status, correction_note)
    values (v_event, v_file.id, v_recipient, v_file.production_area_code, 'completed', 'in_production', v_notes->>v_file.id::text);
  end loop;
  update public.order_production_files set status = 'in_production', updated_by = v_actor, updated_at = now() where id = any(v_file_ids);
  perform public.recalculate_order_production_status(v_order.id);

  select array_agg(distinct recipient_id) into v_recipient_ids
  from public.delivery_rework_event_items where event_id = v_event;
  for v_recipient in select unnest(v_recipient_ids) loop
    perform public.notify_many(array[v_recipient], 'order_returned', 'Orden devuelta por Delivery',
      'Recibiste archivos devueltos de la orden #' || left(v_order.id::text, 8) || ' para correccion en produccion.', v_order.id,
      jsonb_build_object('event_kind','delivery_rework','event_id',v_event,'handoff_id',v_handoff,'order_id',v_order.id,'file_ids',(
        select coalesce(jsonb_agg(production_file_id), '[]'::jsonb) from public.delivery_rework_event_items where event_id=v_event and recipient_id=v_recipient
      ),'deep_link','/production?order=' || v_order.id::text));
  end loop;
  perform public.notify_many(array[v_actor], 'order_returned', 'Devolucion enviada a produccion',
    'La devolucion de archivos de la orden #' || left(v_order.id::text, 8) || ' se completo correctamente.', v_order.id,
    jsonb_build_object('event_kind','delivery_rework_return_confirmed','event_id',v_event,'handoff_id',v_handoff,'order_id',v_order.id,
      'file_ids',to_jsonb(v_returned),'deep_link','/delivery?order=' || v_order.id::text));

  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object('order', to_jsonb(v_order), 'event_id', v_event, 'handoff_id', v_handoff, 'returned_file_ids', to_jsonb(v_returned));
end;
$$;

-- Preserve the original production command's access and transition checks,
-- adding only the atomic active-handoff resolution at the final-file boundary.
create or replace function public.update_production_file_status(
  p_file_id uuid, p_next_status text, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_profile_role text; area_code text;
  file_row public.order_production_files; order_row public.orders;
  v_handoff public.delivery_rework_handoffs; is_last_pending_file boolean := false;
begin
  if v_uid is null then raise exception 'No tienes una sesion activa.'; end if;
  select p.role into v_profile_role from public.profiles p
  where p.id = v_uid and p.deleted_at is null and coalesce(p.employment_status, true) = true;
  select pa.code into area_code from public.production_areas pa
  where pa.producer_role = v_profile_role and pa.is_active = true limit 1;
  if area_code is null then raise exception 'Tu rol no pertenece a un area de produccion.'; end if;
  if p_next_status not in ('in_production', 'in_termination', 'completed') then raise exception 'Transicion de estado no permitida.'; end if;

  select opf.* into file_row from public.order_production_files opf
  where opf.id = p_file_id and opf.production_area_code = area_code
    and public.current_user_assigned_to_production_area(opf.order_id, area_code) for update;
  if not found then raise exception 'No tienes acceso a este archivo de produccion.'; end if;
  if file_row.status = 'completed' then raise exception 'No se puede cambiar el estado de un archivo completado.'; end if;
  if p_next_status = 'in_production' and file_row.status <> 'in_termination' then raise exception 'Solo archivos en terminacion pueden volver a produccion.'; end if;
  if p_next_status = 'completed' and file_row.status <> 'in_termination' then raise exception 'El archivo debe estar en terminacion antes de completarse.'; end if;

  select * into order_row from public.orders where id = file_row.order_id for update;
  if order_row.status in ('cancelled', 'in_Delivered') then raise exception 'La orden ya no esta disponible para produccion.'; end if;

  if p_next_status = 'completed' then
    select not exists (
      select 1 from public.order_production_files opf
      where opf.order_id = file_row.order_id and opf.id <> file_row.id and opf.status <> 'completed'
    ) into is_last_pending_file;
    if is_last_pending_file then
      select * into v_handoff from public.delivery_rework_handoffs
      where order_id = order_row.id and returned_to_delivery_at is null for update;
      if p_delivery_id is null then raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.'; end if;
      if v_handoff.id is not null and p_delivery_id is distinct from v_handoff.returning_delivery_id then
        raise exception 'Esta orden devuelta solo puede reenviarse al Delivery que la devolvio.';
      end if;
      if not exists (
        select 1 from public.profiles p where p.id = p_delivery_id and p.role = 'delivery'
          and p.deleted_at is null and coalesce(p.employment_status, true) = true
      ) then raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.'; end if;
    elsif p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el ultimo archivo.'; end if;
  elsif p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el ultimo archivo.'; end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  if is_last_pending_file then
    update public.orders set delivery_id = p_delivery_id, updated_at = now() where id = order_row.id;
  end if;
  update public.order_production_files set status = p_next_status, updated_by = v_uid, updated_at = now()
  where id = p_file_id returning * into file_row;
  perform public.recalculate_order_production_status(file_row.order_id);
  if is_last_pending_file and v_handoff.id is not null then
    update public.delivery_rework_handoffs set returned_to_delivery_at = now(), returned_to_delivery_by = v_uid
    where id = v_handoff.id and returned_to_delivery_at is null;
    if not found then raise exception 'La devolucion ya no esta activa. Actualiza la orden e intenta nuevamente.'; end if;
  end if;
  return file_row;
end;
$$;

revoke all on function public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz), public.update_production_file_status(uuid,text,uuid) from public, anon;
grant execute on function public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz), public.update_production_file_status(uuid,text,uuid) to authenticated;
