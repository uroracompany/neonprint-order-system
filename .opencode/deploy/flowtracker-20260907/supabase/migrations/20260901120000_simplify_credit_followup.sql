-- Crédito es seguimiento operativo de órdenes, no una cuenta corriente monetaria.
-- Conserva el historial existente y reduce el estado activo a open/resolved/void.

alter table public.accounts_receivable
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists resolution_note text,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id) on delete set null,
  add column if not exists void_reason text;

update public.accounts_receivable
set status = case status
  when 'partial' then 'open'
  when 'paid' then 'resolved'
  else status
end,
    resolved_at = case when status = 'paid' then coalesce(resolved_at, updated_at, created_at) else resolved_at end;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.accounts_receivable'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
      and pg_get_constraintdef(c.oid) ilike '%partial%'
  loop
    execute format('alter table public.accounts_receivable drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

alter table public.accounts_receivable
  drop constraint if exists accounts_receivable_followup_status_check;

alter table public.accounts_receivable
  add constraint accounts_receivable_followup_status_check
  check (status in ('open', 'resolved', 'void'));

drop index if exists public.idx_accounts_receivable_open_due_at;
create index if not exists idx_accounts_receivable_open_client_issued
  on public.accounts_receivable (client_id, issued_at desc)
  where status = 'open';

-- A credit grant is the only operation that can open an obligation.  Generic
-- order edits must keep the existing follow-up state intact.
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

  insert into public.accounts_receivable (
    order_id, client_id, invoice_number, status, issued_at, created_by
  )
  values (
    new.id, new.client_id, nullif(trim(coalesce(new.invoice_number, '')), ''), 'open', now(), auth.uid()
  )
  on conflict (order_id) do update
  set client_id = excluded.client_id,
      invoice_number = excluded.invoice_number,
      updated_at = now();

  return new;
end;
$$;

create or replace function public.prevent_open_credit_identity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.client_id is distinct from old.client_id or new.invoice_number is distinct from old.invoice_number)
    and exists (
      select 1 from public.accounts_receivable ar
      where ar.order_id = old.id and ar.status = 'open'
    ) then
    raise exception 'No se puede cambiar el cliente ni la factura de una orden con crédito pendiente.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_open_credit_identity_change on public.orders;
create trigger trg_prevent_open_credit_identity_change
before update of client_id, invoice_number on public.orders
for each row execute function public.prevent_open_credit_identity_change();

create or replace function public.void_credit_receivable_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.accounts_receivable
    set status = 'void',
        voided_at = now(),
        voided_by = auth.uid(),
        void_reason = coalesce(nullif(trim(coalesce(new.cancellation_reason, '')), ''), 'Orden cancelada'),
        updated_at = now()
    where order_id = new.id and status = 'open';
  end if;
  return new;
end;
$$;

create or replace function public.reset_cancelled_credit_on_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'cancelled'
    and new.status <> 'cancelled'
    and old.payment_status = 'credito' then
    new.payment_status := 'Pending_Payment';
    new.invoice_payment := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reset_cancelled_credit_on_reopen on public.orders;
create trigger trg_reset_cancelled_credit_on_reopen
before update of status on public.orders
for each row execute function public.reset_cancelled_credit_on_reopen();

create or replace function public.prevent_credit_order_purge()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.accounts_receivable ar where ar.order_id = old.id) then
    raise exception 'No se puede purgar una orden con historial de crédito.';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_prevent_credit_order_purge on public.orders;
create trigger trg_prevent_credit_order_purge
before delete on public.orders
for each row execute function public.prevent_credit_order_purge();

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
  v_actor uuid := auth.uid();
  v_role text;
  v_order_ids uuid[];
  v_client_id uuid;
  v_count integer;
  v_notes text := nullif(trim(coalesce(p_notes, '')), '');
