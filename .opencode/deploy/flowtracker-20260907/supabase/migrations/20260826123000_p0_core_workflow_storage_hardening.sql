-- P0: make persisted order workflow changes database-authoritative.  RLS still
-- selects rows; this trigger denies privileged-column changes made through the
-- generic PostgREST table API.  SECURITY DEFINER commands continue to run as
-- their owner and each new command also sets the transaction-local flag.

create or replace function public.guard_orders_direct_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_user = 'authenticated'
     and current_setting('app.neonprint_order_command', true) is distinct from 'on'
     and (
       new.id is distinct from old.id
       or new.created_by is distinct from old.created_by
       or new.seller_id is distinct from old.seller_id
       or new.designer_id is distinct from old.designer_id
       or new.quote_id is distinct from old.quote_id
       or new.production_id is distinct from old.production_id
       or new.delivery_id is distinct from old.delivery_id
       or new.status is distinct from old.status
       or new.payment_status is distinct from old.payment_status
       or new.invoice_payment is distinct from old.invoice_payment
       or new.client_id is distinct from old.client_id
       or new.is_archived is distinct from old.is_archived
       or new.is_archived_designer is distinct from old.is_archived_designer
       or new.is_archived_quote is distinct from old.is_archived_quote
       or new.is_archived_delivery is distinct from old.is_archived_delivery
       or new.is_archived_admin is distinct from old.is_archived_admin
     ) then
    raise exception 'ORDER_PROTECTED_UPDATE: usa el comando autorizado de la orden';
  end if;

  -- This applies to SECURITY DEFINER commands too: no route may enter
  -- Production from Pending or Design, even if an older RPC is invoked.
  if new.status = 'in_Production' and old.status is distinct from 'in_Quote' then
    raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_orders_direct_update on public.orders;
create trigger trg_guard_orders_direct_update
before update on public.orders
for each row execute function public.guard_orders_direct_update();
revoke all on function public.guard_orders_direct_update() from public, anon, authenticated;

create index if not exists idx_order_files_r2_active_lookup
  on public.order_files (order_id, bucket, object_key)
  where provider = 'r2' and status = 'uploaded' and deleted_at is null;

create or replace function public.seller_update_order(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb
)
returns public.orders
language plpgsql security definer set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype; v_key text;
begin
  if v_actor is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.profiles where id = v_actor and role = 'seller' and coalesce(employment_status, true)) then raise exception 'Solo Ventas puede editar esta orden'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  if jsonb_typeof(coalesce(p_changes, '{}'::jsonb)) <> 'object' then raise exception 'Cambios invalidos'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('client_id','client_name','client_contact','invoice_number','description','material','termination_type','delivery_date','order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Orden no encontrada'; end if;
  if v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor then raise exception 'No tienes acceso a esta orden'; end if;
  if coalesce(v_order.is_archived, false) or v_order.status = 'in_Quote' then raise exception 'La orden no puede editarse en este estado'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    client_id = case when p_changes ? 'client_id' then nullif(p_changes->>'client_id','')::uuid else client_id end,
    client_name = case when p_changes ? 'client_name' then p_changes->>'client_name' else client_name end,
    client_contact = case when p_changes ? 'client_contact' then p_changes->>'client_contact' else client_contact end,
    invoice_number = case when p_changes ? 'invoice_number' then p_changes->>'invoice_number' else invoice_number end,
    description = case when p_changes ? 'description' then p_changes->>'description' else description end,
    material = case when p_changes ? 'material' then p_changes->>'material' else material end,
    termination_type = case when p_changes ? 'termination_type' then p_changes->>'termination_type' else termination_type end,
    delivery_date = case when p_changes ? 'delivery_date' then nullif(p_changes->>'delivery_date','')::date else delivery_date end,
    order_file_url = case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,
    preview_image = case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,
    reference_images = case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,
    updated_at = now()
  where id = p_order_id returning * into v_updated;
  return v_updated;
end; $$;

create or replace function public.seller_send_order_to_designer(p_order_id uuid, p_designer_id uuid, p_expected_updated_at timestamptz)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede enviar a Diseno'; end if;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.status <> 'Pending' or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not exists (select 1 from public.profiles where id=p_designer_id and role='designer' and coalesce(employment_status,true)) then raise exception 'Disenador no disponible'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Design', designer_id=p_designer_id, return_reason=null, returned_to_designer_at=null, updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.seller_send_order_to_quote(p_order_id uuid, p_quote_id uuid, p_expected_updated_at timestamptz)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede enviar a Caja'; end if;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.order_design_type <> 'EXTERNAL_DESING' then raise exception 'Solo ordenes de Diseno Externo pueden enviarse a Caja directamente desde Ventas'; end if;
  if v_order.status <> 'Pending' or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if not exists (select 1 from public.profiles where id=p_quote_id and role='quote' and coalesce(employment_status,true)) then raise exception 'Usuario de Caja no disponible'; end if;
  if coalesce(v_order.is_archived, false) then raise exception 'La orden no puede enviarse a Caja en este estado'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Quote', quote_id=p_quote_id, return_reason=null, returned_to_designer_at=null, updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.seller_cancel_order(p_order_id uuid, p_reason text, p_expected_updated_at timestamptz)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede cancelar'; end if;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.status in ('cancelled','in_Delivered') or v_order.payment_status in ('parcial','pagado','credito') then raise exception 'La orden no puede cancelarse'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Debes indicar el motivo de cancelacion'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='cancelled', cancellation_reason=trim(p_reason), updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.seller_set_order_archive(p_order_id uuid, p_archived boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede archivar'; end if;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.payment_status='parcial' or v_order.status not in ('cancelled','in_Completed','in_Delivered') then raise exception 'La orden no puede archivarse'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set is_archived=coalesce(p_archived,false), updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.designer_send_order_to_quote(p_order_id uuid, p_quote_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role='designer' and coalesce(employment_status,true)) then raise exception 'Solo Diseno puede enviar a Caja'; end if;
  if not found or v_order.designer_id is distinct from v_actor or v_order.status <> 'in_Design' then raise exception 'La orden no esta disponible en Diseno'; end if;
  if not exists(select 1 from public.profiles where id=p_quote_id and role='quote' and coalesce(employment_status,true)) then raise exception 'Caja no disponible'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Quote', quote_id=p_quote_id, return_reason=null, returned_to_designer_at=null, updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.quote_set_order_payment(p_order_id uuid, p_payment_status text, p_invoice_payment text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role in ('quote','admin') and coalesce(employment_status,true)) then raise exception 'Solo Caja puede actualizar pagos'; end if;
  if not found or (not public.current_profile_is_admin() and v_order.quote_id is distinct from v_actor) or v_order.status <> 'in_Quote' then raise exception 'No tienes acceso a esta orden'; end if;
  if p_payment_status not in ('Pending_Payment','parcial','pagado') then raise exception 'Estado de pago invalido'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status=p_payment_status, invoice_payment=case when p_payment_status='parcial' then null else coalesce(p_invoice_payment, invoice_payment) end, updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.quote_link_order_client(p_order_id uuid, p_client_id uuid)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_client public.clients%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update; select * into v_client from public.clients where id=p_client_id;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role in ('quote','admin') and coalesce(employment_status,true)) then raise exception 'Solo Caja puede vincular clientes'; end if;
  if v_order.id is null or (not public.current_profile_is_admin() and v_order.quote_id is distinct from v_actor) or v_order.client_id is not null then raise exception 'La orden no admite este vinculo'; end if;
  if v_client.id is null then raise exception 'Cliente no encontrado'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set client_id=v_client.id, client_name=coalesce(v_client.name,''), client_contact=v_client.phone, updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.delivery_mark_order_delivered(p_order_id uuid, p_delivery_note text default null)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role='delivery' and coalesce(employment_status,true)) then raise exception 'Solo Delivery puede entregar'; end if;
  if not found or v_order.delivery_id is distinct from v_actor or v_order.status <> 'in_Completed' then raise exception 'La orden no esta disponible para entrega'; end if;
  if v_order.payment_status not in ('pagado','credito') then raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a credito.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set status='in_Delivered', delivery_note=coalesce(nullif(trim(coalesce(p_delivery_note,'')),''),delivery_note), updated_at=now() where id=p_order_id returning * into v_updated; return v_updated;
