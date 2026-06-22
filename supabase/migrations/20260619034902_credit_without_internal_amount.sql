-- Make credit payments reference the external billing system instead of an internal amount.

alter table public.accounts_receivable
  add column if not exists invoice_number text;

alter table public.accounts_receivable
  alter column original_amount drop not null,
  alter column balance drop not null;

alter table public.accounts_receivable
  drop constraint if exists accounts_receivable_original_amount_check,
  drop constraint if exists accounts_receivable_balance_check,
  drop constraint if exists accounts_receivable_check;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.accounts_receivable'::regclass
      and conname = 'accounts_receivable_original_amount_optional_check'
  ) then
    alter table public.accounts_receivable
      add constraint accounts_receivable_original_amount_optional_check
      check (original_amount is null or original_amount > 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.accounts_receivable'::regclass
      and conname = 'accounts_receivable_balance_optional_check'
  ) then
    alter table public.accounts_receivable
      add constraint accounts_receivable_balance_optional_check
      check (balance is null or balance >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.accounts_receivable'::regclass
      and conname = 'accounts_receivable_balance_lte_original_optional_check'
  ) then
    alter table public.accounts_receivable
      add constraint accounts_receivable_balance_lte_original_optional_check
      check (balance is null or original_amount is null or balance <= original_amount);
  end if;
end;
$$;

create index if not exists idx_accounts_receivable_invoice_number
  on public.accounts_receivable (invoice_number);

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
    raise exception 'Una orden a credito solo puede mantenerse a credito o cambiarse a pagado mediante un cierre registrado.';
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
    raise exception 'Debes cerrar la cuenta por cobrar antes de marcar el credito como pagado.';
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

  if nullif(trim(coalesce(v_order.invoice_number, '')), '') is null then
    raise exception 'La orden debe tener un numero de facturacion para vender a credito.';
  end if;

  if v_order.payment_status = 'parcial' then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
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
begin
  raise exception 'NeonPrint no registra montos internos para creditos. Usa settle_credit_orders para marcar facturas como saldadas.';
end;
$$;

revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from public;
revoke all on function public.record_client_payment(uuid, numeric, text, text, text) from anon;
grant execute on function public.record_client_payment(uuid, numeric, text, text, text) to authenticated;
