-- Semi-Administrador operational role.
-- This role is deliberately separate from administrator capabilities: it can
-- coordinate orders, but cannot use any admin_* command or client directory.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'admin','semi_admin','seller','designer','quote','printer',
  'digital_producer','dtf_producer','ploteo_producer','delivery'
)) not valid;

create or replace function public.current_profile_is_semi_admin()
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid()
    and p.role = 'semi_admin' and coalesce(p.employment_status, true)
    and p.deleted_at is null)
$$;

create or replace function public.current_profile_is_order_operator()
returns boolean language sql stable security invoker set search_path = public as $$
  select public.current_profile_is_semi_admin()
$$;

revoke all on function public.current_profile_is_semi_admin(), public.current_profile_is_order_operator() from public, anon;
grant execute on function public.current_profile_is_semi_admin(), public.current_profile_is_order_operator() to authenticated;

-- Global order read for the workbench. Admin remains the only global reader
-- through current_profile_is_admin(); sellers and production roles retain the
-- existing assignment predicates.
drop policy if exists orders_select_by_role on public.orders;
create policy orders_select_by_role on public.orders for select to authenticated using (
  public.current_profile_is_admin() or public.current_profile_is_order_operator()
  or (select auth.uid()) in (created_by, seller_id, designer_id, quote_id, delivery_id)
  or public.producer_can_access_order(id)
);

drop policy if exists order_production_files_select_by_role on public.order_production_files;
create policy order_production_files_select_by_role on public.order_production_files for select to authenticated using (
  public.current_profile_is_admin() or public.current_profile_is_order_operator()
  or public.current_user_assigned_to_production_area(order_id, production_area_code)
  or exists (select 1 from public.orders o where o.id = order_production_files.order_id
    and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id))
);

drop policy if exists order_production_assignments_select_assigned on public.order_production_assignments;
create policy order_production_assignments_select_assigned on public.order_production_assignments for select to authenticated using (
  public.current_profile_is_admin() or public.current_profile_is_order_operator()
  or assigned_to = (select auth.uid())
  or exists (select 1 from public.orders o where o.id = order_production_assignments.order_id
    and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id))
);

