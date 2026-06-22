-- Credit payment support and client receivables.

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
    when 'credito' then 'credito'
    when 'crédito' then 'credito'
    when 'credit' then 'credito'
    else p_status
  end;
$$;

alter table public.orders
  drop constraint if exists orders_payment_status_internal_codes_check;

alter table public.orders
  add constraint orders_payment_status_internal_codes_check
  check (
    payment_status in (
      'Pending_Payment',
      'parcial',
      'pagado',
      'credito'
    )
  )
  not valid;

create table if not exists public.accounts_receivable (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  invoice_number text,
  original_amount numeric(12, 2) check (original_amount is null or original_amount > 0),
  balance numeric(12, 2) check (balance is null or balance >= 0),
  status text not null default 'open' check (status in ('open', 'partial', 'paid', 'void')),
  issued_at timestamptz not null default now(),
  due_date timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (balance is null or original_amount is null or balance <= original_amount)
);

create table if not exists public.client_payments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  payment_method text,
  receipt_url text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.client_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  client_payment_id uuid not null references public.client_payments(id) on delete cascade,
  accounts_receivable_id uuid not null references public.accounts_receivable(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_accounts_receivable_client_status
  on public.accounts_receivable (client_id, status, due_date);

create index if not exists idx_accounts_receivable_order_id
  on public.accounts_receivable (order_id);

create index if not exists idx_accounts_receivable_invoice_number
  on public.accounts_receivable (invoice_number);

create index if not exists idx_client_payments_client_created
  on public.client_payments (client_id, created_at desc);

create index if not exists idx_client_payment_allocations_payment
  on public.client_payment_allocations (client_payment_id);

create index if not exists idx_client_payment_allocations_receivable
  on public.client_payment_allocations (accounts_receivable_id);

alter table public.accounts_receivable enable row level security;
alter table public.client_payments enable row level security;
alter table public.client_payment_allocations enable row level security;

grant select on public.accounts_receivable to authenticated;
grant select on public.client_payments to authenticated;
grant select on public.client_payment_allocations to authenticated;

drop policy if exists accounts_receivable_select_admin_quote on public.accounts_receivable;
create policy accounts_receivable_select_admin_quote
  on public.accounts_receivable for select
  to authenticated
  using (public.current_profile_role() in ('admin', 'quote'));

drop policy if exists client_payments_select_admin_quote on public.client_payments;
create policy client_payments_select_admin_quote
  on public.client_payments for select
  to authenticated
  using (public.current_profile_role() in ('admin', 'quote'));

drop policy if exists client_payment_allocations_select_admin_quote on public.client_payment_allocations;
create policy client_payment_allocations_select_admin_quote
  on public.client_payment_allocations for select
  to authenticated
  using (public.current_profile_role() in ('admin', 'quote'));

create or replace function public.parse_order_receivable_amount(p_price anyelement)
returns numeric
language plpgsql
immutable
as $$
declare
  raw_value text := coalesce(p_price::text, '');
  normalized_value text;
begin
  normalized_value := nullif(regexp_replace(raw_value, '[^0-9.-]', '', 'g'), '');
  if normalized_value is null then
    return null;
  end if;
  return round(normalized_value::numeric, 2);
exception
  when others then
    return null;
end;
$$;

revoke all on function public.parse_order_receivable_amount(anyelement) from public;
revoke all on function public.parse_order_receivable_amount(anyelement) from anon;
revoke all on function public.parse_order_receivable_amount(anyelement) from authenticated;

create or replace function public.set_accounts_receivable_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_accounts_receivable_updated_at() from public;
revoke all on function public.set_accounts_receivable_updated_at() from anon;
revoke all on function public.set_accounts_receivable_updated_at() from authenticated;

drop trigger if exists trg_set_accounts_receivable_updated_at on public.accounts_receivable;
create trigger trg_set_accounts_receivable_updated_at
  before update on public.accounts_receivable
  for each row
  execute function public.set_accounts_receivable_updated_at();

create or replace function public.prevent_client_delete_with_open_receivables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.accounts_receivable ar
    where ar.client_id = old.id
      and ar.status in ('open', 'partial')
  ) then
    raise exception 'No se puede eliminar un cliente con cuentas por cobrar abiertas.';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_client_delete_with_open_receivables() from public;
