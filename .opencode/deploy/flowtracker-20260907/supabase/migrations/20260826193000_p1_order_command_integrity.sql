-- P1: critical/high order workflow integrity. This migration is intentionally
-- forward-only and is applied after the P0 command hardening and asset outbox.

-- Direct table writes are never an order command. Commands below set the flag
-- transaction-locally and also perform their own role, ownership and version checks.
create or replace function public.guard_orders_direct_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_user = 'authenticated'
     and current_setting('app.neonprint_order_command', true) is distinct from 'on'
     and (
       new.created_by is distinct from old.created_by or new.seller_id is distinct from old.seller_id
       or new.designer_id is distinct from old.designer_id or new.quote_id is distinct from old.quote_id
       or new.production_id is distinct from old.production_id or new.delivery_id is distinct from old.delivery_id
       or new.status is distinct from old.status or new.payment_status is distinct from old.payment_status
       or new.invoice_payment is distinct from old.invoice_payment or new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name or new.client_contact is distinct from old.client_contact
       or new.invoice_number is distinct from old.invoice_number or new.description is distinct from old.description
       or new.material is distinct from old.material or new.termination_type is distinct from old.termination_type
       or new.order_type is distinct from old.order_type or new.order_design_type is distinct from old.order_design_type
       or new.delivery_date is distinct from old.delivery_date or new.order_file_url is distinct from old.order_file_url
       or new.preview_image is distinct from old.preview_image or new.reference_images is distinct from old.reference_images
       or new.is_archived is distinct from old.is_archived or new.is_archived_designer is distinct from old.is_archived_designer
       or new.is_archived_quote is distinct from old.is_archived_quote or new.is_archived_delivery is distinct from old.is_archived_delivery
       or new.is_archived_admin is distinct from old.is_archived_admin or new.updated_by is distinct from old.updated_by
     ) then
    raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden';
  end if;
  if new.status = 'in_Production' and old.status is distinct from 'in_Quote' then
    raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
  end if;
  return new;
end;
$$;

drop policy if exists orders_update_by_role on public.orders;
revoke update on public.orders from authenticated, anon;