begin
  select role into v_role
  from public.profiles
  where id = v_actor and coalesce(employment_status, true) and deleted_at is null;

  if v_actor is null or v_role <> 'quote' then
    raise exception 'Solo Caja puede cerrar seguimientos de crédito.';
  end if;

  select coalesce(array_agg(distinct item.order_id), array[]::uuid[])
  into v_order_ids
  from unnest(coalesce(p_order_ids, array[]::uuid[])) as item(order_id)
  where item.order_id is not null;

  if cardinality(v_order_ids) = 0 then
    raise exception 'Debes seleccionar al menos una orden pendiente.';
  end if;

  perform 1 from public.orders o where o.id = any(v_order_ids) for update;
  perform 1 from public.accounts_receivable ar where ar.order_id = any(v_order_ids) for update;

  select min(ar.client_id), count(*)
  into v_client_id, v_count
  from public.accounts_receivable ar
  join public.orders o on o.id = ar.order_id
  where ar.order_id = any(v_order_ids)
    and ar.status = 'open'
    and o.payment_status = 'credito'
    and o.status <> 'cancelled';

  if v_count <> cardinality(v_order_ids) then
    raise exception 'Todas las órdenes deben tener un seguimiento de crédito abierto.';
  end if;

  if exists (
    select 1 from public.accounts_receivable ar
    where ar.order_id = any(v_order_ids) and ar.client_id is distinct from v_client_id
  ) then
    raise exception 'Solo puedes cerrar órdenes pendientes del mismo cliente.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);

  update public.accounts_receivable
  set status = 'resolved',
      resolved_at = now(),
      resolved_by = v_actor,
      resolution_note = v_notes,
      updated_at = now()
  where order_id = any(v_order_ids) and status = 'open';

  update public.orders
  set payment_status = 'pagado',
      invoice_payment = coalesce(nullif(trim(coalesce(p_receipt_url, '')), ''), invoice_payment),
      updated_at = now(),
      updated_by = v_actor
  where id = any(v_order_ids);

  insert into public.order_events (order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
  select order_id, v_actor, 'credit_resolved', 'credito', 'pagado',
    jsonb_build_object('client_id', v_client_id, 'notes', v_notes)
  from unnest(v_order_ids) as item(order_id);

  return jsonb_build_object('resolved_order_ids', v_order_ids, 'resolved_count', cardinality(v_order_ids));
end;
$$;

-- Keep the existing operational payment guards, but make a resolved follow-up
-- (rather than a monetary `paid` receivable) the prerequisite for closing credit.
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
  if tg_op = 'UPDATE' and old.payment_status = 'parcial' and new.payment_status not in ('parcial', 'pagado') and v_role <> 'admin' then
    raise exception 'Una orden con pago parcial solo puede mantenerse parcial o cambiarse a pagado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'parcial' and new.payment_status = 'pagado'
    and nullif(trim(coalesce(new.invoice_payment, '')), '') is null then
    raise exception 'Debes adjuntar la factura para marcar como pagado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'credito' and new.payment_status not in ('credito', 'pagado')
    and not (old.status = 'cancelled' and new.status <> 'cancelled' and new.payment_status = 'Pending_Payment') then
    raise exception 'Una orden a crédito solo puede mantenerse a crédito o cambiarse a pagado mediante un cierre registrado.';
  end if;
  if tg_op = 'UPDATE' and old.payment_status = 'credito' and new.payment_status = 'pagado'
    and not exists (
      select 1 from public.accounts_receivable ar where ar.order_id = new.id and ar.status = 'resolved'
    ) then
    raise exception 'Debes cerrar el seguimiento de crédito antes de marcar la orden como pagada.';
  end if;
  if new.payment_status = 'parcial' then new.invoice_payment := null; end if;
  if new.payment_status = 'credito' then
    if (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status)) and v_role not in ('admin', 'quote') then
      raise exception 'Solo Caja o Administración pueden aprobar pago a crédito.';
    end if;
    if new.client_id is null or nullif(trim(coalesce(new.invoice_number, '')), '') is null then
      raise exception 'Para vender a crédito debes registrar cliente y factura.';
    end if;
    new.invoice_payment := null;
  end if;
  if new.status = 'in_Delivered' and new.payment_status not in ('pagado', 'credito') then
    raise exception 'No se puede entregar la orden hasta que este totalmente pagada o aprobada a crédito.';
  end if;
  if new.payment_status = 'parcial' and new.status = 'cancelled' then
    raise exception 'No se puede cancelar una orden con pago parcial.';
  end if;
  if new.payment_status = 'credito' and new.status = 'cancelled' and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden a crédito.';
  end if;
  if new.payment_status = 'pagado' and new.status = 'cancelled' and not v_is_admin then
    raise exception 'Solo un administrador puede cancelar una orden pagada.';
  end if;
  return new;
end;
$$;

