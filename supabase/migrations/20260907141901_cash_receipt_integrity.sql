-- Caja must prove a paid receipt against the canonical asset catalog. This is
-- deliberately scoped to quote_set_order_payment: SemiAdmin keeps its separate
-- receipt-image-or-number workflow and audit trail.

alter table public.order_files
  add column if not exists payment_image_verified_at timestamptz;

-- Payment proof images are private and remain bounded by the bucket's existing
-- size limit. This idempotently extends only its MIME allow-list for the GIF
-- format accepted by the server-side decoder.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf'
]
where id = 'payment-invoice';

create or replace function public.quote_encode_payment_asset_uri(p_value text)
returns text
language plpgsql
immutable
strict
security definer
set search_path = public
as $$
declare
  v_index integer;
  v_byte_index integer;
  v_character text;
  v_bytes bytea;
  v_result text := '';
begin
  for v_index in 1..char_length(p_value) loop
    v_character := substr(p_value, v_index, 1);
    -- Payment keys are ASCII-safe. Keep only canonical path characters raw;
    -- any other byte is encoded so a catalog reference is unambiguous.
    if v_character ~ E'^[A-Za-z0-9._/-]$' then
      v_result := v_result || v_character;
    else
      v_bytes := convert_to(v_character, 'UTF8');
      for v_byte_index in 0..octet_length(v_bytes) - 1 loop
        v_result := v_result || '%' || lpad(upper(to_hex(get_byte(v_bytes, v_byte_index))), 2, '0');
      end loop;
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.quote_has_uploaded_payment_receipt(
  p_order_id uuid,
  p_receipt_reference text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reference text := nullif(btrim(coalesce(p_receipt_reference, '')), '');
  v_provider text;
  v_remainder text;
  v_separator integer;
  v_bucket text;
  v_key text;
  v_percent integer;
  v_cursor integer := 1;
begin
  if p_order_id is null or v_reference is null or position('?' in v_reference) > 0
     or position('#' in v_reference) > 0 or position('%' in v_reference) > 0 then
    return false;
  end if;

  if left(v_reference, char_length('supabase://')) = 'supabase://' then
    v_provider := 'supabase';
    v_remainder := substr(v_reference, char_length('supabase://') + 1);
  elsif left(v_reference, char_length('r2://')) = 'r2://' then
    v_provider := 'r2';
    v_remainder := substr(v_reference, char_length('r2://') + 1);
  else
    return false;
  end if;

  v_separator := position('/' in v_remainder);
  if v_separator <= 1 then return false; end if;
  v_bucket := left(v_remainder, v_separator - 1);
  v_key := substr(v_remainder, v_separator + 1);
  if v_key = '' or left(v_key, 1) = '/' or position('//' in v_key) > 0
     or v_key ~ '(^|/)[.][.]?(/|$)' then
    return false;
  end if;

  return exists (
    select 1
    from public.order_files as f
    where f.order_id = p_order_id
      and f.provider = v_provider
      and f.bucket = v_bucket
      and (f.provider <> 'supabase' or f.bucket = 'payment-invoice')
      and f.object_key like 'orders/' || p_order_id::text || '/%'
      and f.object_key ~ ('^orders/' || p_order_id::text || '/payment-[0-9]+-[a-z0-9._-]+$')
      and f.category = 'payment'
      and f.status = 'uploaded'
      and f.deleted_at is null
      and f.payment_image_verified_at is not null
      and nullif(btrim(coalesce(f.content_type, '')), '') ~* '^image/[a-z0-9][a-z0-9.+-]*$'
      and case f.provider
        when 'supabase' then 'supabase://' || f.bucket || '/' || public.quote_encode_payment_asset_uri(f.object_key)
        when 'r2' then 'r2://' || f.bucket || '/' || public.quote_encode_payment_asset_uri(f.object_key)
      end = v_reference
  );
end;
$$;

-- Preserve the versioned Caja command and its authorization/lifecycle checks,
-- while refusing to promote an order to pagado without cataloged image proof.
revoke all on function public.quote_set_order_payment(uuid,text,text) from public, anon, authenticated;
create or replace function public.quote_set_order_payment(
  p_order_id uuid,
  p_payment_status text,
  p_invoice_payment text,
  p_expected_updated_at timestamptz
) returns public.orders
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
  if (v_order.payment_status = 'Pending_Payment' and p_payment_status not in ('Pending_Payment', 'parcial', 'pagado'))
     or (v_order.payment_status = 'parcial' and p_payment_status not in ('parcial', 'pagado'))
     or (v_order.payment_status = 'pagado' and p_payment_status <> 'pagado')
     or v_order.payment_status = 'credito' then
    raise exception 'Transicion de pago no permitida';
  end if;
  if p_payment_status = 'pagado' and v_invoice_payment is null then
    raise exception 'Caja requiere una imagen de comprobante para marcar la orden como pagada';
  end if;
  if p_payment_status = 'pagado'
     and not public.quote_has_uploaded_payment_receipt(p_order_id, v_invoice_payment) then
    raise exception 'El comprobante debe ser una imagen cargada y verificada para esta orden';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set payment_status = p_payment_status,
      invoice_payment = case
        when p_payment_status = 'parcial' then null
        when p_payment_status = 'pagado' then v_invoice_payment
        else coalesce(p_invoice_payment, invoice_payment)
      end,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.quote_encode_payment_asset_uri(text) from public, anon, authenticated;
revoke all on function public.quote_has_uploaded_payment_receipt(uuid,text) from public, anon, authenticated;
revoke all on function public.quote_set_order_payment(uuid,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.quote_set_order_payment(uuid,text,text,timestamptz) to authenticated;

notify pgrst, 'reload schema';