drop policy if exists order_events_select_by_order_access on public.order_events;
create policy order_events_select_by_order_access on public.order_events for select to authenticated using (
  public.current_profile_is_admin() or public.current_profile_is_order_operator()
  or exists (select 1 from public.orders o where o.id = order_events.order_id
    and ((select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
      or public.producer_can_access_order(o.id)))
);

drop policy if exists order_files_select_by_order_access on public.order_files;
create policy order_files_select_by_order_access on public.order_files for select to authenticated using (
  public.current_profile_is_admin() or public.current_profile_is_order_operator()
  or exists (select 1 from public.orders o where o.id = order_files.order_id
    and ((select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
      or public.producer_can_access_order(o.id)
      or (public.current_profile_role() = 'delivery' and o.status in ('in_Completed','in_Delivered'))))
);

-- Operators can only mutate file metadata through commands. They never gain
-- direct table DML or the existing delete policy.
drop policy if exists order_files_insert_by_order_access on public.order_files;
create policy order_files_insert_by_order_access on public.order_files for insert to authenticated with check (
  public.current_profile_is_admin() or (public.current_profile_is_order_operator() and false)
  or exists (select 1 from public.orders o where o.id = order_files.order_id
    and (select auth.uid()) in (o.created_by, o.seller_id, o.designer_id, o.quote_id)
    and o.status not in ('in_Production','in_Termination','in_Completed','in_Delivered','cancelled'))
);

-- Direct DML is disabled by the existing hardening migration. Keep the
-- explicit negative policy to make the boundary clear for installations where
-- grants are restored during a migration.
drop policy if exists order_files_delete_admin_only on public.order_files;
create policy order_files_delete_admin_only on public.order_files for delete to authenticated using (public.current_profile_is_admin());

create or replace function public.require_active_semi_admin_actor()
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public.profiles p where p.id = v_actor
    and p.role = 'semi_admin' and coalesce(p.employment_status, true) and p.deleted_at is null) then
    raise exception 'Solo un Semi-Administrador activo puede operar ordenes.';
  end if;
  return v_actor;
end $$;
revoke all on function public.require_active_semi_admin_actor() from public, anon, authenticated;

create or replace function public.notify_semi_admin_order_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.actor_id is not null and new.event_type like 'semi_admin_%'
     and exists (select 1 from public.profiles p where p.id = new.actor_id and p.role = 'semi_admin') then
    insert into public.notifications(user_id, type, title, message, order_id, metadata)
    values(new.actor_id, 'info', 'Acción confirmada',
      'Tu acción operativa fue registrada en la orden.', new.order_id,
      jsonb_build_object('event_type', new.event_type, 'actor_id', new.actor_id));
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_semi_admin_order_event on public.order_events;
create trigger trg_notify_semi_admin_order_event
  after insert on public.order_events
  for each row execute function public.notify_semi_admin_order_event();
revoke all on function public.notify_semi_admin_order_event() from public, anon, authenticated;

-- Atomic client reuse/creation plus order creation. No INSERT privilege on
-- clients is granted to this role; the function is the only write surface.
create or replace function public.semi_admin_create_order_with_client(
  p_idempotency_key uuid, p_order jsonb, p_client jsonb default null,
  p_production_files jsonb default '[]'::jsonb, p_asset_refs jsonb default '[]'::jsonb
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor();
  v_client_id uuid; v_order public.orders; v_order_id uuid; v_file jsonb; v_asset jsonb;
  v_hash text; v_command public.order_creation_commands%rowtype; v_reservation public.order_asset_preupload_reservations%rowtype;
  v_materials text[]; v_termination text;
begin
  if p_idempotency_key is null or jsonb_typeof(coalesce(p_order,'{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_production_files,'[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_asset_refs,'[]'::jsonb)) <> 'array' then raise exception 'Solicitud de creacion invalida'; end if;
  v_hash := md5(coalesce(p_order,'{}'::jsonb)::text || coalesce(p_client,'null'::jsonb)::text || coalesce(p_production_files,'[]'::jsonb)::text || coalesce(p_asset_refs,'[]'::jsonb)::text);
  select * into v_command from public.order_creation_commands
    where actor_id = v_actor and idempotency_key = p_idempotency_key for update;
  if found then
    if v_command.request_hash <> v_hash then raise exception 'ORDER_IDEMPOTENCY_CONFLICT'; end if;
    if v_command.status = 'completed' and v_command.order_id is not null then
      select * into v_order from public.orders where id = v_command.order_id;
      return v_order;
    end if;
    raise exception 'ORDER_CREATION_IN_PROGRESS';
  end if;
  insert into public.order_creation_commands(actor_id,idempotency_key,request_hash)
    values(v_actor,p_idempotency_key,v_hash);
  v_client_id := nullif(p_order->>'client_id','')::uuid;
  if v_client_id is null and jsonb_typeof(coalesce(p_client,'null'::jsonb)) = 'object' then
    if nullif(trim(p_client->>'name'),'') is null or nullif(trim(p_client->>'phone'),'') is null then
      raise exception 'El nuevo cliente requiere nombre y teléfono.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      lower(trim(p_client->>'name')) || '|' || regexp_replace(p_client->>'phone', '\D', '', 'g'), 0));
    select c.id into v_client_id from public.clients c
      where c.deleted_at is null and lower(trim(c.name)) = lower(trim(p_client->>'name'))
        and regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_client->>'phone', '\D', '', 'g')
      limit 1 for update;
    if v_client_id is null then
      insert into public.clients(name, phone, email, address, notes, created_by)
      values (trim(p_client->>'name'), trim(p_client->>'phone'), nullif(trim(p_client->>'email'),''),
        nullif(trim(p_client->>'address'),''), nullif(trim(p_client->>'notes'),''), v_actor)
      returning id into v_client_id;
    end if;
  end if;
  if v_client_id is null or not exists (select 1 from public.clients c where c.id=v_client_id and c.deleted_at is null) then
    raise exception 'Cada orden debe tener un cliente registrado activo.';
  end if;
  v_order_id := coalesce(nullif(p_order->>'id','')::uuid, gen_random_uuid());
  perform set_config('app.neonprint_order_command','on',true);
  insert into public.orders(id, client_id, client_name, client_contact, invoice_number, description, material,
    termination_type, order_type, order_design_type, delivery_date, status, payment_status, seller_id, created_by,
    order_file_url, preview_image, reference_images, updated_by)
  values (v_order_id, v_client_id, p_order->>'client_name', nullif(p_order->>'client_contact',''), p_order->>'invoice_number',
    p_order->>'description', p_order->>'material', nullif(p_order->>'termination_type',''), p_order->>'order_type',
    p_order->>'order_design_type', nullif(p_order->>'delivery_date','')::date, 'Pending', 'Pending_Payment', v_actor, v_actor,
    p_order->>'order_file_url', p_order->>'preview_image', coalesce(p_order->'reference_images','[]'::jsonb), v_actor)
  returning * into v_order;
  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null
       or nullif(trim(v_file->>'public_label'), '') is null
       or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (select 1 from public.production_areas
      where code = trim(v_file->>'production_area_code') and is_active = true) then
      raise exception 'Área de producción inválida.';
    end if;
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_file->'material_names','[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file->>'termination_name'),'');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;
    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code, material_names, termination_name, status, created_by, updated_by
    ) values (
      v_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'),
      trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), v_materials, v_termination, 'pending', v_actor, v_actor
    );
  end loop;
  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs,'[]'::jsonb)) loop
    if nullif(trim(v_asset->>'bucket'),'') is null
       or nullif(trim(v_asset->>'objectKey'),'') is null
       or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
       or coalesce(v_asset->>'category','') not in ('design','preview','reference')
       or coalesce(v_asset->>'provider','') not in ('supabase','r2')
       or (v_asset->>'provider')='supabase' and v_asset->>'bucket' not in ('order-docs','order-previews')
       or nullif(trim(v_asset->>'reservationId'),'') is null then
      raise exception 'Referencia de archivo previo inválida.';
    end if;
    select * into v_reservation from public.order_asset_preupload_reservations
      where id = nullif(v_asset->>'reservationId','')::uuid
        and actor_id=v_actor and order_id=v_order_id and idempotency_key=p_idempotency_key
        and provider=v_asset->>'provider' and bucket=trim(v_asset->>'bucket')
        and object_key=trim(v_asset->>'objectKey') and category=v_asset->>'category'
        and status='reserved' and expires_at > now() for update;
    if not found then raise exception 'La reserva del archivo previo no es válida o expiró.'; end if;
    insert into public.order_files(order_id,provider,bucket,object_key,original_filename,content_type,size_bytes,category,status,uploaded_by)
      values(v_order_id,v_asset->>'provider',trim(v_asset->>'bucket'),trim(v_asset->>'objectKey'),
        nullif(trim(v_asset->>'originalFilename'),''),nullif(trim(v_asset->>'contentType'),''),
        nullif(v_asset->>'sizeBytes','')::bigint,v_asset->>'category','uploaded',v_actor)
      on conflict(provider,bucket,object_key) do nothing;
    update public.order_asset_preupload_reservations set status='bound', bound_at=now() where id=v_reservation.id;
  end loop;
  update public.order_creation_commands set order_id=v_order_id,status='completed',updated_at=now()
    where actor_id=v_actor and idempotency_key=p_idempotency_key;
  insert into public.order_events(order_id, actor_id, event_type, changes)
    values (v_order.id, v_actor, 'semi_admin_order_created', jsonb_build_object('role','semi_admin','client_id',v_client_id));
  return v_order;
