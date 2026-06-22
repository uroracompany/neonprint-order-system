-- Credit pending reminders are not overdue/mora tracking.
-- This migration removes the overdue read model and stores monthly alert acknowledgements.

drop function if exists public.get_overdue_credit_receivables(integer);
drop index if exists public.idx_accounts_receivable_open_due_at;

create table if not exists public.credit_pending_alert_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_key text not null,
  acknowledged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint credit_pending_alert_ack_period_check
    check (period_key ~ '^[0-9]{4}-[0-9]{2}$|^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}$'),
  constraint credit_pending_alert_ack_unique
    unique (user_id, period_key)
);

alter table public.credit_pending_alert_acknowledgements enable row level security;

create index if not exists idx_credit_pending_alert_ack_user_period
  on public.credit_pending_alert_acknowledgements (user_id, period_key);

drop policy if exists credit_pending_alert_ack_select_own
  on public.credit_pending_alert_acknowledgements;
create policy credit_pending_alert_ack_select_own
  on public.credit_pending_alert_acknowledgements
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists credit_pending_alert_ack_insert_own
  on public.credit_pending_alert_acknowledgements;
create policy credit_pending_alert_ack_insert_own
  on public.credit_pending_alert_acknowledgements
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

grant select, insert on public.credit_pending_alert_acknowledgements to authenticated;
