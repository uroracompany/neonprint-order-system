-- Persist only administrative review state for calculated KPI alerts.

create table if not exists public.kpi_alert_states (
  alert_key text primary key,
  status text not null default 'nueva',
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  dismissed_at timestamptz,
  resolved_at timestamptz,
  constraint kpi_alert_states_status_check
    check (status in ('nueva', 'revisada', 'descartada', 'resuelta'))
);

create index if not exists kpi_alert_states_status_idx
  on public.kpi_alert_states(status);

create index if not exists kpi_alert_states_updated_at_idx
  on public.kpi_alert_states(updated_at desc);

alter table public.kpi_alert_states enable row level security;

drop policy if exists kpi_alert_states_admin_select on public.kpi_alert_states;
drop policy if exists kpi_alert_states_admin_insert on public.kpi_alert_states;
drop policy if exists kpi_alert_states_admin_update on public.kpi_alert_states;

create policy kpi_alert_states_admin_select
  on public.kpi_alert_states
  for select
  to authenticated
  using (public.current_profile_is_admin());

create policy kpi_alert_states_admin_insert
  on public.kpi_alert_states
  for insert
  to authenticated
  with check (public.current_profile_is_admin());

create policy kpi_alert_states_admin_update
  on public.kpi_alert_states
  for update
  to authenticated
  using (public.current_profile_is_admin())
  with check (public.current_profile_is_admin());

grant select, insert, update on public.kpi_alert_states to authenticated;
