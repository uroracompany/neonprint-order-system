-- Delivery-owned, selective rework. All writes occur inside the two commands
-- below; browser roles receive no direct write access to the audit tables.

create table public.delivery_rework_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  delivery_id uuid not null references public.profiles(id) on delete restrict,
  event_kind text not null,
  source_order_status text not null,
  target_order_status text not null,
  created_at timestamptz not null default now(),
  constraint delivery_rework_events_transition_check check (
    (event_kind = 'delivery_reverted' and source_order_status = 'in_Delivered' and target_order_status = 'in_Completed')
    or (event_kind = 'files_returned_to_production' and source_order_status = 'in_Completed' and target_order_status = 'in_Production')
  )
);

create table public.delivery_rework_event_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.delivery_rework_events(id) on delete restrict,
  production_file_id uuid not null references public.order_production_files(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id) on delete restrict,
  production_area_code text not null,
  previous_file_status text not null,
  next_file_status text not null,
  correction_note text not null,
  created_at timestamptz not null default now(),
  constraint delivery_rework_event_items_file_transition_check check (previous_file_status = 'completed' and next_file_status = 'in_production'),
  constraint delivery_rework_event_items_note_check check (correction_note = btrim(correction_note) and char_length(correction_note) between 1 and 1000),
  constraint delivery_rework_event_items_event_file_key unique (event_id, production_file_id)
);

create index delivery_rework_events_order_created_idx on public.delivery_rework_events (order_id, created_at desc);
create index delivery_rework_event_items_file_created_idx on public.delivery_rework_event_items (production_file_id, created_at desc);
create index delivery_rework_event_items_recipient_created_idx on public.delivery_rework_event_items (recipient_id, created_at desc);

alter table public.delivery_rework_events enable row level security;
alter table public.delivery_rework_event_items enable row level security;

create policy delivery_rework_events_read_actor_or_admin on public.delivery_rework_events
for select to authenticated using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.deleted_at is null and p.employment_status is distinct from false
    and ((p.role = 'delivery' and p.id = delivery_id) or p.role = 'admin'))
);

create policy delivery_rework_event_items_read_exact_recipient_or_actor_or_admin on public.delivery_rework_event_items
for select to authenticated using (
  (recipient_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.deleted_at is null and p.employment_status is distinct from false))
  or exists (select 1 from public.delivery_rework_events e join public.profiles p on p.id = auth.uid()
             where e.id = event_id and p.deleted_at is null and p.employment_status is distinct from false
               and ((p.role = 'delivery' and e.delivery_id = p.id) or p.role = 'admin'))
);

revoke all on public.delivery_rework_events, public.delivery_rework_event_items from public, anon, authenticated;
grant select on public.delivery_rework_events, public.delivery_rework_event_items to authenticated;

create or replace function public.require_active_delivery_rework_actor()
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'delivery'
      and p.deleted_at is null and p.employment_status is distinct from false
  ) then raise exception 'Solo Delivery activo puede devolver una orden.'; end if;
  return v_actor;
end;
$$;

