-- An active handoff is an order-level state, but correction notes remain
-- file-level. This read surface is deliberately narrower than the event-item
-- table: it returns return context only to an active producer who already
-- participates in the order, and never exposes recipient identities.
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
  if v_actor is null or p_order_ids is null or cardinality(p_order_ids) = 0 then
    return;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and p.deleted_at is null
    and coalesce(p.employment_status, true) = true;

  if v_role is null or not exists (
    select 1 from public.production_areas pa
    where pa.producer_role = v_role and pa.is_active = true
  ) then
    raise exception 'No tienes acceso a los reingresos de producción.';
  end if;

  return query
  select
    h.order_id,
    h.id,
    h.opened_at,
    h.returning_delivery_id,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'production_file_id', item.production_file_id,
          'filename', coalesce(file.filename, 'Archivo de producción'),
          'reason', item.correction_note,
          'returned_at', item.created_at
        ) order by item.created_at, item.production_file_id
      )
      from public.delivery_rework_event_items item
      left join public.order_production_files file on file.id = item.production_file_id
      where item.event_id = h.event_id
    ), '[]'::jsonb) as returned_files
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

revoke all on function public.get_active_delivery_rework_context(uuid[]) from public, anon, authenticated;
grant execute on function public.get_active_delivery_rework_context(uuid[]) to authenticated;

-- Replaces the handoff return command to notify every active participant in
-- the order. Selected-file recipients receive the actionable notice; other
-- participants receive context only. Both are created atomically with the
-- state transition and the Delivery confirmation is written last.
create or replace function public.delivery_return_completed_files_to_production(
  p_order_id uuid, p_items jsonb, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_delivery_rework_actor(); v_order public.orders; v_item jsonb;
  v_file_ids uuid[] := array[]::uuid[]; v_notes jsonb := '{}'::jsonb; v_file_id uuid; v_note text;
  v_file public.order_production_files; v_recipient uuid; v_event uuid; v_handoff uuid;
  v_returned uuid[] := array[]::uuid[]; v_recipient_ids uuid[] := array[]::uuid[];
  v_participant_ids uuid[] := array[]::uuid[]; v_context_recipient uuid;
begin
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Debes seleccionar al menos un archivo.'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or (v_item - 'file_id' - 'correction_note') <> '{}'::jsonb
       or not (v_item ? 'file_id' and v_item ? 'correction_note') or coalesce(v_item->>'file_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'La devolución de archivos es inválida.';
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
  if coalesce(v_order.is_archived_delivery, false) then raise exception 'La orden está archivada para Delivery.'; end if;
  if v_order.status = 'cancelled' then raise exception 'La orden está cancelada.'; end if;
  if v_order.status <> 'in_Completed' then raise exception 'La orden debe estar completada para devolver archivos a producción.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;

  perform 1 from public.delivery_rework_handoffs
  where order_id = v_order.id and returned_to_delivery_at is null for update;

  for v_file in select * from public.order_production_files where id = any(v_file_ids) order by id for update loop
    if v_file.order_id <> p_order_id or v_file.production_area_code is null then raise exception 'El archivo no pertenece a esta orden o no tiene área.'; end if;
    if v_file.status <> 'completed' then raise exception 'Solo se pueden devolver archivos completados.'; end if;
    v_recipient := public.resolve_delivery_rework_recipient(v_order.id, v_file.production_area_code, v_file.assigned_to);
    v_returned := array_append(v_returned, v_file.id);
  end loop;
  if cardinality(v_returned) <> cardinality(v_file_ids) then raise exception 'Uno o más archivos no existen o no pertenecen a la orden.'; end if;

  -- Resolve all active participants while the order is locked. Only profiles
  -- linked to an assigned file or an assigned production area are included.
  select coalesce(array_agg(distinct participant_id), array[]::uuid[]) into v_participant_ids
  from (
    select opf.assigned_to as participant_id
    from public.order_production_files opf
    join public.production_areas pa on pa.code = opf.production_area_code and pa.is_active
    join public.profiles p on p.id = opf.assigned_to
      and p.role = pa.producer_role and p.deleted_at is null and coalesce(p.employment_status, true) = true
    where opf.order_id = v_order.id and opf.assigned_to is not null
    union
    select assignment.assigned_to as participant_id
    from public.order_production_assignments assignment
    join public.production_areas pa on pa.code = assignment.production_area_code and pa.is_active
    join public.profiles p on p.id = assignment.assigned_to
      and p.role = pa.producer_role and p.deleted_at is null and coalesce(p.employment_status, true) = true
    where assignment.order_id = v_order.id
  ) participants;

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

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[]) into v_recipient_ids
  from public.delivery_rework_event_items where event_id = v_event;
  for v_recipient in select unnest(v_recipient_ids) loop
    perform public.notify_many(array[v_recipient], 'order_returned', 'Archivo devuelto por Delivery',
      'Recibiste archivos devueltos de la orden #' || left(v_order.id::text, 8) || ' para corrección en producción.', v_order.id,
      jsonb_build_object('event_kind','delivery_rework','event_id',v_event,'handoff_id',v_handoff,'order_id',v_order.id,'file_ids',(
        select coalesce(jsonb_agg(production_file_id), '[]'::jsonb) from public.delivery_rework_event_items where event_id=v_event and recipient_id=v_recipient
      ),'deep_link','/production?order=' || v_order.id::text));
  end loop;
  for v_context_recipient in
    select participant_id
    from unnest(v_participant_ids) as participant_id
    where participant_id <> all(v_recipient_ids)
  loop
    perform public.notify_many(array[v_context_recipient], 'order_returned', 'Orden devuelta por Delivery',
      'La orden #' || left(v_order.id::text, 8) || ' fue devuelta a producción. Revisa el contexto de devolución; tus archivos no requieren corrección.', v_order.id,
      jsonb_build_object('event_kind','delivery_rework_context','event_id',v_event,'handoff_id',v_handoff,'order_id',v_order.id,
        'deep_link','/production?order=' || v_order.id::text));
  end loop;
  perform public.notify_many(array[v_actor], 'order_returned', 'Devolución enviada a producción',
    'La devolución de archivos de la orden #' || left(v_order.id::text, 8) || ' se completó correctamente.', v_order.id,
    jsonb_build_object('event_kind','delivery_rework_return_confirmed','event_id',v_event,'handoff_id',v_handoff,'order_id',v_order.id,
      'file_ids',to_jsonb(v_returned),'deep_link','/delivery?order=' || v_order.id::text));

  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object('order', to_jsonb(v_order), 'event_id', v_event, 'handoff_id', v_handoff, 'returned_file_ids', to_jsonb(v_returned));
end;
$$;

revoke all on function public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz) from public, anon;
grant execute on function public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz) to authenticated;