end $$;

-- Narrow command surface for foreign-order operations. The command performs
-- ownership/client immutability checks before any write and records an event.
create or replace function public.semi_admin_update_order(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders; v_key text; v_file jsonb;
  v_foreign boolean; v_materials text[]; v_termination text;
begin
  if jsonb_typeof(coalesce(p_changes,'{}'::jsonb)) <> 'object' then raise exception 'Solicitud de edicion invalida.'; end if;
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_old.status in ('in_Quote','cancelled','in_Delivered') then
    raise exception 'La orden no puede editarse en su estado actual.';
  end if;
  v_foreign := v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('client_id','client_name','client_contact','invoice_number','description','material','termination_type','delivery_date','order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %',v_key; end if;
    if v_foreign and v_key in ('client_id','client_name','client_contact') then raise exception 'No puedes cambiar el cliente de una orden ajena.'; end if;
  end loop;
  if p_changes ? 'client_id' and not exists (select 1 from public.clients c where c.id=nullif(p_changes->>'client_id','')::uuid and c.deleted_at is null) then raise exception 'Selecciona un cliente registrado activo.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set client_id=case when p_changes ? 'client_id' then nullif(p_changes->>'client_id','')::uuid else client_id end,
    client_name=case when p_changes ? 'client_name' then p_changes->>'client_name' else client_name end,
    client_contact=case when p_changes ? 'client_contact' then p_changes->>'client_contact' else client_contact end,
    invoice_number=case when p_changes ? 'invoice_number' then p_changes->>'invoice_number' else invoice_number end,
    description=case when p_changes ? 'description' then p_changes->>'description' else description end,
    material=case when p_changes ? 'material' then p_changes->>'material' else material end,
    termination_type=case when p_changes ? 'termination_type' then p_changes->>'termination_type' else termination_type end,
    delivery_date=case when p_changes ? 'delivery_date' then nullif(p_changes->>'delivery_date','')::date else delivery_date end,
    order_file_url=case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,
    preview_image=case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
    reference_images=case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,
    updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  for v_file in select value from jsonb_array_elements(coalesce(p_new_production_files, '[]'::jsonb)) loop
    if nullif(trim(v_file->>'url'), '') is null
       or nullif(trim(v_file->>'public_label'), '') is null
       or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (select 1 from public.production_areas
      where code = trim(v_file->>'production_area_code') and is_active = true) then
      raise exception 'Área de producción inválida.';
    end if;
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_file->'material_names','[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file->>'termination_name'),'');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;
    insert into public.order_production_files(
      order_id, url, filename, public_label, production_area_code, material_names, termination_name, status, created_by, updated_by
    ) values (
      p_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'),
      trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), v_materials, v_termination, 'pending', v_actor, v_actor
    ) on conflict (order_id, url) do update set
      filename = excluded.filename, public_label = excluded.public_label,
      production_area_code = excluded.production_area_code, material_names = excluded.material_names,
      termination_name = excluded.termination_name, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values (p_order_id,v_actor,'semi_admin_order_updated',v_old.status,v_new.status,jsonb_build_object('changes',p_changes,'foreign_order',v_foreign));
  return v_new;
end $$;

create or replace function public.semi_admin_transition_order(
  p_order_id uuid, p_action text, p_target_user_id uuid default null,
  p_reason text default null, p_expected_updated_at timestamptz default null
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders; v_target_role text;
begin
  if p_action not in ('send_to_designer','send_to_quote','cancel','archive') then
    raise exception 'Acción de orden no permitida.';
  end if;
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if p_action in ('send_to_designer','send_to_quote') then
    select role into v_target_role from public.profiles where id=p_target_user_id and coalesce(employment_status,true) and deleted_at is null;
    if p_action='send_to_designer' and v_target_role <> 'designer' then raise exception 'Selecciona un diseñador activo.'; end if;
    if p_action='send_to_quote' and v_target_role <> 'quote' then raise exception 'Selecciona un usuario de Caja activo.'; end if;
  end if;
  if p_action='send_to_designer' and v_old.status not in ('Pending','pending') then raise exception 'La orden debe estar en Ventas antes de enviarse a Diseño.'; end if;
  if p_action='send_to_quote' and (v_old.status not in ('Pending','pending') or v_old.order_design_type <> 'EXTERNAL_DESING') then raise exception 'La orden no es elegible para enviarse a Caja.'; end if;
  if p_action='cancel' and nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Debes indicar el motivo de cancelación.'; end if;
  if p_action='cancel' and v_old.payment_status in ('parcial','pagado','credito') then raise exception 'La orden no puede cancelarse con pago confirmado.'; end if;
  if p_action='archive' and (v_old.payment_status='parcial' or v_old.status not in ('cancelled','in_Completed','in_Delivered')) then raise exception 'La orden no puede archivarse.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set
    status=case when p_action='send_to_designer' then 'in_Design' when p_action='send_to_quote' then 'in_Quote' when p_action='cancel' then 'cancelled' else status end,
    designer_id=case when p_action='send_to_designer' then p_target_user_id else designer_id end,
    quote_id=case when p_action='send_to_quote' then p_target_user_id else quote_id end,
    cancellation_reason=case when p_action='cancel' then trim(p_reason) else cancellation_reason end,
    is_archived=case when p_action='archive' then true else is_archived end,
    updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
    values (p_order_id,v_actor,'semi_admin_'||p_action,v_old.status,v_new.status,jsonb_build_object('target_user_id',p_target_user_id,'reason',p_reason));
  return v_new;
end $$;

create or replace function public.semi_admin_send_order_to_designer(uuid, uuid, timestamptz)
returns public.orders language sql security definer set search_path = public as $$ select public.semi_admin_transition_order($1,'send_to_designer',$2,null,$3) $$;
create or replace function public.semi_admin_send_order_to_quote(uuid, uuid, timestamptz)
returns public.orders language sql security definer set search_path = public as $$ select public.semi_admin_transition_order($1,'send_to_quote',$2,null,$3) $$;
create or replace function public.semi_admin_cancel_order(uuid, text, timestamptz)
returns public.orders language sql security definer set search_path = public as $$ select public.semi_admin_transition_order($1,'cancel',null,$2,$3) $$;
create or replace function public.semi_admin_set_order_archive(uuid, boolean, timestamptz)
returns public.orders language sql security definer set search_path = public as $$ select public.semi_admin_transition_order($1,'archive',null,null,$3) $$;

create or replace function public.semi_admin_update_production_file_status(
  p_file_id uuid, p_next_status text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_is_last boolean;
begin
  select * into v_file from public.order_production_files where id=p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id=v_file.order_id for update;
  if coalesce(v_order.is_archived,false) or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled','in_Delivered') then
    raise exception 'La orden ya no está disponible para producción.';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not (
    (v_file.status = 'pending' and p_next_status = 'in_production')
    or (v_file.status = 'in_production' and p_next_status = 'in_termination')
    or (v_file.status = 'in_termination' and p_next_status in ('in_production','completed'))
    or (v_file.status = p_next_status)
  ) then raise exception 'Transición de archivo no permitida.'; end if;
  if p_next_status = 'completed' then
    select not exists (select 1 from public.order_production_files where order_id=v_order.id and id<>v_file.id and status<>'completed') into v_is_last;
    if v_is_last and not exists (select 1 from public.profiles where id=p_delivery_id and role='delivery' and coalesce(employment_status,true) and deleted_at is null) then
      raise exception 'Selecciona un usuario Delivery activo para completar el último archivo.';
    end if;
    if not v_is_last and p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el último archivo.'; end if;
  elsif p_delivery_id is not null then raise exception 'El Delivery solo se asigna al completar el último archivo.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  if v_is_last then update public.orders set delivery_id=p_delivery_id, updated_at=now(), updated_by=v_actor where id=v_order.id; end if;
  update public.order_production_files set status=p_next_status, updated_by=v_actor, updated_at=now() where id=p_file_id returning * into v_file;
  perform public.recalculate_order_production_status(v_order.id);
  insert into public.order_events(order_id,actor_id,event_type,changes) values(v_order.id,v_actor,'semi_admin_production_file_status',jsonb_build_object('file_id',p_file_id,'status',p_next_status));
  return v_file;
end $$;

create or replace function public.semi_admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
) returns public.order_production_files language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_file public.order_production_files; v_order public.orders; v_role text;
begin
  select * into v_file from public.order_production_files where id=p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  select * into v_order from public.orders where id=v_file.order_id for update;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled','in_Delivered') then
    raise exception 'La orden ya no está disponible para reasignación de producción.';
  end if;
  if not exists(select 1 from public.production_areas where code=p_new_area_code and is_active) then raise exception 'Selecciona un área activa.'; end if;
  select p.role into v_role
    from public.profiles p
    join public.production_areas a on a.code=p_new_area_code and a.producer_role=p.role and a.is_active=true
    where p.id=p_new_assigned_user_id and coalesce(p.employment_status,true) and p.deleted_at is null;
  if v_role is null then raise exception 'Selecciona un operador activo.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.order_production_files set production_area_code=p_new_area_code, assigned_to=p_new_assigned_user_id, updated_by=v_actor, updated_at=now() where id=p_file_id returning * into v_file;
  insert into public.order_events(order_id,actor_id,event_type,changes) values(v_order.id,v_actor,'semi_admin_production_file_reassigned',jsonb_build_object('file_id',p_file_id,'area',p_new_area_code,'assigned_to',p_new_assigned_user_id));
  return v_file;
end $$;

create or replace function public.semi_admin_save_order_production_file_specifications(
  p_order_id uuid, p_expected_updated_at timestamptz, p_specifications jsonb
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_order public.orders; v_spec jsonb; v_file public.order_production_files;
  v_materials text[]; v_area text; v_termination text;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived,false) or v_order.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_order.status in ('in_Production','in_Termination','in_Completed','in_Delivered','cancelled') then raise exception 'La orden no admite cambios de especificaciones en este estado.'; end if;
  if jsonb_typeof(coalesce(p_specifications,'[]'::jsonb)) <> 'array' then raise exception 'Especificaciones inválidas.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  for v_spec in select value from jsonb_array_elements(p_specifications) loop
    v_area := nullif(trim(v_spec->>'production_area_code'),'');
    v_termination := nullif(trim(v_spec->>'termination_name'),'');
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_spec->'material_names','[]'::jsonb)) as item(value);
    if v_area is null or v_termination is null or cardinality(v_materials) is null or cardinality(v_materials) = 0 then
      raise exception 'Cada archivo debe tener área, material y terminación.';
    end if;
    if not exists (select 1 from public.production_areas where code=v_area and is_active=true) then
      raise exception 'Selecciona un área de producción activa.';
    end if;
    update public.order_production_files set public_label=coalesce(nullif(trim(v_spec->>'public_label'),''),public_label), production_area_code=v_area, material_names=v_materials, termination_name=v_termination, updated_by=v_actor, updated_at=now()
      where order_id=p_order_id and url=trim(v_spec->>'url') returning * into v_file;
    if not found then raise exception 'El archivo no pertenece a esta orden.'; end if;
  end loop;
  perform public.recalculate_order_production_status(p_order_id);
  select * into v_order from public.orders where id=p_order_id;
  update public.orders set updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_order;
  insert into public.order_events(order_id,actor_id,event_type,changes) values(p_order_id,v_actor,'semi_admin_file_specifications_updated',jsonb_build_object('count',jsonb_array_length(p_specifications)));
  return v_order;
