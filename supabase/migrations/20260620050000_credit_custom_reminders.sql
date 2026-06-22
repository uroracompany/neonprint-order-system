-- Restore monthly credit pending alerts and add admin-created credit reminders.

delete from public.credit_pending_alert_acknowledgements
where period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$';

alter table public.credit_pending_alert_acknowledgements
  drop constraint if exists credit_pending_alert_ack_period_check;

alter table public.credit_pending_alert_acknowledgements
  add constraint credit_pending_alert_ack_period_check
  check (period_key ~ '^[0-9]{4}-[0-9]{2}$');

create table if not exists public.credit_custom_reminders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete restrict,
  remind_at timestamptz not null,
  note text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'due', 'acknowledged', 'cancelled')),
  last_shown_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_custom_reminder_orders (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references public.credit_custom_reminders(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  accounts_receivable_id uuid references public.accounts_receivable(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint credit_custom_reminder_orders_unique unique (reminder_id, order_id)
);

create index if not exists idx_credit_custom_reminders_owner_status_time
  on public.credit_custom_reminders (created_by, status, remind_at);

create index if not exists idx_credit_custom_reminders_client
  on public.credit_custom_reminders (client_id);

create index if not exists idx_credit_custom_reminder_orders_reminder
  on public.credit_custom_reminder_orders (reminder_id);

create index if not exists idx_credit_custom_reminder_orders_order
  on public.credit_custom_reminder_orders (order_id);

create or replace function public.set_credit_custom_reminders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_credit_custom_reminders_updated_at
  on public.credit_custom_reminders;

create trigger trg_credit_custom_reminders_updated_at
before update on public.credit_custom_reminders
for each row
execute function public.set_credit_custom_reminders_updated_at();

alter table public.credit_custom_reminders enable row level security;
alter table public.credit_custom_reminder_orders enable row level security;

drop policy if exists credit_custom_reminders_select_own
  on public.credit_custom_reminders;
create policy credit_custom_reminders_select_own
  on public.credit_custom_reminders
  for select
  to authenticated
  using ((select auth.uid()) = created_by);

drop policy if exists credit_custom_reminders_insert_own_admin
  on public.credit_custom_reminders;
create policy credit_custom_reminders_insert_own_admin
  on public.credit_custom_reminders
  for insert
  to authenticated
  with check (
    (select auth.uid()) = created_by
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role in ('admin', 'quote')
    )
  );

drop policy if exists credit_custom_reminders_update_own
  on public.credit_custom_reminders;
create policy credit_custom_reminders_update_own
  on public.credit_custom_reminders
  for update
  to authenticated
  using ((select auth.uid()) = created_by)
  with check ((select auth.uid()) = created_by);

drop policy if exists credit_custom_reminder_orders_select_own
  on public.credit_custom_reminder_orders;
create policy credit_custom_reminder_orders_select_own
  on public.credit_custom_reminder_orders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.credit_custom_reminders r
      where r.id = reminder_id
        and r.created_by = (select auth.uid())
    )
  );

drop policy if exists credit_custom_reminder_orders_insert_own
  on public.credit_custom_reminder_orders;
create policy credit_custom_reminder_orders_insert_own
  on public.credit_custom_reminder_orders
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.credit_custom_reminders r
      where r.id = reminder_id
        and r.created_by = (select auth.uid())
    )
  );

drop policy if exists credit_custom_reminder_orders_update_own
  on public.credit_custom_reminder_orders;
create policy credit_custom_reminder_orders_update_own
  on public.credit_custom_reminder_orders
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.credit_custom_reminders r
      where r.id = reminder_id
        and r.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.credit_custom_reminders r
      where r.id = reminder_id
        and r.created_by = (select auth.uid())
    )
  );

grant select, insert, update on public.credit_custom_reminders to authenticated;
grant select, insert, update on public.credit_custom_reminder_orders to authenticated;