-- P0 exposed archive without a version. Replace it with the versioned contract
-- and leave the old signature non-executable so it cannot become a bypass.
revoke all on function public.seller_set_order_archive(uuid, boolean) from public, anon, authenticated;
create or replace function public.seller_set_order_archive(
  p_order_id uuid, p_archived boolean, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid := auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede archivar'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(p_archived,false) and (v_order.payment_status='parcial' or v_order.status not in ('cancelled','in_Completed','in_Delivered')) then raise exception 'La orden no puede archivarse'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set is_archived=coalesce(p_archived,false), updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_updated;
  return v_updated;
end; $$;

create or replace function public.seller_update_order_with_files(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb, p_removed_file_urls text[] default '{}'::text[]
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype; v_file jsonb; v_key text;
begin
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede editar esta orden'; end if;
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_changes,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_new_production_files,'[]'::jsonb)) <> 'array' then raise exception 'ORDER_STALE'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('client_id','client_name','client_contact','invoice_number','description','material','termination_type','delivery_date','order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or (v_order.seller_id is distinct from v_actor and v_order.created_by is distinct from v_actor) then raise exception 'No tienes acceso a esta orden'; end if;
  if coalesce(v_order.is_archived,false) or v_order.status='in_Quote' then raise exception 'La orden no puede editarse en este estado'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set
    client_id=case when p_changes ? 'client_id' then nullif(p_changes->>'client_id','')::uuid else client_id end,
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
    updated_at=now(), updated_by=v_actor where id=p_order_id returning * into v_updated;
  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    if nullif(trim(v_file->>'url'),'') is null or nullif(trim(v_file->>'public_label'),'') is null or nullif(trim(v_file->>'production_area_code'),'') is null then raise exception 'Archivo de produccion invalido'; end if;
    insert into public.order_production_files(order_id,url,filename,public_label,production_area_code,status,created_by,updated_by)
    values (p_order_id,trim(v_file->>'url'),coalesce(nullif(trim(v_file->>'filename'),''),'Archivo'),trim(v_file->>'public_label'),trim(v_file->>'production_area_code'),'pending',v_actor,v_actor);
  end loop;
  if coalesce(array_length(p_removed_file_urls,1),0)>0 then
    insert into public.order_asset_deletion_outbox(order_id,provider,bucket,target_kind,object_path)
    select p_order_id, case when f.url like 'r2://%' then 'r2' else 'supabase' end, 'order-docs', 'object',
      case when f.url like 'r2://%' then split_part(f.url,'/',4) else regexp_replace(f.url, '^.*/order-docs/', '') end
    from public.order_production_files f where f.order_id=p_order_id and f.url=any(p_removed_file_urls)
    on conflict (provider,bucket,target_kind,object_path) do nothing;
    delete from public.order_production_files where order_id=p_order_id and url=any(p_removed_file_urls);
  end if;
  return v_updated;
end; $$;

-- Caja payment updates use the same lock/version boundary as credit. The P0
-- three-argument command is intentionally revoked so stale clients cannot
-- bypass optimistic locking.
revoke all on function public.quote_set_order_payment(uuid,text,text) from public, anon, authenticated;
create or replace function public.quote_set_order_payment(
  p_order_id uuid, p_payment_status text, p_invoice_payment text, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_role text; v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select role into v_role from public.profiles where id=v_actor and coalesce(employment_status,true);
  if v_actor is null or v_role not in ('quote','admin') then raise exception 'Solo Caja puede actualizar pagos'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or (v_role <> 'admin' and v_order.quote_id is distinct from v_actor) or v_order.status <> 'in_Quote' or coalesce(v_order.is_archived,false) then raise exception 'No tienes acceso a esta orden'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if p_payment_status not in ('Pending_Payment','parcial','pagado') then raise exception 'Estado de pago invalido'; end if;
  if (v_order.payment_status='Pending_Payment' and p_payment_status not in ('Pending_Payment','parcial','pagado'))
     or (v_order.payment_status='parcial' and p_payment_status not in ('parcial','pagado'))
     or (v_order.payment_status='pagado' and p_payment_status <> 'pagado')
     or v_order.payment_status='credito' then raise exception 'Transicion de pago no permitida'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status=p_payment_status,invoice_payment=case when p_payment_status='parcial' then null else coalesce(p_invoice_payment,invoice_payment) end,updated_at=now(),updated_by=v_actor where id=p_order_id returning * into v_updated;
  return v_updated;
end; $$;

create or replace function public.designer_update_order_assets(
  p_order_id uuid, p_expected_updated_at timestamptz, p_changes jsonb, p_new_production_files jsonb default '[]'::jsonb
) returns public.orders language plpgsql security definer set search_path=public as $$
declare v_actor uuid:=auth.uid(); v_order public.orders%rowtype; v_updated public.orders%rowtype; v_file jsonb; v_key text;
begin
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role='designer' and coalesce(employment_status,true)) then raise exception 'Solo Diseno puede actualizar archivos'; end if;
  if p_expected_updated_at is null or jsonb_typeof(coalesce(p_changes,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_new_production_files,'[]'::jsonb)) <> 'array' then raise exception 'ORDER_STALE'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop if v_key not in ('order_file_url','preview_image','reference_images') then raise exception 'Campo no permitido: %',v_key; end if; end loop;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found or v_order.designer_id is distinct from v_actor or v_order.status <> 'in_Design' or coalesce(v_order.is_archived,false) then raise exception 'La orden no esta disponible en Diseno'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set order_file_url=case when p_changes ? 'order_file_url' then p_changes->>'order_file_url' else order_file_url end,preview_image=case when p_changes ? 'preview_image' then p_changes->>'preview_image' else preview_image end,reference_images=case when p_changes ? 'reference_images' then p_changes->'reference_images' else reference_images end,updated_at=now(),updated_by=v_actor where id=p_order_id returning * into v_updated;
  for v_file in select value from jsonb_array_elements(p_new_production_files) loop
    if nullif(trim(v_file->>'url'),'') is null or nullif(trim(v_file->>'public_label'),'') is null or nullif(trim(v_file->>'production_area_code'),'') is null then raise exception 'Archivo de produccion invalido'; end if;
    insert into public.order_production_files(order_id,url,filename,public_label,production_area_code,status,created_by,updated_by)
    values(p_order_id,trim(v_file->>'url'),coalesce(nullif(trim(v_file->>'filename'),''),'Archivo'),trim(v_file->>'public_label'),trim(v_file->>'production_area_code'),'pending',v_actor,v_actor);
  end loop;
  return v_updated;
end; $$;

-- Financial state must be an optimistic, lifecycle-valid command.
revoke all on function public.mark_order_as_credit(uuid,timestamptz) from public, anon, authenticated;
revoke all on function public.mark_order_as_credit(uuid,timestamptz,numeric) from public, anon, authenticated;
create or replace function public.mark_order_as_credit(
  p_order_id uuid, p_due_date timestamptz, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_uid uuid:=auth.uid(); v_role text; v_order public.orders%rowtype; v_updated public.orders%rowtype;
begin
  select role into v_role from public.profiles where id=v_uid and coalesce(employment_status,true);
  if v_uid is null or v_role not in ('admin','quote') then raise exception 'Solo caja o admin pueden aprobar pago a credito.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_role <> 'admin' and v_order.quote_id is distinct from v_uid then raise exception 'No tienes acceso a esta orden.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_order.status <> 'in_Quote' or coalesce(v_order.is_archived,false) or v_order.payment_status <> 'Pending_Payment' then raise exception 'La orden no es elegible para credito.'; end if;
  if v_order.client_id is null or nullif(trim(coalesce(v_order.invoice_number,'')),'') is null then raise exception 'Para vender a credito debes registrar cliente y factura.'; end if;
  perform set_config('app.neonprint_order_command','on',true);
  update public.orders set payment_status='credito',invoice_payment=null,updated_at=now(),updated_by=v_uid where id=p_order_id returning * into v_updated;
  insert into public.accounts_receivable(order_id,client_id,invoice_number,status,issued_at,due_date,created_by)
  values(p_order_id,v_updated.client_id,nullif(trim(v_updated.invoice_number),''),'open',now(),p_due_date,v_uid)
  on conflict(order_id) do update set client_id=excluded.client_id,invoice_number=excluded.invoice_number,due_date=excluded.due_date,status='open',updated_at=now();
  insert into public.order_events(order_id,actor_id,event_type,old_payment_status,new_payment_status,changes)
  values(p_order_id,v_uid,'credit_granted',v_order.payment_status,'credito',jsonb_build_object('client_id',v_updated.client_id,'invoice_number',v_updated.invoice_number,'due_date',p_due_date));
  return v_updated;
end; $$;

-- Idempotent creation: metadata and production classifications commit together.
create table if not exists public.order_creation_commands (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null references auth.users(id),
  idempotency_key uuid not null, request_hash text not null, order_id uuid references public.orders(id),
  status text not null default 'processing' check(status in ('processing','completed','failed')),
  error_code text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(actor_id,idempotency_key)
);
alter table public.order_creation_commands enable row level security;
revoke all on public.order_creation_commands from public, anon, authenticated;

create or replace function public.create_seller_order_with_assets(
  p_idempotency_key uuid, p_order jsonb, p_production_files jsonb default '[]'::jsonb, p_asset_refs jsonb default '[]'::jsonb
) returns public.orders language plpgsql security definer set search_path = public as $$
declare v_actor uuid:=auth.uid(); v_hash text; v_command public.order_creation_commands%rowtype; v_order public.orders%rowtype; v_file jsonb; v_asset jsonb; v_order_id uuid;
begin
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role='seller' and coalesce(employment_status,true)) then raise exception 'Solo Ventas puede crear ordenes'; end if;
  if p_idempotency_key is null or jsonb_typeof(coalesce(p_order,'{}'::jsonb)) <> 'object' or jsonb_typeof(coalesce(p_production_files,'[]'::jsonb)) <> 'array' then raise exception 'Solicitud de creacion invalida'; end if;
  v_hash:=md5(coalesce(p_order,'{}'::jsonb)::text || coalesce(p_production_files,'[]'::jsonb)::text || coalesce(p_asset_refs,'[]'::jsonb)::text);
  select * into v_command from public.order_creation_commands where actor_id=v_actor and idempotency_key=p_idempotency_key for update;
  if found then
    if v_command.request_hash <> v_hash then raise exception 'ORDER_IDEMPOTENCY_CONFLICT'; end if;
    if v_command.status='completed' and v_command.order_id is not null then select * into v_order from public.orders where id=v_command.order_id; return v_order; end if;
    raise exception 'ORDER_CREATION_IN_PROGRESS';
  end if;
  v_order_id:=coalesce(nullif(p_order->>'id','')::uuid,gen_random_uuid());
  -- Keep order_id null until the INSERT below succeeds; it is a foreign key.
  insert into public.order_creation_commands(actor_id,idempotency_key,request_hash) values(v_actor,p_idempotency_key,v_hash);
  perform set_config('app.neonprint_order_command','on',true);
  insert into public.orders(id,client_id,client_name,client_contact,invoice_number,description,material,termination_type,order_type,order_design_type,delivery_date,status,payment_status,seller_id,created_by,order_file_url,preview_image,reference_images,updated_by)
  values(v_order_id,nullif(p_order->>'client_id','')::uuid,p_order->>'client_name',nullif(p_order->>'client_contact',''),p_order->>'invoice_number',p_order->>'description',p_order->>'material',nullif(p_order->>'termination_type',''),p_order->>'order_type',p_order->>'order_design_type',nullif(p_order->>'delivery_date','')::date,'Pending','Pending_Payment',v_actor,v_actor,p_order->>'order_file_url',p_order->>'preview_image',coalesce(p_order->'reference_images','[]'::jsonb),v_actor) returning * into v_order;
  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'),'') is null or nullif(trim(v_file->>'public_label'),'') is null or nullif(trim(v_file->>'production_area_code'),'') is null then raise exception 'Archivo de produccion invalido'; end if;
    insert into public.order_production_files(order_id,url,filename,public_label,production_area_code,status,created_by,updated_by)
    values(v_order_id,trim(v_file->>'url'),coalesce(nullif(trim(v_file->>'filename'),''),'Archivo'),trim(v_file->>'public_label'),trim(v_file->>'production_area_code'),'pending',v_actor,v_actor);
  end loop;
  -- Pre-order R2 descriptors are accepted only when their object path is scoped
  -- to this exact preallocated order id. They become canonical catalog records
  -- in the same transaction as the order and production metadata.
  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs,'[]'::jsonb)) loop
    if nullif(trim(coalesce(v_asset->>'bucket','')),'') is null
       or nullif(trim(coalesce(v_asset->>'objectKey','')),'') is null
       or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
       or coalesce(v_asset->>'category','') not in ('design','preview','reference') then
      raise exception 'Referencia de archivo previo invalida';
    end if;
    insert into public.order_files(order_id,provider,bucket,object_key,original_filename,content_type,size_bytes,category,status,uploaded_by)
    values(v_order_id,'r2',trim(v_asset->>'bucket'),trim(v_asset->>'objectKey'),nullif(trim(v_asset->>'originalFilename'),''),nullif(trim(v_asset->>'contentType'),''),nullif(v_asset->>'sizeBytes','')::bigint,v_asset->>'category','uploaded',v_actor)
    on conflict(provider,bucket,object_key) do nothing;
  end loop;
  update public.order_creation_commands set order_id=v_order_id,status='completed',updated_at=now() where actor_id=v_actor and idempotency_key=p_idempotency_key;
  return v_order;