revoke all on function public.prevent_client_delete_with_open_receivables() from anon;
revoke all on function public.prevent_client_delete_with_open_receivables() from authenticated;

drop trigger if exists trg_prevent_client_delete_with_open_receivables on public.clients;
create trigger trg_prevent_client_delete_with_open_receivables
  before delete on public.clients
  for each row
  execute function public.prevent_client_delete_with_open_receivables();

create or replace function public.check_production_eligibility()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'in_Production' and old.status is distinct from new.status then
    if coalesce(new.payment_status, old.payment_status) not in ('pagado', 'parcial', 'credito') then
      raise exception 'La orden no puede pasar a produccion hasta que el pago sea confirmado, marcado como parcial o aprobado a credito.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_check_production_eligibility on public.orders;
create trigger trg_check_production_eligibility
  before update of status on public.orders
  for each row
  execute function public.check_production_eligibility();

create or replace function public.enforce_partial_payment_order_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_admin boolean := public.current_profile_is_admin();
  v_role text := coalesce(public.current_profile_role(), '');
begin
  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status not in ('parcial', 'pagado') then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'parcial'
    and new.payment_status = 'pagado'
    and nullif(trim(coalesce(new.invoice_payment, '')), '') is null then
    raise exception 'Debes adjuntar la factura para marcar como pagado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'credito'
    and new.payment_status not in ('credito', 'pagado') then
    raise exception 'Una orden a credito solo puede mantenerse a credito o cambiarse a pagado mediante un cobro registrado.';
  end if;

  if tg_op = 'UPDATE'
    and old.payment_status = 'credito'
    and new.payment_status = 'pagado'
    and not exists (
      select 1
      from public.accounts_receivable ar
      where ar.order_id = new.id
        and ar.status = 'paid'
    ) then
    raise exception 'Debes registrar el cobro de la cuenta por cobrar antes de marcar el credito como pagado.';
  end if;

  if new.payment_status = 'parcial' then
    new.invoice_payment := null;
  end if;

  if new.payment_status = 'credito' then
    if (
        tg_op = 'INSERT'
        or (tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status)
      )
      and v_role not in ('admin', 'quote') then
      raise exception 'Solo caja o admin pueden aprobar pago a credito.';
    end if;

    if new.client_id is null then
      raise exception 'Para vender a credito debes registrar y vincular este cliente.';
    end if;

    if nullif(trim(coalesce(new.invoice_number, '')), '') is null then
      raise exception 'La orden debe tener un numero de facturacion para vender a credito.';
    end if;

    new.invoice_payment := null;
  end if;

  if new.status = 'in_Delivered' and new.payment_status not in ('pagado', 'credito') then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a credito.';
  end if;

  if new.payment_status = 'parcial' and new.status = 'cancelled' then
    raise exception 'No se puede cancelar una orden con pago parcial.';
  end if;

  if new.payment_status = 'credito'
    and new.status = 'cancelled'
    and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden a credito.';
  end if;

  if new.payment_status = 'pagado'
    and new.status = 'cancelled'
    and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden pagada.';
  end if;

  if new.payment_status = 'parcial' and (
    coalesce(new.is_archived, false)
    or coalesce(new.is_archived_admin, false)
    or coalesce(new.is_archived_designer, false)
    or coalesce(new.is_archived_quote, false)
    or coalesce(new.is_archived_delivery, false)
    or coalesce(new.is_archived_production, false)
  ) then
    raise exception 'No se puede archivar una orden con pago parcial.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_partial_payment_order_guards() from public;
revoke all on function public.enforce_partial_payment_order_guards() from anon;
revoke all on function public.enforce_partial_payment_order_guards() from authenticated;

drop trigger if exists trg_enforce_partial_payment_order_guards on public.orders;
create trigger trg_enforce_partial_payment_order_guards
  before insert or update on public.orders
  for each row
  execute function public.enforce_partial_payment_order_guards();

