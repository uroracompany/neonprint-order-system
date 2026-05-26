-- Harden public tracking responses and normalize payment statuses.
-- This migration also makes payment receipts private in Storage.

create or replace function public.normalize_payment_status_value(p_status text)
returns text
language sql
immutable
as $$
  select case lower(trim(coalesce(p_status, '')))
    when '' then p_status
    when 'pending_payment' then 'Pending_Payment'
    when 'pending payment' then 'Pending_Payment'
    when 'pendiente' then 'Pending_Payment'
    when 'parcial' then 'parcial'
    when 'partial' then 'parcial'
    when 'pagado' then 'pagado'
    when 'paid' then 'pagado'
    else p_status
  end;
$$;

update public.orders
set payment_status = public.normalize_payment_status_value(payment_status)
where payment_status is distinct from public.normalize_payment_status_value(payment_status);

update public.order_events
set
  old_payment_status = public.normalize_payment_status_value(old_payment_status),
  new_payment_status = public.normalize_payment_status_value(new_payment_status)
where
  old_payment_status is distinct from public.normalize_payment_status_value(old_payment_status)
  or new_payment_status is distinct from public.normalize_payment_status_value(new_payment_status);

update public.notifications
set metadata =
  case
    when metadata ? 'payment_status'
      then jsonb_set(metadata, '{payment_status}', to_jsonb(public.normalize_payment_status_value(metadata->>'payment_status')), false)
    else metadata
  end
where metadata ? 'payment_status'
  and metadata->>'payment_status' is not null;

update public.notifications
set metadata =
  case
    when metadata ? 'previous_payment_status'
      then jsonb_set(metadata, '{previous_payment_status}', to_jsonb(public.normalize_payment_status_value(metadata->>'previous_payment_status')), false)
    else metadata
  end
where metadata ? 'previous_payment_status'
  and metadata->>'previous_payment_status' is not null;

create or replace function public.normalize_order_payment_status_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.payment_status := public.normalize_payment_status_value(new.payment_status);
  return new;
end;
$$;

revoke all on function public.normalize_order_payment_status_before_write() from public;
revoke all on function public.normalize_order_payment_status_before_write() from anon;
revoke all on function public.normalize_order_payment_status_before_write() from authenticated;

drop trigger if exists trg_normalize_order_payment_status_before_write on public.orders;
create trigger trg_normalize_order_payment_status_before_write
  before insert or update of payment_status on public.orders
  for each row
  execute function public.normalize_order_payment_status_before_write();

alter table public.orders
  drop constraint if exists orders_payment_status_internal_codes_check;

alter table public.orders
  add constraint orders_payment_status_internal_codes_check
  check (
    payment_status in (
      'Pending_Payment',
      'parcial',
      'pagado'
    )
  )
  not valid;

drop function if exists public.get_order_tracking(uuid);
drop function if exists public.get_order_tracking(text);

create or replace function public.get_order_tracking(p_token text)
returns table(
  id uuid,
  client_name text,
  status text,
  payment_status text,
  created_at timestamptz,
  updated_at timestamptz,
  delivery_date text,
  order_type text,
  order_design_type text,
  cancellation_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id::uuid,
    o.client_name::text,
    o.status::text,
    o.payment_status::text,
    o.created_at::timestamptz,
    o.updated_at::timestamptz,
    o.delivery_date::text,
    o.order_type::text,
    o.order_design_type::text,
    o.cancellation_reason::text
  from public.orders o
  where o.tracking_token = p_token::uuid
  limit 1;
$$;

grant execute on function public.get_order_tracking(text) to anon;

drop function if exists public.get_order_tracking_events(uuid);
drop function if exists public.get_order_tracking_events(text);

create or replace function public.get_order_tracking_events(p_token text)
returns table(
  event_type text,
  new_status text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.event_type::text,
    e.new_status::text,
    e.created_at::timestamptz
  from public.order_events e
  inner join public.orders o on o.id = e.order_id
  where o.tracking_token = p_token::uuid
    and e.new_status is not null
  order by e.created_at asc;
$$;

grant execute on function public.get_order_tracking_events(text) to anon;

create or replace function public.can_manage_payment_invoice_path(object_name text)
returns boolean
language sql
stable
security invoker
set search_path = public, storage
as $$
  select exists (
    select 1
    from public.orders o
    where o.id::text = (storage.foldername(object_name))[1]
      and (
        public.current_profile_is_admin()
        or auth.uid() in (o.created_by, o.seller_id, o.quote_id, o.delivery_id)
      )
  );
$$;

revoke all on function public.can_manage_payment_invoice_path(text) from public;
grant execute on function public.can_manage_payment_invoice_path(text) to authenticated;

update storage.buckets
set
  "public" = false,
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf'
  ]
where id = 'payment-invoice';

drop policy if exists payment_invoice_select_authenticated on storage.objects;
drop policy if exists payment_invoice_insert_authenticated on storage.objects;
drop policy if exists payment_invoice_update_authenticated on storage.objects;
drop policy if exists payment_invoice_delete_authenticated on storage.objects;

create policy payment_invoice_select_authenticated
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'payment-invoice'
    and (
      public.current_profile_is_admin()
      or public.can_manage_payment_invoice_path(name)
    )
  );

create policy payment_invoice_insert_authenticated
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'payment-invoice'
    and (
      public.current_profile_is_admin()
      or public.can_manage_payment_invoice_path(name)
    )
  );

create policy payment_invoice_update_authenticated
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'payment-invoice'
    and (
      public.current_profile_is_admin()
      or public.can_manage_payment_invoice_path(name)
    )
  )
  with check (
    bucket_id = 'payment-invoice'
    and (
      public.current_profile_is_admin()
      or public.can_manage_payment_invoice_path(name)
    )
  );

create policy payment_invoice_delete_authenticated
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'payment-invoice'
    and (
      public.current_profile_is_admin()
      or public.can_manage_payment_invoice_path(name)
    )
  );
