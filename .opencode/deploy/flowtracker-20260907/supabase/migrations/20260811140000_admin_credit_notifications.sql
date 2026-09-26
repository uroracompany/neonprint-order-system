-- Make credit notifications reliable without requiring an open browser and
-- create one actionable daily summary per active administrator.

create table if not exists public.admin_credit_daily_notification_runs (
  summary_date date not null,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (summary_date, admin_user_id)
);

alter table public.admin_credit_daily_notification_runs enable row level security;

create index if not exists idx_accounts_receivable_credit_summary
  on public.accounts_receivable (due_date, client_id)
  where status in ('open', 'partial');

create or replace function public.dispatch_daily_admin_credit_summary(
  p_force boolean default false
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local_now timestamp := timezone('America/Asuncion', now());
  v_summary_date date;
  v_day_start timestamptz;
  v_pending_count integer := 0;
  v_client_count integer := 0;
  v_overdue_count integer := 0;
  v_due_today_count integer := 0;
  v_due_soon_count integer := 0;
  v_without_due_date_count integer := 0;
  v_admin record;
  v_inserted_user_id uuid;
  v_sent_count integer := 0;
begin
  -- The cron job runs hourly so this timezone check remains correct if the
  -- local UTC offset changes. p_force is reserved for controlled maintenance.
  if not p_force and extract(hour from v_local_now) <> 8 then
    return 0;
  end if;

  v_summary_date := v_local_now::date;
  v_day_start := v_summary_date::timestamp at time zone 'America/Asuncion';

  select
    count(*)::integer,
    count(distinct ar.client_id)::integer,
    count(*) filter (where ar.due_date is not null and ar.due_date < v_day_start)::integer,
    count(*) filter (
      where ar.due_date >= v_day_start
        and ar.due_date < v_day_start + interval '1 day'
    )::integer,
    count(*) filter (
      where ar.due_date >= v_day_start + interval '1 day'
        and ar.due_date < v_day_start + interval '8 days'
    )::integer,
    count(*) filter (where ar.due_date is null)::integer
  into
    v_pending_count,
    v_client_count,
    v_overdue_count,
    v_due_today_count,
    v_due_soon_count,
    v_without_due_date_count
  from public.accounts_receivable ar
  where ar.status in ('open', 'partial');

  if coalesce(v_pending_count, 0) = 0 then
    return 0;
  end if;

  for v_admin in
    select p.id
    from public.profiles p
    where p.role = 'admin'
      and p.employment_status is distinct from false
      and p.deleted_at is null
  loop
    insert into public.admin_credit_daily_notification_runs (summary_date, admin_user_id)
    values (v_summary_date, v_admin.id)
    on conflict do nothing
    returning admin_user_id into v_inserted_user_id;

    if v_inserted_user_id is not null then
      perform public.notify_many(
        array[v_admin.id],
        'info',
        'Resumen diario de créditos',
        format(
          '%s factura(s) pendiente(s) de %s cliente(s): %s vencida(s), %s vence(n) hoy y %s próxima(s) a vencer.',
          v_pending_count,
          v_client_count,
          v_overdue_count,
          v_due_today_count,
          v_due_soon_count
        ),
        null,
        jsonb_build_object(
          'event_kind', 'admin_credit_daily_summary',
          'summary_date', v_summary_date,
          'pending_count', v_pending_count,
          'client_count', v_client_count,
          'overdue_count', v_overdue_count,
          'due_today_count', v_due_today_count,
          'due_soon_count', v_due_soon_count,
          'without_due_date_count', v_without_due_date_count,
          'navigation_target', 'credits'
        )
      );
      v_sent_count := v_sent_count + 1;
    end if;

    v_inserted_user_id := null;
  end loop;

  return v_sent_count;
end;
$$;

revoke all on function public.dispatch_daily_admin_credit_summary(boolean) from public;
revoke all on function public.dispatch_daily_admin_credit_summary(boolean) from anon;
revoke all on function public.dispatch_daily_admin_credit_summary(boolean) from authenticated;

create or replace function public.dispatch_due_credit_reminder_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reminder record;
  v_recipients uuid[];
  v_count integer := 0;
begin
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
        'Recordatorio de crédito',
        'Tienes un recordatorio de crédito pendiente.',
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

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-due-credit-reminders') then
    perform cron.unschedule('dispatch-due-credit-reminders');
  end if;

  if exists (select 1 from cron.job where jobname = 'dispatch-daily-admin-credit-summary') then
    perform cron.unschedule('dispatch-daily-admin-credit-summary');
  end if;
end;
$$;

select cron.schedule(
  'dispatch-due-credit-reminders',
  '*/15 * * * *',
  $$select public.dispatch_due_credit_reminder_notifications();$$
);

select cron.schedule(
  'dispatch-daily-admin-credit-summary',
  '5 * * * *',
  $$select public.dispatch_daily_admin_credit_summary();$$
);