create or replace function public.sync_credit_receivable_from_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.payment_status <> 'credito' then
    return new;
  end if;

  if nullif(trim(coalesce(new.invoice_number, '')), '') is null then
    raise exception 'La orden debe tener un numero de facturacion para vender a credito.';
  end if;

  insert into public.accounts_receivable (
    order_id,
    client_id,
    invoice_number,
    status,
    issued_at,
    created_by
  )
  values (
    new.id,
    new.client_id,
    nullif(trim(coalesce(new.invoice_number, '')), ''),
    'open',
    now(),
    auth.uid()
  )
  on conflict (order_id) do update
  set client_id = excluded.client_id,
      invoice_number = excluded.invoice_number,
      status = case
        when public.accounts_receivable.status = 'void' then 'open'
        else public.accounts_receivable.status
      end,
      updated_at = now();

  return new;
end;
$$;

revoke all on function public.sync_credit_receivable_from_order() from public;
revoke all on function public.sync_credit_receivable_from_order() from anon;
revoke all on function public.sync_credit_receivable_from_order() from authenticated;

drop trigger if exists trg_sync_credit_receivable_from_order on public.orders;
create trigger trg_sync_credit_receivable_from_order
  after insert or update of payment_status, client_id, invoice_number on public.orders
  for each row
  when (new.payment_status = 'credito')
  execute function public.sync_credit_receivable_from_order();

create or replace function public.void_credit_receivable_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled'
    and old.status is distinct from new.status
    and new.payment_status = 'credito' then
    update public.accounts_receivable
    set status = 'void',
        updated_at = now()
    where order_id = new.id
      and status in ('open', 'partial');
  end if;

  return new;
end;
$$;

revoke all on function public.void_credit_receivable_on_cancel() from public;
revoke all on function public.void_credit_receivable_on_cancel() from anon;
revoke all on function public.void_credit_receivable_on_cancel() from authenticated;

drop trigger if exists trg_void_credit_receivable_on_cancel on public.orders;
create trigger trg_void_credit_receivable_on_cancel
  after update of status on public.orders
  for each row
  execute function public.void_credit_receivable_on_cancel();

