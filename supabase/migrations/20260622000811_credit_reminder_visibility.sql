-- Add role-aware visibility for custom credit reminders.

alter table public.credit_custom_reminders
  add column if not exists visibility_scope text not null default 'creator',
  add column if not exists notified_at timestamptz,
  add column if not exists acknowledged_by uuid references auth.users(id) on delete set null;

alter table public.credit_custom_reminders
  drop constraint if exists credit_custom_reminders_visibility_scope_check;

alter table public.credit_custom_reminders
  add constraint credit_custom_reminders_visibility_scope_check
  check (visibility_scope in ('creator', 'admin_quote', 'quote'));

create index if not exists idx_credit_custom_reminders_visibility_due
  on public.credit_custom_reminders (visibility_scope, status, remind_at);

create index if not exists idx_credit_custom_reminder_orders_order
  on public.credit_custom_reminder_orders (order_id);

create or replace function public.get_credit_reminder_quote_user_ids(p_reminder_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct o.quote_id), array[]::uuid[])
  from public.credit_custom_reminder_orders cro
  join public.orders o on o.id = cro.order_id
  join public.profiles p on p.id = o.quote_id
  where cro.reminder_id = p_reminder_id
    and o.quote_id is not null
    and p.role = 'quote'
    and coalesce(p.employment_status, true) = true;
$$;

revoke all on function public.get_credit_reminder_quote_user_ids(uuid) from public;
revoke all on function public.get_credit_reminder_quote_user_ids(uuid) from anon;
grant execute on function public.get_credit_reminder_quote_user_ids(uuid) to authenticated;

create or replace function public.can_access_credit_custom_reminder(
  p_reminder_id uuid,
  p_user_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_role text;
  v_created_by uuid;
  v_visibility_scope text;
begin
  if v_uid is null or p_reminder_id is null then
    return false;
  end if;

  select p.role
  into v_role
  from public.profiles p
  where p.id = v_uid
    and coalesce(p.employment_status, true) = true;

  if v_role is null then
    return false;
  end if;

  select r.created_by, r.visibility_scope
  into v_created_by, v_visibility_scope
  from public.credit_custom_reminders r
  where r.id = p_reminder_id;

  if v_created_by is null then
    return false;
  end if;

  if coalesce(v_visibility_scope, 'creator') = 'creator' then
    return v_uid = v_created_by;
  end if;

  if v_visibility_scope = 'admin_quote' then
    return v_uid = v_created_by
      or v_uid = any(public.get_credit_reminder_quote_user_ids(p_reminder_id));
  end if;

  if v_visibility_scope = 'quote' then
    return v_role = 'quote'
      and v_uid = any(public.get_credit_reminder_quote_user_ids(p_reminder_id));
  end if;

  return false;
end;
$$;

revoke all on function public.can_access_credit_custom_reminder(uuid, uuid) from public;
revoke all on function public.can_access_credit_custom_reminder(uuid, uuid) from anon;
grant execute on function public.can_access_credit_custom_reminder(uuid, uuid) to authenticated;

create or replace function public.get_credit_reminder_notification_recipients(p_reminder_id uuid)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_created_by uuid;
  v_visibility_scope text;
  v_base uuid[];
  v_recipients uuid[];
begin
  select r.created_by, coalesce(r.visibility_scope, 'creator')
  into v_created_by, v_visibility_scope
  from public.credit_custom_reminders r
  where r.id = p_reminder_id;

  if v_created_by is null then
    return array[]::uuid[];
  end if;

  if v_visibility_scope = 'creator' then
    v_base := array[v_created_by];
  elsif v_visibility_scope = 'admin_quote' then
    v_base := array[v_created_by] || public.get_credit_reminder_quote_user_ids(p_reminder_id);
  elsif v_visibility_scope = 'quote' then
    v_base := public.get_credit_reminder_quote_user_ids(p_reminder_id);
  else
    v_base := array[]::uuid[];
  end if;

  select coalesce(array_agg(distinct recipient), array[]::uuid[])
  into v_recipients
  from unnest(coalesce(v_base, array[]::uuid[])) as recipients(recipient)
  where recipient is not null;

  return v_recipients;
end;
$$;

revoke all on function public.get_credit_reminder_notification_recipients(uuid) from public;
revoke all on function public.get_credit_reminder_notification_recipients(uuid) from anon;
grant execute on function public.get_credit_reminder_notification_recipients(uuid) to authenticated;

drop function if exists public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[]);

create or replace function public.create_credit_custom_reminder(
  p_client_id uuid,
  p_remind_at timestamptz,
  p_note text,
  p_order_ids uuid[],
  p_visibility_scope text default 'creator'
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
  v_visibility_scope text := coalesce(nullif(btrim(coalesce(p_visibility_scope, '')), ''), 'creator');
  v_order_ids uuid[];
  v_expected_count integer;
  v_valid_count integer;
  v_quote_recipient_count integer;
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

  if v_visibility_scope not in ('creator', 'admin_quote', 'quote') then
    raise exception 'Selecciona una visibilidad valida para el recordatorio.';
  end if;

  if v_role <> 'admin' and v_visibility_scope <> 'creator' then
    raise exception 'Solo administracion puede compartir recordatorios con Caja.';
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

  if v_visibility_scope in ('admin_quote', 'quote') then
    select count(distinct o.quote_id)
    into v_quote_recipient_count
    from public.accounts_receivable ar
    join public.orders o on o.id = ar.order_id
    join public.profiles p on p.id = o.quote_id
    where ar.order_id = any(v_order_ids)
      and ar.client_id = p_client_id
      and ar.status in ('open', 'partial')
      and o.payment_status = 'credito'
      and o.client_id = p_client_id
      and o.quote_id is not null
      and p.role = 'quote'
      and coalesce(p.employment_status, true) = true;

    if coalesce(v_quote_recipient_count, 0) = 0 then
      raise exception 'Selecciona al menos una orden asignada a Caja para compartir el recordatorio.';
    end if;
  end if;

  insert into public.credit_custom_reminders (
    created_by,
    client_id,
    remind_at,
    note,
    status,
    visibility_scope
  )
  values (
    v_uid,
    p_client_id,
    p_remind_at,
    v_note,
    'scheduled',
    v_visibility_scope
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

revoke all on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[], text) from public;
revoke all on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[], text) from anon;
grant execute on function public.create_credit_custom_reminder(uuid, timestamptz, text, uuid[], text) to authenticated;