end; $$;

create or replace function public.set_order_archive_state(p_order_id uuid, p_module text, p_archived boolean)
returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_role text; v_updated public.orders%rowtype;
begin
  select role into v_role from public.profiles where id=v_actor and coalesce(employment_status,true); select * into v_order from public.orders where id=p_order_id for update;
  if v_actor is null or not found then raise exception 'No tienes acceso a esta orden'; end if;
  if p_module='designer' and v_role='designer' and v_order.designer_id=v_actor then perform set_config('app.neonprint_order_command','on',true); update public.orders set is_archived_designer=coalesce(p_archived,false),updated_at=now() where id=p_order_id returning * into v_updated;
  elsif p_module='quote' and v_role='quote' and v_order.quote_id=v_actor then perform set_config('app.neonprint_order_command','on',true); update public.orders set is_archived_quote=coalesce(p_archived,false),updated_at=now() where id=p_order_id returning * into v_updated;
  elsif p_module='delivery' and v_role='delivery' and v_order.delivery_id=v_actor then perform set_config('app.neonprint_order_command','on',true); update public.orders set is_archived_delivery=coalesce(p_archived,false),updated_at=now() where id=p_order_id returning * into v_updated;
  elsif p_module='admin' and v_role='admin' then perform set_config('app.neonprint_order_command','on',true); update public.orders set is_archived_admin=coalesce(p_archived,false),updated_at=now() where id=p_order_id returning * into v_updated;
  else raise exception 'No tienes acceso a este archivo'; end if;
  return v_updated;
end; $$;

revoke all on function public.seller_update_order(uuid,timestamptz,jsonb), public.seller_send_order_to_designer(uuid,uuid,timestamptz), public.seller_send_order_to_quote(uuid,uuid,timestamptz), public.seller_cancel_order(uuid,text,timestamptz), public.seller_set_order_archive(uuid,boolean), public.designer_send_order_to_quote(uuid,uuid), public.quote_set_order_payment(uuid,text,text), public.quote_link_order_client(uuid,uuid), public.delivery_mark_order_delivered(uuid,text), public.set_order_archive_state(uuid,text,boolean) from public, anon;
grant execute on function public.seller_update_order(uuid,timestamptz,jsonb), public.seller_send_order_to_designer(uuid,uuid,timestamptz), public.seller_send_order_to_quote(uuid,uuid,timestamptz), public.seller_cancel_order(uuid,text,timestamptz), public.seller_set_order_archive(uuid,boolean), public.designer_send_order_to_quote(uuid,uuid), public.quote_set_order_payment(uuid,text,text), public.quote_link_order_client(uuid,uuid), public.delivery_mark_order_delivered(uuid,text), public.set_order_archive_state(uuid,text,boolean) to authenticated;