end; $$;

-- Recoverable purge evidence and claims. Eligibility stays unchanged.
alter table public.order_purge_audit add column if not exists claim_token uuid;
alter table public.order_purge_audit add column if not exists claim_expires_at timestamptz;
alter table public.order_purge_audit add column if not exists attempt_count integer not null default 0;
alter table public.order_purge_audit add column if not exists phase text not null default 'claimed';
alter table public.order_purge_audit add column if not exists order_snapshot jsonb;
alter table public.order_purge_audit add column if not exists asset_manifest jsonb;
alter table public.order_purge_audit add column if not exists completed_at timestamptz;
create unique index if not exists idx_order_purge_audit_active_claim on public.order_purge_audit(order_id) where purge_status <> 'purged';

create or replace function public.claim_old_orders_for_purge(p_cutoff timestamptz, p_limit integer default 100)
returns table(order_id uuid, claim_token uuid, asset_manifest jsonb) language plpgsql security definer set search_path=public as $$
begin
  update public.order_purge_audit set purge_status='failed',phase='failed',claim_token=null,claim_expires_at=null
  where purge_status not in ('purged','failed') and claim_expires_at < now();
  return query with candidates as (
    select o.* from public.orders o where o.created_at<p_cutoff and (coalesce(o.is_archived,false) or o.status in ('in_Delivered','cancelled'))
    and not exists(select 1 from public.order_purge_audit a where a.order_id=o.id and a.purge_status='purged') order by o.created_at limit greatest(least(coalesce(p_limit,100),500),1) for update skip locked
  ), claims as (
    insert into public.order_purge_audit(order_id,order_created_at,client_name,status,payment_status,order_events_count,notifications_count,storage_errors,purge_status,claim_token,claim_expires_at,attempt_count,phase,order_snapshot,asset_manifest)
    select c.id,c.created_at,c.client_name,c.status,c.payment_status,(select count(*)::int from public.order_events e where e.order_id=c.id),(select count(*)::int from public.notifications n where n.order_id=c.id),'[]'::jsonb,'failed',gen_random_uuid(),now()+interval '30 minutes',1,'claimed',to_jsonb(c),jsonb_build_object('order_files',coalesce((select jsonb_agg(to_jsonb(f)) from public.order_files f where f.order_id=c.id and f.deleted_at is null),'[]'::jsonb),'legacy',jsonb_build_object('order_file_url',c.order_file_url,'preview_image',c.preview_image,'reference_images',c.reference_images,'invoice_payment',c.invoice_payment)) from candidates c
    on conflict (order_id) where purge_status <> 'purged' do update set claim_token=gen_random_uuid(),claim_expires_at=now()+interval '30 minutes',attempt_count=public.order_purge_audit.attempt_count+1,phase='claimed',purge_status='failed'
    returning public.order_purge_audit.order_id,public.order_purge_audit.claim_token,public.order_purge_audit.asset_manifest
  ) select * from claims;
