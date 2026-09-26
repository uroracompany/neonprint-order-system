-- Enforce strict creation rules for custom credit reminders.

update public.credit_custom_reminders
set note = 'Recordatorio migrado sin nota registrada.'
where nullif(btrim(coalesce(note, '')), '') is null;

alter table public.credit_custom_reminders
  alter column note set not null;

alter table public.credit_custom_reminders
  drop constraint if exists credit_custom_reminders_note_required;

alter table public.credit_custom_reminders
  add constraint credit_custom_reminders_note_required
  check (btrim(note) <> '');

delete from public.credit_custom_reminder_orders
where order_id is null;

alter table public.credit_custom_reminder_orders
  alter column order_id set not null;

create or replace function public.enforce_credit_custom_reminder_order_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select r.client_id
  into v_client_id
  from public.credit_custom_reminders r
  where r.id = new.reminder_id;

  if v_client_id is null then
    raise exception 'El recordatorio no existe.';
  end if;

  if new.order_id is null then
    raise exception 'Los recordatorios personalizados solo pueden crearse para ordenes a credito.';
  end if;

  if not exists (
    select 1
    from public.accounts_receivable ar
    join public.orders o on o.id = ar.order_id
    where ar.order_id = new.order_id
      and ar.client_id = v_client_id
      and ar.status in ('open', 'partial')
      and o.payment_status = 'credito'
      and o.client_id = v_client_id
      and (
        new.accounts_receivable_id is null
        or ar.id = new.accounts_receivable_id
      )
  ) then
    raise exception 'Los recordatorios personalizados solo pueden crearse para ordenes a credito.';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_credit_custom_reminder_order_link() from public;
revoke all on function public.enforce_credit_custom_reminder_order_link() from anon;
revoke all on function public.enforce_credit_custom_reminder_order_link() from authenticated;

drop trigger if exists trg_enforce_credit_custom_reminder_order_link
  on public.credit_custom_reminder_orders;

create trigger trg_enforce_credit_custom_reminder_order_link
before insert or update on public.credit_custom_reminder_orders
for each row
execute function public.enforce_credit_custom_reminder_order_link();

create or replace function public.create_credit_custom_reminder(
  p_client_id uuid,
  p_remind_at timestamptz,
  p_note text,
  p_order_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_order_ids uuid[];
  v_expected_count integer;
  v_valid_count integer;
  v_reminder_id uuid;
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
    raise exception 'Solo caja o admin pueden crear recordatorios de credito.';
  end if;

  if p_client_id is null then
    raise exception 'Selecciona un cliente para el recordatorio.';
  end if;

  if p_remind_at is null then
    raise exception 'Selecciona una fecha antes de continuar.';
  end if;

  if p_remind_at <= now() then
    raise exception 'Selecciona una fecha y hora futura para el recordatorio.';
  end if;

  if v_note is null then
    raise exception 'Describe la razon del recordatorio antes de continuar.';
  end if;

  select coalesce(array_agg(selected.order_id), array[]::uuid[])
  into v_order_ids
  from (
    select distinct order_id
    from unnest(coalesce(p_order_ids, array[]::uuid[])) as input(order_id)
    where order_id is not null
  ) selected;

  v_expected_count := cardinality(v_order_ids);
  if v_expected_count = 0 then
    raise exception 'Los recordatorios personalizados solo pueden crearse para ordenes a credito.';
  end if;

  select count(distinct ar.order_id)
  into v_valid_count
  from public.accounts_receivable ar
  join public.orders o on o.id = ar.order_id
  where ar.order_id = any(v_order_ids)
    and ar.client_id = p_client_id
    and ar.status in ('open', 'partial')
    and o.payment_status = 'credito'
    and o.client_id = p_client_id;

  if v_valid_count <> v_expected_count then
    raise exception 'Los recordatorios personalizados solo pueden crearse para ordenes a credito.';
  end if;

  insert into public.credit_custom_reminders (
    created_by,
    client_id,
    remind_at,
    note,
    status
  )
  values (
    v_uid,
    p_client_id,
    p_remind_at,
    v_note,
    'scheduled'
  )
  returning id into v_reminder_id;

  insert into public.credit_custom_reminder_orders (
    reminder_id,
    order_id,
    accounts_receivable_id
  )
  select
    v_reminder_id,
    ar.order_id,
    ar.id
  from public.accounts_receivable ar
  join public.orders o on o.id = ar.order_id
  where ar.order_id = any(v_order_ids)
    and ar.client_id = p_client_id
    and ar.status in ('open', 'partial')
    and o.payment_status = 'credito'
    and o.client_id = p_client_id;

  return v_reminder_id;
end;
$$;

revoke all on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[]) from public;
revoke all on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[]) from anon;
grant execute on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[]) to authenticated;

revoke insert on public.credit_custom_reminders from authenticated;
revoke insert on public.credit_custom_reminder_orders from authenticated;