end $$;

create or replace function public.semi_admin_set_order_payment(
  p_order_id uuid, p_payment_status text, p_invoice_payment text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders;
begin
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_old.status <> 'in_Quote' or coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then raise exception 'El pago solo puede modificarse en Caja.'; end if;
  if p_payment_status not in ('Pending_Payment','parcial','pagado') then raise exception 'Estado de pago inválido.'; end if;
  if v_old.payment_status='parcial' and p_payment_status='Pending_Payment' then raise exception 'Transición de pago no permitida.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status=p_payment_status, invoice_payment=case when p_payment_status='parcial' then null else coalesce(p_invoice_payment,invoice_payment) end, updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id,actor_id,event_type,old_payment_status,new_payment_status,changes) values(p_order_id,v_actor,'semi_admin_payment_updated',v_old.payment_status,v_new.payment_status,'{}'::jsonb);
  return v_new;
end $$;

create or replace function public.semi_admin_mark_order_credit(
  p_order_id uuid, p_due_date timestamptz, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders;
begin
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_old.status <> 'in_Quote' or v_old.payment_status <> 'Pending_Payment' or v_old.client_id is null or nullif(trim(v_old.invoice_number),'') is null then raise exception 'La orden no es elegible para crédito.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status='credito', invoice_payment=null, updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.accounts_receivable(order_id,client_id,invoice_number,status,issued_at,due_date,created_by) values(p_order_id,v_new.client_id,v_new.invoice_number,'open',now(),p_due_date,v_actor) on conflict(order_id) do update set due_date=excluded.due_date,status='open',updated_at=now();
  insert into public.order_events(order_id,actor_id,event_type,old_payment_status,new_payment_status,changes) values(p_order_id,v_actor,'semi_admin_credit_granted',v_old.payment_status,'credito',jsonb_build_object('due_date',p_due_date));
  return v_new;
end $$;

create or replace function public.semi_admin_mark_order_delivered(
  p_order_id uuid, p_delivery_note text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := public.require_active_semi_admin_actor(); v_old public.orders; v_new public.orders;
begin
  select * into v_old from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived,false) or v_old.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada para operaciones.';
  end if;
  if v_old.status <> 'in_Completed' then raise exception 'La orden debe estar completada antes de entregarse.'; end if;
  if v_old.payment_status not in ('pagado','credito') then raise exception 'La orden debe estar pagada o a crédito antes de entregarse.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Delivered', delivery_note=nullif(trim(p_delivery_note),''), updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_new;
  insert into public.order_events(order_id,actor_id,event_type,old_status,new_status,changes) values(p_order_id,v_actor,'semi_admin_order_delivered',v_old.status,v_new.status,'{}'::jsonb);
  return v_new;
end $$;

revoke all on function public.semi_admin_transition_order(uuid,text,uuid,text,timestamptz), public.semi_admin_send_order_to_designer(uuid,uuid,timestamptz), public.semi_admin_send_order_to_quote(uuid,uuid,timestamptz), public.semi_admin_cancel_order(uuid,text,timestamptz), public.semi_admin_set_order_archive(uuid,boolean,timestamptz), public.semi_admin_update_production_file_status(uuid,text,timestamptz,uuid), public.semi_admin_reassign_file_production_area(uuid,text,uuid,timestamptz), public.semi_admin_save_order_production_file_specifications(uuid,timestamptz,jsonb), public.semi_admin_set_order_payment(uuid,text,text,timestamptz), public.semi_admin_mark_order_credit(uuid,timestamptz,timestamptz), public.semi_admin_mark_order_delivered(uuid,text,timestamptz) from public, anon;
grant execute on function public.semi_admin_transition_order(uuid,text,uuid,text,timestamptz), public.semi_admin_send_order_to_designer(uuid,uuid,timestamptz), public.semi_admin_send_order_to_quote(uuid,uuid,timestamptz), public.semi_admin_cancel_order(uuid,text,timestamptz), public.semi_admin_set_order_archive(uuid,boolean,timestamptz), public.semi_admin_update_production_file_status(uuid,text,timestamptz,uuid), public.semi_admin_reassign_file_production_area(uuid,text,uuid,timestamptz), public.semi_admin_save_order_production_file_specifications(uuid,timestamptz,jsonb), public.semi_admin_set_order_payment(uuid,text,text,timestamptz), public.semi_admin_mark_order_credit(uuid,timestamptz,timestamptz), public.semi_admin_mark_order_delivered(uuid,text,timestamptz) to authenticated;

revoke all on function public.semi_admin_create_order_with_client(uuid,jsonb,jsonb,jsonb,jsonb), public.semi_admin_update_order(uuid,timestamptz,jsonb,jsonb) from public, anon;
grant execute on function public.semi_admin_create_order_with_client(uuid,jsonb,jsonb,jsonb,jsonb), public.semi_admin_update_order(uuid,timestamptz,jsonb,jsonb) to authenticated;

-- Semi-Admin never receives direct client-directory writes. Existing client
-- read policies remain intact; the atomic order command reads clients under
-- its security-definer transaction and links the selected row to the order.
drop policy if exists clients_insert_admin on public.clients;
create policy clients_insert_admin on public.clients for insert to authenticated with check (
  public.current_profile_is_admin()
);
drop policy if exists clients_update_admin on public.clients;
create policy clients_update_admin on public.clients for update to authenticated using (
  public.current_profile_is_admin()
) with check (public.current_profile_is_admin());
drop policy if exists clients_delete_admin on public.clients;
create policy clients_delete_admin on public.clients for delete to authenticated using (
  public.current_profile_is_admin()
);
revoke insert, update, delete on public.orders, public.order_files, public.order_production_files from authenticated;

notify pgrst, 'reload schema';