create or replace function public.create_credit_client_reminder(
  p_client_id uuid,
  p_remind_at timestamptz,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reminder_id uuid;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'quote' and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo Caja puede crear recordatorios de crédito.';
  end if;
  if p_client_id is null or p_remind_at is null or p_remind_at <= now() or v_note is null then
    raise exception 'El recordatorio requiere cliente, fecha futura y una nota.';
  end if;
  if not exists (
    select 1 from public.accounts_receivable ar
    join public.orders o on o.id = ar.order_id
    where ar.client_id = p_client_id and ar.status = 'open' and o.payment_status = 'credito' and o.status <> 'cancelled'
  ) then
    raise exception 'El cliente ya no tiene órdenes de crédito pendientes.';
  end if;

  update public.credit_custom_reminders
  set status = 'cancelled', updated_at = now()
  where client_id = p_client_id and status in ('scheduled', 'due');

  insert into public.credit_custom_reminders (created_by, client_id, remind_at, note, status, visibility_scope)
  values (v_actor, p_client_id, p_remind_at, v_note, 'scheduled', 'creator')
  returning id into v_reminder_id;

  return v_reminder_id;
end;
$$;

create or replace function public.dispatch_due_credit_reminder_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reminder record;
  v_count integer := 0;
begin
  if v_actor is null then raise exception 'No tienes una sesión activa.'; end if;
  for v_reminder in
    select r.id, r.client_id, r.created_by, r.note, r.remind_at
    from public.credit_custom_reminders r
    where r.status in ('scheduled', 'due') and r.remind_at <= now() and r.notified_at is null
    order by r.remind_at asc limit 50
  loop
    if exists (
      select 1 from public.accounts_receivable ar
      join public.orders o on o.id = ar.order_id
      where ar.client_id = v_reminder.client_id and ar.status = 'open' and o.payment_status = 'credito' and o.status <> 'cancelled'
    ) then
      perform public.notify_many(
        array[v_reminder.created_by], 'info', 'Recordatorio de crédito',
        'Tienes órdenes de crédito pendientes para revisar.', null,
        jsonb_build_object('event_kind', 'credit_client_reminder_due', 'reminder_id', v_reminder.id, 'client_id', v_reminder.client_id, 'remind_at', v_reminder.remind_at)
      );
      update public.credit_custom_reminders
      set status = 'due', notified_at = now(), updated_at = now()
      where id = v_reminder.id;
      v_count := v_count + 1;
    else
      update public.credit_custom_reminders
      set status = 'cancelled', updated_at = now()
      where id = v_reminder.id;
    end if;
  end loop;
  return v_count;
end;
$$;

create table if not exists public.credit_pending_alert_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_acknowledged_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.credit_pending_alert_states enable row level security;
revoke all on public.credit_pending_alert_states from public, anon, authenticated;

create or replace function public.credit_pending_alert_is_due()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_last_acknowledged_at timestamptz;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'quote' and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    return false;
  end if;
  if not exists (
    select 1 from public.accounts_receivable ar
    join public.orders o on o.id = ar.order_id
    where ar.status = 'open' and o.payment_status = 'credito' and o.status <> 'cancelled'
  ) then
    return false;
  end if;
  select last_acknowledged_at into v_last_acknowledged_at
  from public.credit_pending_alert_states where user_id = v_actor;
  return v_last_acknowledged_at is null or v_last_acknowledged_at <= now() - interval '30 days';
end;
$$;

create or replace function public.acknowledge_credit_pending_alert()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor and p.role = 'quote' and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Solo Caja puede confirmar el aviso de créditos.';
  end if;
  insert into public.credit_pending_alert_states (user_id, last_acknowledged_at, updated_at)
  values (v_actor, now(), now())
  on conflict (user_id) do update
  set last_acknowledged_at = excluded.last_acknowledged_at, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.create_credit_client_reminder(uuid, timestamptz, text), public.credit_pending_alert_is_due(), public.acknowledge_credit_pending_alert() from public, anon;
grant execute on function public.create_credit_client_reminder(uuid, timestamptz, text), public.credit_pending_alert_is_due(), public.acknowledge_credit_pending_alert() to authenticated;
revoke all on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[], text) from public, anon, authenticated;
revoke all on function public.settle_credit_orders(uuid[], text, text) from public, anon;
grant execute on function public.settle_credit_orders(uuid[], text, text) to authenticated;

notify pgrst, 'reload schema';