create or replace function public.dispatch_due_credit_reminder_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reminder record;
  v_recipients uuid[];
  v_count integer := 0;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  for v_reminder in
    select r.id, r.client_id, r.visibility_scope, r.note, r.remind_at
    from public.credit_custom_reminders r
    where r.status in ('scheduled', 'due')
      and r.remind_at <= now()
      and r.notified_at is null
    order by r.remind_at asc
    limit 50
  loop
    v_recipients := public.get_credit_reminder_notification_recipients(v_reminder.id);

    if coalesce(cardinality(v_recipients), 0) > 0 then
      perform public.notify_many(
        v_recipients,
        'info',
        'Recordatorio de credito',
        'Tienes un recordatorio de credito pendiente.',
        null,
        jsonb_build_object(
          'event_kind', 'credit_custom_reminder_due',
          'reminder_id', v_reminder.id,
          'client_id', v_reminder.client_id,
          'visibility_scope', v_reminder.visibility_scope,
          'remind_at', v_reminder.remind_at
        )
      );

      update public.credit_custom_reminders
      set status = 'due',
          notified_at = now(),
          updated_at = now()
      where id = v_reminder.id
        and status in ('scheduled', 'due');

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.dispatch_due_credit_reminder_notifications() from public;
revoke all on function public.dispatch_due_credit_reminder_notifications() from anon;
grant execute on function public.dispatch_due_credit_reminder_notifications() to authenticated;

create or replace function public.touch_credit_custom_reminders(p_reminder_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  with input_ids as (
    select distinct reminder_id
    from unnest(coalesce(p_reminder_ids, array[]::uuid[])) as input(reminder_id)
    where reminder_id is not null
  ),
  updated as (
    update public.credit_custom_reminders r
    set last_shown_at = now(),
        updated_at = now()
    from input_ids i
    where r.id = i.reminder_id
      and public.can_access_credit_custom_reminder(r.id, v_uid)
    returning r.id
  )
  select count(*) into v_count from updated;

  return coalesce(v_count, 0);
end;
$$;

revoke all on function public.touch_credit_custom_reminders(uuid[]) from public;
revoke all on function public.touch_credit_custom_reminders(uuid[]) from anon;
grant execute on function public.touch_credit_custom_reminders(uuid[]) to authenticated;

create or replace function public.acknowledge_credit_custom_reminder(p_reminder_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_updated_id uuid;
begin
  if v_uid is null then
    raise exception 'No tienes una sesion activa.';
  end if;

  if p_reminder_id is null then
    raise exception 'Selecciona un recordatorio valido.';
  end if;

  update public.credit_custom_reminders r
  set status = 'acknowledged',
      acknowledged_at = now(),
      acknowledged_by = v_uid,
      last_shown_at = now(),
      updated_at = now()
  where r.id = p_reminder_id
    and r.status in ('scheduled', 'due')
    and public.can_access_credit_custom_reminder(r.id, v_uid)
  returning r.id into v_updated_id;

  if v_updated_id is null then
    raise exception 'No tienes permiso para marcar este recordatorio.';
  end if;

  return true;
end;
$$;

revoke all on function public.acknowledge_credit_custom_reminder(uuid) from public;
revoke all on function public.acknowledge_credit_custom_reminder(uuid) from anon;
grant execute on function public.acknowledge_credit_custom_reminder(uuid) to authenticated;

drop policy if exists credit_custom_reminders_select_own
  on public.credit_custom_reminders;
drop policy if exists credit_custom_reminders_update_own
  on public.credit_custom_reminders;
drop policy if exists credit_custom_reminders_select_visible
  on public.credit_custom_reminders;

create policy credit_custom_reminders_select_visible
  on public.credit_custom_reminders
  for select
  using (public.can_access_credit_custom_reminder(id));

drop policy if exists credit_custom_reminder_orders_select_own
  on public.credit_custom_reminder_orders;
drop policy if exists credit_custom_reminder_orders_update_own
  on public.credit_custom_reminder_orders;
drop policy if exists credit_custom_reminder_orders_select_visible
  on public.credit_custom_reminder_orders;

create policy credit_custom_reminder_orders_select_visible
  on public.credit_custom_reminder_orders
  for select
  using (public.can_access_credit_custom_reminder(reminder_id));

grant select on public.credit_custom_reminders to authenticated;
grant select on public.credit_custom_reminder_orders to authenticated;
revoke insert, update on public.credit_custom_reminders from authenticated;
revoke insert, update on public.credit_custom_reminder_orders from authenticated;