create or replace function public.mark_order_as_credit(
  p_order_id uuid,
  p_due_date timestamptz default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_order public.orders;
  v_updated_order public.orders;
  v_recipients uuid[];
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden aprobar pago a credito.';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'La orden no existe.';
  end if;

  if v_role <> 'admin' and v_order.quote_id is distinct from v_uid then
    raise exception 'No tienes acceso a esta orden.';
  end if;

  if v_order.client_id is null then
    raise exception 'Para vender a credito debes registrar y vincular este cliente.';
  end if;

  if v_order.payment_status = 'parcial' then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;

  if nullif(trim(coalesce(v_order.invoice_number, '')), '') is null then
    raise exception 'La orden debe tener un numero de facturacion para vender a credito.';
  end if;

  update public.orders
  set payment_status = 'credito',
      invoice_payment = null,
      updated_at = now(),
      updated_by = v_uid
  where id = p_order_id
  returning * into v_updated_order;

  insert into public.accounts_receivable (
    order_id,
    client_id,
    invoice_number,
    status,
    issued_at,
    due_date,
    created_by
  )
  values (
    p_order_id,
    v_updated_order.client_id,
    nullif(trim(coalesce(v_updated_order.invoice_number, '')), ''),
    'open',
    now(),
    p_due_date,
    v_uid
  )
  on conflict (order_id) do update
  set client_id = excluded.client_id,
      invoice_number = excluded.invoice_number,
      due_date = excluded.due_date,
      status = case
        when public.accounts_receivable.status = 'void' then 'open'
        else public.accounts_receivable.status
      end,
      updated_at = now();

  insert into public.order_events(
    order_id,
    actor_id,
    event_type,
    old_payment_status,
    new_payment_status,
    changes
  )
  values (
    p_order_id,
    v_uid,
    'credit_granted',
    v_order.payment_status,
    'credito',
    jsonb_build_object(
      'client_id', v_updated_order.client_id,
      'invoice_number', v_updated_order.invoice_number,
      'due_date', p_due_date
    )
  );

  v_recipients := array_remove(public.get_admin_user_ids() || public.get_role_user_ids('quote'), null);

  perform public.notify_many(
    v_recipients,
    'order_updated',
    'Credito aprobado',
    'La orden de ' || coalesce(v_updated_order.client_name, 'cliente') || ' fue marcada como pago a credito.',
    p_order_id,
    jsonb_build_object(
      'event_kind', 'credit_granted',
      'payment_status', 'credito',
      'client_id', v_updated_order.client_id,
      'invoice_number', v_updated_order.invoice_number,
      'actor_id', v_uid
    )
  );

  return v_updated_order;
end;
$$;

revoke all on function public.mark_order_as_credit(uuid, timestamptz) from public;
revoke all on function public.mark_order_as_credit(uuid, timestamptz) from anon;
grant execute on function public.mark_order_as_credit(uuid, timestamptz) to authenticated;

create or replace function public.mark_order_as_credit(
  p_order_id uuid,
  p_due_date timestamptz,
  p_amount numeric
)
returns public.orders
language sql
security definer
set search_path = public
as $$
  select public.mark_order_as_credit(p_order_id, p_due_date);
$$;

revoke all on function public.mark_order_as_credit(uuid, timestamptz, numeric) from public;
revoke all on function public.mark_order_as_credit(uuid, timestamptz, numeric) from anon;
grant execute on function public.mark_order_as_credit(uuid, timestamptz, numeric) to authenticated;

create or replace function public.settle_credit_orders(
  p_order_ids uuid[],
  p_notes text default null,
  p_receipt_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_order public.orders;
  v_settled_order_ids uuid[] := array[]::uuid[];
  v_recipients uuid[];
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden cerrar creditos.';
  end if;

  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'Debes seleccionar al menos una orden a credito.';
  end if;

  for v_order in
    select *
    from public.orders
    where id = any(p_order_ids)
    for update
  loop
    if v_order.payment_status <> 'credito' then
      raise exception 'La orden % no esta en pago a credito.', v_order.id;
    end if;

    update public.accounts_receivable
    set status = 'paid',
        balance = 0,
        updated_at = now()
    where order_id = v_order.id
      and status in ('open', 'partial', 'paid', 'void');

    if not found then
      insert into public.accounts_receivable (
        order_id,
        client_id,
        invoice_number,
        status,
        issued_at,
        created_by
      )
      values (
        v_order.id,
        v_order.client_id,
        nullif(trim(coalesce(v_order.invoice_number, '')), ''),
        'paid',
        now(),
        v_uid
      );
    end if;

    update public.orders
    set payment_status = 'pagado',
        invoice_payment = coalesce(nullif(trim(coalesce(p_receipt_url, '')), ''), invoice_payment),
        updated_at = now(),
        updated_by = v_uid
    where id = v_order.id;

    insert into public.order_events(
      order_id,
      actor_id,
      event_type,
      old_payment_status,
      new_payment_status,
      changes
    )
    values (
      v_order.id,
      v_uid,
      'credit_settled',
      'credito',
      'pagado',
      jsonb_build_object(
        'client_id', v_order.client_id,
        'invoice_number', v_order.invoice_number,
        'notes', nullif(trim(coalesce(p_notes, '')), ''),
        'receipt_url', nullif(trim(coalesce(p_receipt_url, '')), '')
      )
    );

    v_settled_order_ids := array_append(v_settled_order_ids, v_order.id);
  end loop;

  if cardinality(v_settled_order_ids) <> cardinality(p_order_ids) then
    raise exception 'Una o mas ordenes seleccionadas no existen.';
  end if;

  v_recipients := array_remove(public.get_admin_user_ids() || public.get_role_user_ids('quote'), null);

  perform public.notify_many(
    v_recipients,
    'order_updated',
    'Credito saldado',
    'Se marcaron como pagadas ' || cardinality(v_settled_order_ids)::text || ' ordenes a credito.',
    null,
    jsonb_build_object(
      'event_kind', 'credit_settled',
      'order_ids', v_settled_order_ids,
      'actor_id', v_uid
    )
  );

  return jsonb_build_object(
    'settled_order_ids', v_settled_order_ids,
    'settled_count', cardinality(v_settled_order_ids)
  );
end;
$$;

revoke all on function public.settle_credit_orders(uuid[], text, text) from public;
revoke all on function public.settle_credit_orders(uuid[], text, text) from anon;
grant execute on function public.settle_credit_orders(uuid[], text, text) to authenticated;

create or replace function public.record_client_payment(
  p_client_id uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_receipt_url text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_payment_id uuid;
  v_remaining numeric := round(coalesce(p_amount, 0), 2);
  v_apply_amount numeric;
  v_total_applied numeric := 0;
  v_receivable record;
  v_paid_orders uuid[] := array[]::uuid[];
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  select p.role
  into v_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden registrar cobros de credito.';
  end if;

  if p_client_id is null then
    raise exception 'Debes seleccionar un cliente.';
  end if;

  if v_remaining <= 0 then
    raise exception 'El monto del pago debe ser mayor a cero.';
  end if;

  if not exists (select 1 from public.clients c where c.id = p_client_id) then
    raise exception 'El cliente no existe.';
  end if;

  if not exists (
    select 1
    from public.accounts_receivable ar
    where ar.client_id = p_client_id
      and ar.status in ('open', 'partial')
      and ar.balance > 0
  ) then
    raise exception 'El cliente no tiene deuda pendiente.';
  end if;

  insert into public.client_payments (
    client_id,
    amount,
    payment_method,
    receipt_url,
    notes,
    created_by
  )
  values (
    p_client_id,
    round(p_amount, 2),
    nullif(trim(coalesce(p_payment_method, '')), ''),
    nullif(trim(coalesce(p_receipt_url, '')), ''),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_uid
  )
  returning id into v_payment_id;

  for v_receivable in
    select *
    from public.accounts_receivable ar
    where ar.client_id = p_client_id
      and ar.status in ('open', 'partial')
      and ar.balance > 0
    order by ar.due_date nulls last, ar.issued_at, ar.created_at
    for update
  loop
    exit when v_remaining <= 0;

    v_apply_amount := least(v_remaining, v_receivable.balance);
    v_remaining := round(v_remaining - v_apply_amount, 2);
    v_total_applied := round(v_total_applied + v_apply_amount, 2);

    insert into public.client_payment_allocations (
      client_payment_id,
      accounts_receivable_id,
      order_id,
      amount
    )
    values (
      v_payment_id,
      v_receivable.id,
      v_receivable.order_id,
      v_apply_amount
    );

    update public.accounts_receivable
    set balance = round(balance - v_apply_amount, 2),
        status = case
          when round(balance - v_apply_amount, 2) = 0 then 'paid'
          else 'partial'
        end
    where id = v_receivable.id;

    if round(v_receivable.balance - v_apply_amount, 2) = 0 then
      update public.orders
      set payment_status = 'pagado',
          invoice_payment = coalesce(nullif(trim(coalesce(p_receipt_url, '')), ''), invoice_payment),
          updated_at = now(),
          updated_by = v_uid
      where id = v_receivable.order_id;

      v_paid_orders := array_append(v_paid_orders, v_receivable.order_id);
    end if;
  end loop;

  insert into public.order_events(
    order_id,
    actor_id,
    event_type,
    changes
  )
  select
    allocation.order_id,
    v_uid,
    'client_credit_payment_applied',
    jsonb_build_object(
      'client_payment_id', v_payment_id,
      'accounts_receivable_id', allocation.accounts_receivable_id,
      'amount', allocation.amount
    )
  from public.client_payment_allocations allocation
  where allocation.client_payment_id = v_payment_id;

  return jsonb_build_object(
    'client_payment_id', v_payment_id,
    'applied_amount', v_total_applied,
    'unapplied_amount', v_remaining,
    'paid_order_ids', v_paid_orders
  );
end;
$$;

revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from public;
revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from anon;
grant execute on function public.record_client_payment(uuid, numeric, text, text, text) to authenticated;

create or replace function public.record_client_payment(
  p_client_id uuid,
  p_amount numeric,
  p_payment_method text default null,
  p_receipt_url text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'NeonPrint no registra montos internos para creditos. Usa settle_credit_orders para marcar facturas como saldadas.';
end;
$$;

revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from public;
revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from anon;
grant execute on function public.record_client_payment(uuid, numeric, text, text, text) to authenticated;