end; $$;

create or replace function public.record_order_purge_storage_result(
  p_order_id uuid, p_claim_token uuid, p_storage_files_deleted integer default 0, p_storage_errors jsonb default '[]'::jsonb
) returns public.order_purge_audit language plpgsql security definer set search_path=public as $$
declare v_audit public.order_purge_audit%rowtype;
begin
  select * into v_audit from public.order_purge_audit where order_id=p_order_id and claim_token=p_claim_token for update;
  if not found or v_audit.claim_expires_at < now() then raise exception 'PURGE_CLAIM_INVALID'; end if;
  update public.order_purge_audit set storage_files_deleted=greatest(coalesce(p_storage_files_deleted,0),0),storage_errors=coalesce(p_storage_errors,'[]'::jsonb),
    phase=case when jsonb_array_length(coalesce(p_storage_errors,'[]'::jsonb))=0 then 'storage_deleted' else 'failed' end,
    purge_status=case when jsonb_array_length(coalesce(p_storage_errors,'[]'::jsonb))=0 then 'failed' else 'failed' end
  where id=v_audit.id returning * into v_audit;
  return v_audit;
end; $$;

create or replace function public.purge_claimed_order_after_storage(p_order_id uuid, p_claim_token uuid, p_cutoff timestamptz)
returns public.order_purge_audit language plpgsql security definer set search_path=public as $$
declare v_audit public.order_purge_audit%rowtype; v_order public.orders%rowtype;
begin
  select * into v_audit from public.order_purge_audit where order_id=p_order_id and claim_token=p_claim_token for update;
  if not found or v_audit.claim_expires_at < now() or v_audit.phase <> 'storage_deleted' then raise exception 'PURGE_CLAIM_INVALID'; end if;
  select * into v_order from public.orders where id=p_order_id and created_at<p_cutoff and (coalesce(is_archived,false) or status in ('in_Delivered','cancelled')) for update;
  if not found then raise exception 'Order % is not eligible for purge',p_order_id; end if;
  perform set_config('app.order_purge_authorized','on',true);
  delete from public.notifications where order_id=p_order_id;
  delete from public.orders where id=p_order_id;
  update public.order_purge_audit set purge_status='purged',phase='db_deleted',completed_at=now(),purged_at=now(),claim_expires_at=null where id=v_audit.id returning * into v_audit;
  return v_audit;