create or replace function public.resolve_delivery_rework_recipient(
  p_order_id uuid, p_area_code text, p_file_assigned_to uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_recipient uuid; v_assignment_count integer := 0; v_expected_role text; v_assignment record; v_profile public.profiles%rowtype;
begin
  select pa.producer_role into v_expected_role from public.production_areas pa
  where pa.code = p_area_code and pa.is_active = true;
  if v_expected_role is null then raise exception 'El archivo no tiene un area de produccion activa.'; end if;

  -- An explicit, valid file assignee is authoritative. Lock that profile for
  -- the complete transaction; a changing area-level assignment must not
  -- silently redirect a correction intended for this individual.
  if p_file_assigned_to is not null then
    select * into v_profile from public.profiles p where p.id = p_file_assigned_to for update;
    if not found or v_profile.role <> v_expected_role or v_profile.deleted_at is not null
       or v_profile.employment_status is false then
      raise exception 'El responsable explicito del archivo no es un productor activo de su area.';
    end if;
    return v_profile.id;
  end if;

  -- Lock every live area assignment and its profile before deciding the sole
  -- fallback recipient. This lock remains held through audit persistence and
  -- directed notification, so reassignment cannot race a correction batch.
  for v_assignment in
    select opa.assigned_to from public.order_production_assignments opa
    where opa.order_id = p_order_id and opa.production_area_code = p_area_code
    for update
  loop
    select * into v_profile from public.profiles p where p.id = v_assignment.assigned_to for update;
    if found and v_profile.role = v_expected_role and v_profile.deleted_at is null
       and v_profile.employment_status is distinct from false then
      v_assignment_count := v_assignment_count + 1;
      v_recipient := v_profile.id;
    end if;
  end loop;
  if v_assignment_count <> 1 then raise exception 'La asignacion de produccion debe tener exactamente un responsable activo.'; end if;
  return v_recipient;
end;
$$;

revoke all on function public.require_active_delivery_rework_actor() from public, anon, authenticated;
revoke all on function public.resolve_delivery_rework_recipient(uuid,text,uuid) from public, anon, authenticated;

create or replace function public.delivery_revert_order_to_completed(
  p_order_id uuid, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_delivery_rework_actor(); v_order public.orders; v_event uuid;
begin
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.delivery_id is distinct from v_actor then raise exception 'No tienes asignada esta orden.'; end if;
  if coalesce(v_order.is_archived_delivery, false) then raise exception 'La orden esta archivada para Delivery.'; end if;
  if v_order.status = 'cancelled' then raise exception 'La orden esta cancelada.'; end if;
  if v_order.status <> 'in_Delivered' then raise exception 'La orden debe estar entregada para devolverla a completada.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command', 'delivery_rework', true);
  update public.orders set status = 'in_Completed', updated_at = now(), updated_by = v_actor where id = v_order.id returning * into v_order;
  insert into public.delivery_rework_events(order_id, delivery_id, event_kind, source_order_status, target_order_status)
  values (v_order.id, v_actor, 'delivery_reverted', 'in_Delivered', 'in_Completed') returning id into v_event;
  return jsonb_build_object('order', to_jsonb(v_order), 'event_id', v_event);
end;
$$;

create or replace function public.delivery_return_completed_files_to_production(
  p_order_id uuid, p_items jsonb, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := public.require_active_delivery_rework_actor(); v_order public.orders; v_item jsonb;
  v_file_ids uuid[] := array[]::uuid[]; v_notes jsonb := '{}'::jsonb; v_file_id uuid; v_note text;
  v_file public.order_production_files; v_recipient uuid; v_event uuid; v_returned uuid[] := array[]::uuid[]; v_recipient_ids uuid[];
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

  -- Lock and validate every requested file and every recipient before writes.
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
  for v_file in select * from public.order_production_files where id = any(v_file_ids) order by id loop
    v_recipient := public.resolve_delivery_rework_recipient(v_order.id, v_file.production_area_code, v_file.assigned_to);
    insert into public.delivery_rework_event_items(event_id, production_file_id, recipient_id, production_area_code, previous_file_status, next_file_status, correction_note)
    values (v_event, v_file.id, v_recipient, v_file.production_area_code, 'completed', 'in_production', v_notes->>v_file.id::text);
  end loop;
  update public.order_production_files set status = 'in_production', updated_by = v_actor, updated_at = now() where id = any(v_file_ids);
  perform public.recalculate_order_production_status(v_order.id);
  select array_agg(distinct recipient_id) into v_recipient_ids from public.delivery_rework_event_items where event_id = v_event;
  for v_recipient in select unnest(v_recipient_ids) loop
    perform public.notify_many(array[v_recipient], 'delivery_rework', 'Archivo devuelto por Delivery',
      'Un archivo de la orden #' || left(v_order.id::text, 8) || ' fue devuelto a produccion.', v_order.id,
      jsonb_build_object('event_kind','delivery_rework','event_id',v_event,'order_id',v_order.id,'file_ids',(
        select coalesce(jsonb_agg(production_file_id), '[]'::jsonb) from public.delivery_rework_event_items where event_id=v_event and recipient_id=v_recipient
      ),'deep_link','/production?order=' || v_order.id::text));
  end loop;
  select * into v_order from public.orders where id = v_order.id;
  return jsonb_build_object('order', to_jsonb(v_order), 'event_id', v_event, 'returned_file_ids', to_jsonb(v_returned));
end;
$$;

revoke all on function public.delivery_revert_order_to_completed(uuid,timestamptz), public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz) from public, anon;
grant execute on function public.delivery_revert_order_to_completed(uuid,timestamptz), public.delivery_return_completed_files_to_production(uuid,jsonb,timestamptz) to authenticated;

-- Preserve the current notification implementation and only suppress its broad
-- status fan-out. Its audit/order-event insert continues to run unchanged.
do $$
declare v_definition text; v_patched_definition text;
begin
  select pg_get_functiondef('public.handle_order_change_notification()'::regprocedure) into v_definition;
  v_patched_definition := regexp_replace(
    v_definition,
    E'if\\s+new\\.status\\s+is\\s+distinct\\s+from\\s+old\\.status\\s+and\\s+new\\.status\\s+not\\s+in',
    E'if current_setting(''app.neonprint_order_command'', true) is distinct from ''delivery_rework'' and new.status is distinct from old.status and new.status not in',
    'i'
  );
  if v_patched_definition = v_definition then
    raise exception 'Cannot safely patch handle_order_change_notification for delivery rework';
  end if;
  execute v_patched_definition;
end;
$$;

-- Copy the effective protected-column guard and add only the two rework paths.
create or replace function public.guard_orders_direct_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_command text := current_setting('app.neonprint_order_command', true);
  v_has_command_context boolean := v_command in ('on', 'delivery_rework') or nullif(current_setting('app.admin_intervention_context', true), '') is not null;
begin
  if not v_has_command_context and (
    new.created_by is distinct from old.created_by or new.seller_id is distinct from old.seller_id or new.designer_id is distinct from old.designer_id or new.quote_id is distinct from old.quote_id or new.production_id is distinct from old.production_id or new.delivery_id is distinct from old.delivery_id or new.status is distinct from old.status or new.payment_status is distinct from old.payment_status or new.invoice_payment is distinct from old.invoice_payment or new.client_id is distinct from old.client_id or new.client_name is distinct from old.client_name or new.client_contact is distinct from old.client_contact or new.invoice_number is distinct from old.invoice_number or new.description is distinct from old.description or new.material is distinct from old.material or new.termination_type is distinct from old.termination_type or new.order_type is distinct from old.order_type or new.order_design_type is distinct from old.order_design_type or new.delivery_date is distinct from old.delivery_date or new.order_file_url is distinct from old.order_file_url or new.preview_image is distinct from old.preview_image or new.reference_images is distinct from old.reference_images or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_from_status is distinct from old.cancelled_from_status or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by or new.return_reason is distinct from old.return_reason or new.returned_to_designer_at is distinct from old.returned_to_designer_at or new.delivery_note is distinct from old.delivery_note or new.operational_status is distinct from old.operational_status or new.blocked_reason_category is distinct from old.blocked_reason_category or new.blocked_reason_detail is distinct from old.blocked_reason_detail or new.blocked_owner_id is distinct from old.blocked_owner_id or new.blocked_by is distinct from old.blocked_by or new.blocked_at is distinct from old.blocked_at or new.blocked_expected_resolution_at is distinct from old.blocked_expected_resolution_at or new.commercial_review_required is distinct from old.commercial_review_required or new.status_changed_at is distinct from old.status_changed_at or new.last_admin_intervention_at is distinct from old.last_admin_intervention_at or new.last_admin_intervention_by is distinct from old.last_admin_intervention_by or new.last_admin_intervention_kind is distinct from old.last_admin_intervention_kind or new.is_archived is distinct from old.is_archived or new.is_archived_designer is distinct from old.is_archived_designer or new.is_archived_quote is distinct from old.is_archived_quote or new.is_archived_delivery is distinct from old.is_archived_delivery or new.is_archived_admin is distinct from old.is_archived_admin or new.updated_by is distinct from old.updated_by
  ) then raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden'; end if;
  if v_command = 'delivery_rework' and not (
    (old.status = 'in_Delivered' and new.status = 'in_Completed') or
    (old.status = 'in_Completed' and new.status = 'in_Production') or
    (old.status = 'in_Production' and new.status = 'in_Production')
  ) then raise exception 'ORDER_PROTECTED_UPDATE: transicion Delivery no permitida'; end if;
  if new.status = 'in_Production' and new.status is distinct from old.status
     and old.status is distinct from 'in_Quote'
     and not ((old.status = 'in_Termination' and v_command = 'on') or (old.status = 'in_Completed' and v_command = 'delivery_rework')) then
    raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_orders_direct_update() from public, anon, authenticated;
