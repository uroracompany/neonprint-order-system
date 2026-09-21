-- Invoice responsibility is explicit and backward compatible.
-- Existing orders remain seller-owned; only orders created with cashier mode
-- receive the stricter Caja requirements.

alter table public.orders
  add column if not exists invoice_assignment_mode text not null default 'seller';

update public.orders
set invoice_assignment_mode = 'seller'
where invoice_assignment_mode is null
   or invoice_assignment_mode not in ('seller', 'cashier');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_invoice_assignment_mode_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_invoice_assignment_mode_check
      check (invoice_assignment_mode in ('seller', 'cashier'));
  end if;
end;
$$;

create index if not exists idx_orders_invoice_assignment_mode
  on public.orders(invoice_assignment_mode)
  where invoice_assignment_mode = 'cashier';

create or replace function public.order_requires_invoice_code(p_assignment_mode text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(nullif(lower(btrim(p_assignment_mode)), ''), 'seller') = 'cashier';
$$;

create or replace function public.order_has_invoice_code(
  p_assignment_mode text,
  p_invoice_number text
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select not public.order_requires_invoice_code(p_assignment_mode)
      or nullif(btrim(coalesce(p_invoice_number, '')), '') is not null;
$$;

create or replace function public.enforce_invoice_assignment_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested_mode text := nullif(lower(btrim(coalesce(current_setting('app.neonprint_invoice_assignment_mode', true), ''))), '');
  v_is_cashier boolean;
  v_has_code boolean;
  v_is_admin boolean := public.current_profile_is_admin();
begin
  if tg_op = 'INSERT' and v_requested_mode in ('seller', 'cashier') then
    new.invoice_assignment_mode := v_requested_mode;
  end if;

  if coalesce(new.invoice_assignment_mode, 'seller') not in ('seller', 'cashier') then
    raise exception 'Responsabilidad de facturación inválida.';
  end if;

  if tg_op = 'UPDATE'
     and new.invoice_assignment_mode is distinct from old.invoice_assignment_mode
     and not v_is_admin then
    raise exception 'Solo Administración puede cambiar la responsabilidad de facturación.';
  end if;

  v_is_cashier := public.order_requires_invoice_code(new.invoice_assignment_mode);
  v_has_code := nullif(btrim(coalesce(new.invoice_number, '')), '') is not null;

  if tg_op = 'INSERT' and not v_is_cashier and not v_has_code then
    raise exception 'El número de facturación es requerido.';
  end if;

  if v_is_cashier and new.payment_status = 'pagado' then
    if not v_has_code then
      raise exception 'Caja debe registrar el código de facturación antes de marcar la orden como pagada.';
    end if;
    if nullif(btrim(coalesce(new.invoice_payment, '')), '') is null
       or not public.quote_has_uploaded_payment_receipt(new.id, new.invoice_payment) then
      raise exception 'Caja debe adjuntar y verificar el comprobante de pago antes de marcar la orden como pagada.';
    end if;
  end if;

  if v_is_cashier and new.payment_status = 'credito' and not v_has_code then
    raise exception 'Caja debe registrar el código de facturación antes de aprobar crédito.';
  end if;

  if v_is_cashier and new.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered') and not v_has_code then
    raise exception 'Caja debe registrar el código de facturación antes de continuar la orden.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_invoice_assignment_lifecycle on public.orders;
create trigger trg_enforce_invoice_assignment_lifecycle
before insert or update of invoice_assignment_mode, invoice_number, invoice_payment, payment_status, status
on public.orders
for each row execute function public.enforce_invoice_assignment_lifecycle();

-- The existing seller wrapper keeps its public signature and forwards the
-- requested mode to the insert trigger through a transaction-local setting.
create or replace function public.create_seller_order_with_file_specifications(
  p_idempotency_key uuid,
  p_order jsonb,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  perform set_config(
    'app.neonprint_invoice_assignment_mode',
    coalesce(nullif(lower(btrim(p_order->>'invoice_assignment_mode')), ''), 'seller'),
    true
  );
  if coalesce(nullif(lower(btrim(p_order->>'invoice_assignment_mode')), ''), 'seller') not in ('seller', 'cashier') then
    raise exception 'Responsabilidad de facturación inválida.';
  end if;
  v_order := public.create_seller_order_with_assets(
    p_idempotency_key, p_order, p_production_files, p_asset_refs
  );

  if jsonb_array_length(coalesce(p_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_production_files
    );
  end if;

  return v_order;
end;
$$;

-- Semi-Administración uses the same mode without changing its existing RPC
-- signature or idempotency contract.
create or replace function public.semi_admin_create_order_with_client(
  p_idempotency_key uuid,
  p_order jsonb,
  p_client jsonb default null,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_client_id uuid;
  v_order public.orders;
  v_order_id uuid;
  v_file jsonb;
  v_asset jsonb;
  v_hash text;
  v_command public.order_creation_commands%rowtype;
  v_reservation public.order_asset_preupload_reservations%rowtype;
  v_materials text[];
  v_termination text;
begin
  if p_idempotency_key is null
    or jsonb_typeof(coalesce(p_order, '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_production_files, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_asset_refs, '[]'::jsonb)) <> 'array' then
    raise exception 'Solicitud de creacion invalida';
  end if;

  perform set_config(
    'app.neonprint_invoice_assignment_mode',
    coalesce(nullif(lower(btrim(p_order->>'invoice_assignment_mode')), ''), 'seller'),
    true
  );
  if coalesce(nullif(lower(btrim(p_order->>'invoice_assignment_mode')), ''), 'seller') not in ('seller', 'cashier') then
    raise exception 'Responsabilidad de facturación inválida.';
  end if;
  v_hash := md5(coalesce(p_order, '{}'::jsonb)::text || coalesce(p_client, 'null'::jsonb)::text || coalesce(p_production_files, '[]'::jsonb)::text || coalesce(p_asset_refs, '[]'::jsonb)::text);
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

  insert into public.order_creation_commands(actor_id, idempotency_key, request_hash)
    values(v_actor, p_idempotency_key, v_hash);
  v_client_id := nullif(p_order->>'client_id', '')::uuid;
  if v_client_id is null and jsonb_typeof(coalesce(p_client, 'null'::jsonb)) = 'object' then
    if nullif(trim(p_client->>'name'), '') is null or nullif(trim(p_client->>'phone'), '') is null then
      raise exception 'El nuevo cliente requiere nombre y teléfono.';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_client->>'name')) || '|' || regexp_replace(p_client->>'phone', '\D', '', 'g'), 0));
    select c.id into v_client_id from public.clients c
      where c.deleted_at is null and lower(trim(c.name)) = lower(trim(p_client->>'name'))
        and regexp_replace(c.phone, '\D', '', 'g') = regexp_replace(p_client->>'phone', '\D', '', 'g')
      limit 1 for update;
    if v_client_id is null then
      insert into public.clients(name, phone, email, address, notes, created_by)
      values (trim(p_client->>'name'), trim(p_client->>'phone'), nullif(trim(p_client->>'email'), ''), nullif(trim(p_client->>'address'), ''), nullif(trim(p_client->>'notes'), ''), v_actor)
      returning id into v_client_id;
    end if;
  end if;
  if v_client_id is null or not exists (select 1 from public.clients c where c.id = v_client_id and c.deleted_at is null) then
    raise exception 'Cada orden debe tener un cliente registrado activo.';
  end if;

  v_order_id := coalesce(nullif(p_order->>'id', '')::uuid, gen_random_uuid());
  perform set_config('app.neonprint_order_command', 'on', true);
  insert into public.orders(id, client_id, client_name, client_contact, invoice_number, description, material,
    termination_type, order_type, order_design_type, delivery_date, status, payment_status, seller_id, created_by,
    order_file_url, preview_image, reference_images, updated_by)
  values (v_order_id, v_client_id, p_order->>'client_name', nullif(p_order->>'client_contact', ''), p_order->>'invoice_number',
    p_order->>'description', p_order->>'material', nullif(p_order->>'termination_type', ''), p_order->>'order_type',
    p_order->>'order_design_type', nullif(p_order->>'delivery_date', '')::date, 'Pending', 'Pending_Payment', v_actor, v_actor,
    p_order->>'order_file_url', p_order->>'preview_image', coalesce(p_order->'reference_images', '[]'::jsonb), v_actor)
  returning * into v_order;

  for v_file in select value from jsonb_array_elements(p_production_files) loop
    if nullif(trim(v_file->>'url'), '') is null or nullif(trim(v_file->>'public_label'), '') is null or nullif(trim(v_file->>'production_area_code'), '') is null then
      raise exception 'Archivo de producción inválido.';
    end if;
    if not exists (select 1 from public.production_areas where code = trim(v_file->>'production_area_code') and is_active = true) then
      raise exception 'Área de producción inválida.';
    end if;
    select public.normalize_production_material_names(array_agg(value)) into v_materials
      from jsonb_array_elements_text(coalesce(v_file->'material_names', '[]'::jsonb)) as item(value);
    v_termination := nullif(trim(v_file->>'termination_name'), '');
    if v_termination is null or coalesce(cardinality(v_materials), 0) = 0 then
      raise exception 'Cada archivo de producción requiere material y terminación.';
    end if;
    insert into public.order_production_files(order_id, url, filename, public_label, production_area_code, material_names, termination_name, status, created_by, updated_by)
    values (v_order_id, trim(v_file->>'url'), coalesce(nullif(trim(v_file->>'filename'), ''), 'Archivo'), trim(v_file->>'public_label'), trim(v_file->>'production_area_code'), v_materials, v_termination, 'pending', v_actor, v_actor)
    on conflict (order_id, url) do update set filename = excluded.filename, public_label = excluded.public_label, production_area_code = excluded.production_area_code, material_names = excluded.material_names, termination_name = excluded.termination_name, updated_by = excluded.updated_by, updated_at = now();
  end loop;

  for v_asset in select value from jsonb_array_elements(coalesce(p_asset_refs, '[]'::jsonb)) loop
    if nullif(trim(v_asset->>'bucket'), '') is null or nullif(trim(v_asset->>'objectKey'), '') is null
       or (v_asset->>'objectKey') !~ ('^orders/' || v_order_id::text || '/')
       or coalesce(v_asset->>'category', '') not in ('design', 'preview', 'reference')
       or coalesce(v_asset->>'provider', '') not in ('supabase', 'r2')
       or (v_asset->>'provider') = 'supabase' and v_asset->>'bucket' not in ('order-docs', 'order-previews')
       or nullif(trim(v_asset->>'reservationId'), '') is null then
      raise exception 'Referencia de archivo previo inválida.';
    end if;
    select * into v_reservation from public.order_asset_preupload_reservations
      where id = nullif(v_asset->>'reservationId', '')::uuid and actor_id = v_actor and order_id = v_order_id and idempotency_key = p_idempotency_key
        and provider = v_asset->>'provider' and bucket = trim(v_asset->>'bucket') and object_key = trim(v_asset->>'objectKey') and category = v_asset->>'category'
        and status = 'reserved' and expires_at > now() for update;
    if not found then raise exception 'La reserva del archivo previo no es válida o expiró.'; end if;
    insert into public.order_files(order_id, provider, bucket, object_key, original_filename, content_type, size_bytes, category, status, uploaded_by)
      values(v_order_id, v_asset->>'provider', trim(v_asset->>'bucket'), trim(v_asset->>'objectKey'), nullif(trim(v_asset->>'originalFilename'), ''), nullif(trim(v_asset->>'contentType'), ''), nullif(v_asset->>'sizeBytes', '')::bigint, v_asset->>'category', 'uploaded', v_actor)
      on conflict(provider, bucket, object_key) do nothing;
    update public.order_asset_preupload_reservations set status = 'bound', bound_at = now() where id = v_reservation.id;
  end loop;

  update public.order_creation_commands set order_id = v_order_id, status = 'completed', updated_at = now() where actor_id = v_actor and idempotency_key = p_idempotency_key;
  insert into public.order_events(order_id, actor_id, event_type, changes) values (v_order.id, v_actor, 'semi_admin_order_created', jsonb_build_object('role', 'semi_admin', 'client_id', v_client_id, 'invoice_assignment_mode', v_order.invoice_assignment_mode));
  return v_order;
end;
$$;

create or replace function public.quote_assign_invoice_code(
  p_order_id uuid,
  p_invoice_number text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_code text := nullif(btrim(coalesce(p_invoice_number, '')), '');
begin
  select role into v_role from public.profiles where id = v_actor and coalesce(employment_status, true) and deleted_at is null;
  if v_role not in ('quote', 'admin') then raise exception 'Solo Caja o Administración puede registrar el código de facturación.'; end if;
  if v_code is null then raise exception 'El código de facturación es requerido.'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_role <> 'admin' and v_order.quote_id is distinct from v_actor then
    raise exception 'Solo la Caja responsable puede registrar el código de facturación.';
  end if;
  if coalesce(v_order.is_archived_quote, false) or v_order.status <> 'in_Quote' or v_order.operational_status = 'blocked' then
    raise exception 'La orden no está disponible para Caja.';
  end if;
  if not public.order_requires_invoice_code(v_order.invoice_assignment_mode) then
    raise exception 'Esta orden no está configurada para que Caja asigne la factura.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set invoice_number = v_code, updated_at = now(), updated_by = v_actor
    where id = p_order_id returning * into v_updated;
  insert into public.order_events(order_id, actor_id, event_type, changes)
    values (p_order_id, v_actor, 'invoice_code_assigned', jsonb_build_object('invoice_number', v_code, 'assignment_mode', v_order.invoice_assignment_mode));
  return v_updated;
end;
$$;

create or replace function public.quote_set_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_invoice_payment text := nullif(btrim(coalesce(p_invoice_payment, '')), '');
begin
  select role into v_role from public.profiles where id = v_actor and coalesce(employment_status, true);
  if v_actor is null or v_role not in ('quote', 'admin') then raise exception 'Solo Caja puede actualizar pagos'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or (v_role <> 'admin' and v_order.quote_id is distinct from v_actor)
     or v_order.status <> 'in_Quote' or coalesce(v_order.is_archived, false) then
    raise exception 'No tienes acceso a esta orden';
  end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado') then raise exception 'Estado de pago invalido'; end if;
  if (v_order.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado'))
     or (v_order.payment_status = 'pagado' and p_payment_status <> 'pagado')
     or v_order.payment_status = 'credito' then
    raise exception 'Transicion de pago no permitida';
  end if;
  if p_payment_status = 'pagado' and v_invoice_payment is null then
    raise exception 'Caja requiere una imagen de comprobante para marcar la orden como pagada';
  end if;
  if p_payment_status = 'pagado' and not public.quote_has_uploaded_payment_receipt(p_order_id, v_invoice_payment) then
    raise exception 'El comprobante debe ser una imagen cargada y verificada para esta orden';
  end if;
  if public.order_requires_invoice_code(v_order.invoice_assignment_mode)
     and p_payment_status = 'pagado'
     and nullif(btrim(coalesce(v_order.invoice_number, '')), '') is null then
    raise exception 'Caja debe registrar el código de facturación antes de marcar la orden como pagada.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set
    payment_status = p_payment_status,
    invoice_payment = case when p_payment_status = 'parcial' then null when p_payment_status = 'pagado' then v_invoice_payment else coalesce(p_invoice_payment, invoice_payment) end,
    updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_updated;
  return v_updated;
end;
$$;

create or replace function public.semi_admin_register_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_invoice_number text,
  p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_old public.orders%rowtype;
  v_new public.orders%rowtype;
  v_invoice_payment text;
  v_invoice_number text;
begin
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_old.is_archived, false) or v_old.operational_status = 'blocked' or v_old.status = 'cancelled' then raise exception 'La orden no está disponible para actualizar el pago.'; end if;
  if v_old.status <> 'in_Quote' then raise exception 'El pago de Semi-Administración solo se gestiona en Caja.'; end if;
  if v_old.designer_id is distinct from v_actor and v_old.quote_id is distinct from v_actor and v_old.seller_id is distinct from v_actor and v_old.created_by is distinct from v_actor then raise exception 'Debes ser responsable de Diseño/Caja o creador de la orden para gestionar el pago.'; end if;
  if p_payment_status not in ('Pending_Payment', 'parcial', 'pagado', 'credito') then raise exception 'Selecciona un estado de pago válido.'; end if;
  if v_old.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado') then raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.'; end if;
  if v_old.payment_status = 'credito' and p_payment_status not in ('credito', 'pagado') then raise exception 'Una orden a crédito solo puede mantenerse a crédito o cambiarse a pagado mediante un cierre registrado.'; end if;

  v_invoice_payment := coalesce(nullif(btrim(coalesce(p_invoice_payment, '')), ''), v_old.invoice_payment);
  v_invoice_number := coalesce(nullif(btrim(coalesce(p_invoice_number, '')), ''), v_old.invoice_number);
  if p_payment_status = 'pagado' and public.order_requires_invoice_code(v_old.invoice_assignment_mode) then
    if nullif(btrim(coalesce(v_invoice_number, '')), '') is null then raise exception 'Caja debe registrar el código de facturación antes de marcar la orden como pagada.'; end if;
    if v_invoice_payment is null or not public.quote_has_uploaded_payment_receipt(p_order_id, v_invoice_payment) then raise exception 'Caja debe adjuntar y verificar el comprobante de pago antes de marcar la orden como pagada.'; end if;
  elsif p_payment_status = 'pagado' and v_invoice_payment is null and v_invoice_number is null then
    raise exception 'Debes adjuntar la factura o ingresar un número de comprobante para marcar como pagado.';
  end if;
  if p_payment_status = 'credito' and (v_old.client_id is null or nullif(btrim(coalesce(v_invoice_number, '')), '') is null) then raise exception 'Para vender a crédito debes registrar cliente y factura.'; end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set payment_status = p_payment_status,
    invoice_payment = case when p_payment_status in ('Pending_Payment', 'parcial', 'credito') then null else v_invoice_payment end,
    invoice_number = v_invoice_number, updated_at = now(), updated_by = v_actor
  where id = p_order_id returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  values (p_order_id, v_actor, 'semi_admin_payment_updated', v_old.payment_status, v_new.payment_status,
    jsonb_build_object('evidence', case when nullif(btrim(coalesce(v_new.invoice_payment, '')), '') is not null then 'receipt' else 'receipt_number' end, 'invoice_number_applied', nullif(btrim(coalesce(v_new.invoice_number, '')), '')));
  return v_new;
end;
$$;

-- Preserve the existing production/partial-payment guards while adding only
-- the cashier-specific invoice requirement through the trigger above.
revoke all on function public.quote_assign_invoice_code(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.quote_assign_invoice_code(uuid, text, timestamptz) to authenticated;
revoke all on function public.quote_set_order_payment(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.quote_set_order_payment(uuid, text, text, timestamptz) to authenticated;
notify pgrst, 'reload schema';