end; $$;

revoke all on function public.seller_update_order(uuid,timestamptz,jsonb), public.seller_send_order_to_designer(uuid,uuid,timestamptz), public.seller_send_order_to_quote(uuid,uuid,timestamptz), public.seller_cancel_order(uuid,text,timestamptz), public.seller_set_order_archive(uuid,boolean,timestamptz), public.designer_send_order_to_quote(uuid,uuid), public.quote_set_order_payment(uuid,text,text,timestamptz), public.quote_link_order_client(uuid,uuid), public.delivery_mark_order_delivered(uuid,text), public.set_order_archive_state(uuid,text,boolean), public.seller_update_order_with_files(uuid,timestamptz,jsonb,jsonb,text[]), public.designer_update_order_assets(uuid,timestamptz,jsonb,jsonb), public.mark_order_as_credit(uuid,timestamptz,timestamptz), public.create_seller_order_with_assets(uuid,jsonb,jsonb,jsonb) from public, anon;
revoke all on function public.claim_old_orders_for_purge(timestamptz,integer), public.record_order_purge_storage_result(uuid,uuid,integer,jsonb), public.purge_claimed_order_after_storage(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.seller_update_order(uuid,timestamptz,jsonb), public.seller_send_order_to_designer(uuid,uuid,timestamptz), public.seller_send_order_to_quote(uuid,uuid,timestamptz), public.seller_cancel_order(uuid,text,timestamptz), public.seller_set_order_archive(uuid,boolean,timestamptz), public.designer_send_order_to_quote(uuid,uuid), public.quote_set_order_payment(uuid,text,text,timestamptz), public.quote_link_order_client(uuid,uuid), public.delivery_mark_order_delivered(uuid,text), public.set_order_archive_state(uuid,text,boolean), public.seller_update_order_with_files(uuid,timestamptz,jsonb,jsonb,text[]), public.designer_update_order_assets(uuid,timestamptz,jsonb,jsonb), public.mark_order_as_credit(uuid,timestamptz,timestamptz), public.create_seller_order_with_assets(uuid,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.claim_old_orders_for_purge(timestamptz,integer), public.record_order_purge_storage_result(uuid,uuid,integer,jsonb), public.purge_claimed_order_after_storage(uuid,uuid,timestamptz) to service_role;
