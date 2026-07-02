-- Administrative order operations v2.
-- Adds exception-management without weakening the existing workflow invariants.

alter table public.orders
  add column if not exists operational_status text not null default 'active',
  add column if not exists blocked_reason_category text,
  add column if not exists blocked_reason_detail text,
  add column if not exists blocked_owner_id uuid references public.profiles(id) on delete set null,
  add column if not exists blocked_by uuid references public.profiles(id) on delete set null,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_expected_resolution_at timestamptz,
  add column if not exists status_changed_at timestamptz,
  add column if not exists cancelled_from_status text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles(id) on delete set null,
  add column if not exists commercial_review_required boolean not null default false;

update public.orders
set status_changed_at = coalesce(status_changed_at, updated_at, created_at, now())
where status_changed_at is null;

alter table public.orders alter column status_changed_at set default now();
alter table public.orders alter column status_changed_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_operational_status_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_operational_status_check
      check (operational_status in ('active', 'blocked'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'orders_blocked_fields_check'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders add constraint orders_blocked_fields_check check (
      (operational_status = 'active') or
      (blocked_at is not null and blocked_by is not null and blocked_owner_id is not null
        and blocked_expected_resolution_at is not null
        and char_length(trim(coalesce(blocked_reason_detail, ''))) >= 10)
    );
  end if;
end $$;

create index if not exists idx_orders_active_blocked
  on public.orders(blocked_expected_resolution_at, blocked_at)
  where operational_status = 'blocked';
create index if not exists idx_orders_active_stage_age
  on public.orders(status, status_changed_at)
  where status not in ('cancelled', 'in_Delivered');
create index if not exists idx_orders_active_priority
  on public.orders(order_type, status_changed_at)
  where status not in ('cancelled', 'in_Delivered');
create index if not exists idx_orders_blocked_owner_id on public.orders(blocked_owner_id)
  where blocked_owner_id is not null;

create table if not exists public.order_requirement_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  revision_number integer not null,
  actor_id uuid not null references public.profiles(id),
  reason_category text not null,
  reason_detail text not null,
  impact_mode text not null default 'preserve_stage',
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(order_id, revision_number),
  check (impact_mode in ('preserve_stage', 'restart_flow'))
);

create index if not exists idx_order_requirement_revisions_order
  on public.order_requirement_revisions(order_id, revision_number desc);

create table if not exists public.admin_order_command_executions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  request_hash text not null,
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_admin_order_commands_order
  on public.admin_order_command_executions(order_id, created_at desc);

create table if not exists public.order_asset_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  requested_by uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(bucket, object_path),
  check (status in ('pending', 'processing', 'completed', 'failed'))
);

create index if not exists idx_order_asset_cleanup_pending
  on public.order_asset_cleanup_queue(requested_at)
  where status in ('pending', 'failed');

create table if not exists public.order_workflow_policies (
  status text not null,
  order_type text not null,
  warning_after_hours integer not null,
  critical_after_hours integer not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key(status, order_type),
  check (warning_after_hours > 0 and critical_after_hours > warning_after_hours)
);

insert into public.order_workflow_policies(status, order_type, warning_after_hours, critical_after_hours)
select s.status, p.order_type, p.warning_hours, p.critical_hours
from (values ('Pending'), ('in_Design'), ('in_Quote'), ('in_Production'), ('in_Termination'), ('in_Completed')) s(status)
cross join (values ('orden normal', 48, 96), ('orden 911', 4, 12)) p(order_type, warning_hours, critical_hours)
on conflict (status, order_type) do nothing;

alter table public.order_requirement_revisions enable row level security;
alter table public.admin_order_command_executions enable row level security;
alter table public.order_asset_cleanup_queue enable row level security;
alter table public.order_workflow_policies enable row level security;

drop policy if exists order_requirement_revisions_admin_select on public.order_requirement_revisions;
create policy order_requirement_revisions_admin_select on public.order_requirement_revisions
  for select to authenticated using ((select public.current_profile_is_admin()));
drop policy if exists admin_order_commands_admin_select on public.admin_order_command_executions;
create policy admin_order_commands_admin_select on public.admin_order_command_executions
  for select to authenticated using ((select public.current_profile_is_admin()));
drop policy if exists order_asset_cleanup_admin_select on public.order_asset_cleanup_queue;
create policy order_asset_cleanup_admin_select on public.order_asset_cleanup_queue
  for select to authenticated using ((select public.current_profile_is_admin()));
drop policy if exists order_workflow_policies_admin_select on public.order_workflow_policies;
create policy order_workflow_policies_admin_select on public.order_workflow_policies
  for select to authenticated using ((select public.current_profile_is_admin()));

revoke all on public.order_requirement_revisions, public.admin_order_command_executions,
  public.order_asset_cleanup_queue, public.order_workflow_policies from public, anon;
grant select on public.order_requirement_revisions, public.admin_order_command_executions,
  public.order_asset_cleanup_queue, public.order_workflow_policies to authenticated;

-- Preserve the previous implementation as a compatibility engine. The guard makes
-- manual SQL Editor deployments safe to reconcile later through migration tooling.
do $$
begin
  if to_regprocedure('public.admin_manage_order_legacy(uuid,text,text,text,timestamptz,uuid,jsonb)') is null
    and to_regprocedure('public.admin_manage_order(uuid,text,text,text,timestamptz,uuid,jsonb)') is not null then
    alter function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb)
      rename to admin_manage_order_legacy;
  end if;
end $$;

create or replace function public.admin_manage_order(
  p_order_id uuid,
  p_action text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_target_user_id uuid default null,
  p_area_assignments jsonb default '{}'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede intervenir una orden.'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.operational_status = 'blocked' then
    raise exception 'La orden esta bloqueada. Reanudala antes de cambiar su etapa o responsable.';
  end if;
  return public.admin_manage_order_legacy(
    p_order_id, p_action, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_target_user_id, p_area_assignments
  );
end;
$$;

revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
revoke all on function public.admin_manage_order_legacy(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon, authenticated;

create or replace function public.admin_preview_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders;
  v_target_type text := p_payload->>'design_type';
  v_impact text := coalesce(p_payload->>'impact_mode', 'preserve_stage');
  v_target_status text;
  v_warnings jsonb := '[]'::jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede consultar esta accion.'; end if;

  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  if p_action = 'reclassify_design' then
    if v_target_type not in ('INTERNAL_DESING', 'EXTERNAL_DESING') then
      raise exception 'Selecciona un tipo de diseno valido.';
    end if;
    if v_impact not in ('preserve_stage', 'restart_flow') then
      raise exception 'Selecciona un impacto valido.';
    end if;
    v_target_status := case when v_impact = 'restart_flow' and v_target_type = 'INTERNAL_DESING'
      then 'in_Design' when v_impact = 'restart_flow' then 'in_Quote' else v_order.status end;
    if v_impact = 'restart_flow' then
      v_warnings := v_warnings || jsonb_build_array(
        'Se limpiaran responsables posteriores.',
        'Los archivos de produccion volveran a Pendiente.',
        'El pago se conservara y Caja debera revisar el cambio.'
      );
    end if;
  elsif p_action = 'reopen_cancelled' then
    v_target_status := coalesce(v_order.cancelled_from_status, 'Pending');
    v_warnings := v_warnings || jsonb_build_array('Se reevaluaran los requisitos antes de restaurar la etapa.');
  else
    v_target_status := v_order.status;
  end if;

  return jsonb_build_object(
    'order_id', v_order.id,
    'action', p_action,
    'current_status', v_order.status,
    'target_status', v_target_status,
    'current_design_type', v_order.order_design_type,
    'target_design_type', coalesce(v_target_type, v_order.order_design_type),
    'warnings', v_warnings,
    'expected_updated_at', v_order.updated_at
  );
end;
$$;

create or replace function public.admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders;
  v_base jsonb;
  v_actions jsonb := '[]'::jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede consultar estas acciones.'; end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;

  v_base := public.get_admin_order_actions(p_order_id);
  if v_order.operational_status = 'blocked' then
    v_actions := jsonb_build_array(
      jsonb_build_object('key', 'resume_order', 'label', 'Reanudar orden'),
      jsonb_build_object('key', 'update_block', 'label', 'Actualizar bloqueo'),
      jsonb_build_object('key', 'set_priority', 'label', 'Cambiar prioridad'),
      jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno')
    );
  else
    v_actions := coalesce(v_base->'actions', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('key', 'block_order', 'label', 'Bloquear temporalmente'),
      jsonb_build_object('key', 'set_priority', 'label', 'Cambiar prioridad'),
      jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno'),
      jsonb_build_object('key', 'update_requirements', 'label', 'Registrar cambio de requisitos')
    );
    if v_order.commercial_review_required and v_order.status = 'in_Quote' then
      v_actions := v_actions || jsonb_build_array(
        jsonb_build_object('key', 'approve_commercial_review', 'label', 'Aprobar revision comercial')
      );
    end if;
    if v_order.status = 'cancelled' then
      v_actions := jsonb_build_array(
        jsonb_build_object('key', 'reopen_cancelled', 'label', 'Reabrir orden cancelada'),
        jsonb_build_object('key', 'reclassify_design', 'label', 'Reclasificar tipo de diseno')
      );
    elsif v_order.status <> 'in_Delivered' then
      v_actions := v_actions || jsonb_build_array(jsonb_build_object('key', 'cancel_order', 'label', 'Cancelar con motivo'));
    end if;
  end if;

  return v_base || jsonb_build_object(
    'actions', v_actions,
    'operational_status', v_order.operational_status,
    'blocked_reason_category', v_order.blocked_reason_category,
    'blocked_reason_detail', v_order.blocked_reason_detail,
    'blocked_owner_id', v_order.blocked_owner_id,
    'blocked_expected_resolution_at', v_order.blocked_expected_resolution_at,
    'commercial_review_required', v_order.commercial_review_required
  );
end;
$$;

create or replace function public.admin_execute_order_command(
  p_order_id uuid,
  p_action text,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.orders;
  v_new public.orders;
  v_existing jsonb;
  v_result jsonb;
  v_started timestamptz := clock_timestamp();
  v_target_type text;
  v_impact text;
  v_previous_status text;
  v_blockers jsonb;
  v_revision integer;
  v_request_hash text := md5(concat_ws('|', p_order_id::text, p_action, coalesce(p_payload, '{}'::jsonb)::text,
    p_reason_category, p_reason_detail));
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede intervenir una orden.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoria de motivo valida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select result into v_existing from public.admin_order_command_executions
  where idempotency_key = p_idempotency_key;
  if found then
    if v_existing is null then raise exception 'El comando ya esta en proceso.'; end if;
    return v_existing;
  end if;

  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'La orden cambio mientras la editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  insert into public.admin_order_command_executions(idempotency_key, order_id, actor_id, action, request_hash)
  values (p_idempotency_key, p_order_id, v_actor, p_action, v_request_hash);

  if p_action = 'block_order' then
    if v_old.status in ('cancelled', 'in_Delivered') then raise exception 'No se puede bloquear una orden terminal.'; end if;
    if nullif(p_payload->>'owner_id', '') is null or nullif(p_payload->>'expected_resolution_at', '') is null then
      raise exception 'Selecciona responsable y fecha estimada para el bloqueo.';
    end if;
    update public.orders set
      operational_status = 'blocked', blocked_reason_category = p_reason_category,
      blocked_reason_detail = trim(p_reason_detail),
      blocked_owner_id = coalesce((p_payload->>'owner_id')::uuid, v_actor),
      blocked_by = v_actor, blocked_at = now(),
      blocked_expected_resolution_at = (p_payload->>'expected_resolution_at')::timestamptz,
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'update_block' then
    if v_old.operational_status <> 'blocked' then raise exception 'La orden no esta bloqueada.'; end if;
    update public.orders set
      blocked_reason_category = p_reason_category, blocked_reason_detail = trim(p_reason_detail),
      blocked_owner_id = coalesce((p_payload->>'owner_id')::uuid, blocked_owner_id),
      blocked_expected_resolution_at = coalesce((p_payload->>'expected_resolution_at')::timestamptz, blocked_expected_resolution_at),
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'resume_order' then
    if v_old.operational_status <> 'blocked' then raise exception 'La orden no esta bloqueada.'; end if;
    update public.orders set
      operational_status = 'active', blocked_reason_category = null, blocked_reason_detail = null,
      blocked_owner_id = null, blocked_by = null, blocked_at = null,
      blocked_expected_resolution_at = null,
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'set_priority' then
    if p_payload->>'order_type' not in ('orden normal', 'orden 911') then raise exception 'Selecciona una prioridad valida.'; end if;
    update public.orders set order_type = p_payload->>'order_type',
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action in ('reclassify_design', 'update_requirements') then
    v_target_type := coalesce(p_payload->>'design_type', v_old.order_design_type);
    v_impact := coalesce(p_payload->>'impact_mode', 'preserve_stage');
    if v_target_type not in ('INTERNAL_DESING', 'EXTERNAL_DESING') then raise exception 'Selecciona un tipo de diseno valido.'; end if;
    if v_impact not in ('preserve_stage', 'restart_flow') then raise exception 'Selecciona un impacto valido.'; end if;
    select coalesce(max(revision_number), 0) + 1 into v_revision
    from public.order_requirement_revisions where order_id = p_order_id;
    insert into public.order_requirement_revisions(
      order_id, revision_number, actor_id, reason_category, reason_detail,
      impact_mode, previous_values, new_values
    ) values (
      p_order_id, v_revision, v_actor, p_reason_category, trim(p_reason_detail), v_impact,
      jsonb_build_object('description', v_old.description, 'material', v_old.material,
        'termination_type', v_old.termination_type, 'delivery_date', v_old.delivery_date,
        'order_design_type', v_old.order_design_type),
      coalesce(p_payload->'changes', '{}'::jsonb) || jsonb_build_object('order_design_type', v_target_type)
    );
    update public.orders set
      client_id = coalesce((p_payload#>>'{changes,client_id}')::uuid, client_id),
      client_name = coalesce(p_payload#>>'{changes,client_name}', client_name),
      client_contact = coalesce(p_payload#>>'{changes,client_contact}', client_contact),
      invoice_number = coalesce(p_payload#>>'{changes,invoice_number}', invoice_number),
      description = coalesce(p_payload#>>'{changes,description}', description),
      material = coalesce(p_payload#>>'{changes,material}', material),
      termination_type = coalesce(p_payload#>>'{changes,termination_type}', termination_type),
      delivery_date = coalesce((p_payload#>>'{changes,delivery_date}')::date, delivery_date),
      order_file_url = coalesce(p_payload#>>'{changes,order_file_url}', order_file_url),
      preview_image = case when (p_payload->'changes') ? 'preview_image'
        then nullif(p_payload#>>'{changes,preview_image}', '') else preview_image end,
      reference_images = case when (p_payload->'changes') ? 'reference_images'
        then p_payload#>'{changes,reference_images}' else reference_images end,
      order_design_type = v_target_type,
      status = case when v_impact = 'restart_flow' and v_target_type = 'INTERNAL_DESING' then 'in_Design'
        when v_impact = 'restart_flow' then 'in_Quote' else status end,
      designer_id = case when v_target_type = 'EXTERNAL_DESING' then null else designer_id end,
      quote_id = case when v_impact = 'restart_flow' and v_target_type = 'INTERNAL_DESING' then null else quote_id end,
      production_id = case when v_impact = 'restart_flow' then null else production_id end,
      delivery_id = case when v_impact = 'restart_flow' then null else delivery_id end,
      operational_status = case when status = 'cancelled' and v_impact = 'restart_flow' then 'active' else operational_status end,
      commercial_review_required = case when v_impact = 'restart_flow' then true else commercial_review_required end,
      cancellation_reason = case when status = 'cancelled' and v_impact = 'restart_flow' then null else cancellation_reason end,
      status_changed_at = case when v_impact = 'restart_flow' then now() else status_changed_at end,
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
    if v_impact = 'restart_flow' then
      update public.order_production_files set status = 'pending', assigned_to = null, updated_at = now()
      where order_id = p_order_id;
    end if;
  elsif p_action = 'register_payment' then
    if p_payload->>'payment_status' not in ('Pending_Payment', 'parcial', 'pagado') then
      raise exception 'Selecciona un estado de pago valido.';
    end if;
    if p_payload->>'payment_status' = 'Pending_Payment'
      and v_old.status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered') then
      raise exception 'La orden no puede volver a pago Pendiente en su etapa actual.';
    end if;
    update public.orders set
      payment_status = p_payload->>'payment_status',
      invoice_payment = case when p_payload->>'payment_status' = 'parcial' then null
        else nullif(p_payload->>'invoice_payment', '') end,
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'approve_commercial_review' then
    if v_old.status <> 'in_Quote' then raise exception 'La revision comercial debe aprobarse en Caja.'; end if;
    if not v_old.commercial_review_required then raise exception 'La orden no tiene una revision comercial pendiente.'; end if;
    update public.orders set commercial_review_required = false,
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'cancel_order' then
    if v_old.status in ('cancelled', 'in_Delivered') then raise exception 'La orden no puede cancelarse en su estado actual.'; end if;
    if v_old.payment_status = 'parcial' then raise exception 'No se puede cancelar una orden con pago parcial.'; end if;
    update public.orders set status = 'cancelled', cancelled_from_status = v_old.status,
      cancellation_reason = trim(p_reason_detail), cancelled_at = now(), cancelled_by = v_actor,
      operational_status = 'active', blocked_reason_category = null, blocked_reason_detail = null,
      blocked_owner_id = null, blocked_by = null, blocked_at = null, blocked_expected_resolution_at = null,
      status_changed_at = now(), last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  elsif p_action = 'reopen_cancelled' then
    if v_old.status <> 'cancelled' then raise exception 'La orden no esta cancelada.'; end if;
    v_previous_status := coalesce(v_old.cancelled_from_status, 'Pending');
    if v_previous_status in ('in_Production', 'in_Termination', 'in_Completed', 'in_Delivered') then
      v_blockers := public._admin_validate_order_completeness(p_order_id, 'route_production');
      if jsonb_array_length(v_blockers) > 0 then v_previous_status := 'in_Quote'; end if;
    end if;
    update public.orders set status = v_previous_status, cancellation_reason = null,
      cancelled_at = null, cancelled_by = null, status_changed_at = now(),
      last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
      last_admin_intervention_kind = p_action, updated_at = now()
    where id = p_order_id returning * into v_new;
  else
    if v_old.operational_status = 'blocked' then raise exception 'La orden esta bloqueada. Reanudala antes de continuar.'; end if;
    if p_action = 'route_production' and v_old.commercial_review_required then
      raise exception 'Caja debe aprobar la revision comercial antes de enviar a Produccion.';
    end if;
    v_new := public.admin_manage_order_legacy(
      p_order_id, p_action, p_reason_category, trim(p_reason_detail),
      p_expected_updated_at, (p_payload->>'target_user_id')::uuid,
      coalesce(p_payload->'area_assignments', '{}'::jsonb)
    );
  end if;

  if p_action in ('block_order', 'update_block', 'resume_order', 'set_priority', 'reclassify_design',
    'update_requirements', 'register_payment', 'approve_commercial_review', 'cancel_order', 'reopen_cancelled') then
    perform public.record_admin_intervention(v_old, v_new, p_action, p_reason_category, trim(p_reason_detail), v_started, null);
  end if;

  v_result := jsonb_build_object('order', to_jsonb(v_new), 'action', p_action, 'success', true);
  update public.admin_order_command_executions set result = v_result, completed_at = now()
  where idempotency_key = p_idempotency_key;
  return v_result;
end;
$$;

create or replace function public.admin_execute_order_batch(
  p_order_ids uuid[],
  p_action text,
  p_payload jsonb,
  p_reason_category text,
  p_reason_detail text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_order public.orders;
  v_results jsonb := '[]'::jsonb;
  v_result jsonb;
  v_index integer := 0;
begin
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecciona al menos una orden.'; end if;
  if array_length(p_order_ids, 1) > 100 then raise exception 'El lote no puede superar 100 ordenes.'; end if;
  foreach v_order_id in array p_order_ids loop
    v_index := v_index + 1;
    begin
      select * into v_order from public.orders where id = v_order_id;
      v_result := public.admin_execute_order_command(
        v_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
        v_order.updated_at, p_idempotency_key || ':' || v_index::text || ':' || v_order_id::text
      );
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id, 'success', true, 'result', v_result
      ));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'order_id', v_order_id, 'success', false, 'error', sqlerrm
      ));
    end;
  end loop;
  return jsonb_build_object(
    'action', p_action, 'total', array_length(p_order_ids, 1),
    'results', v_results
  );
end;
$$;

revoke all on function public.admin_preview_order_command(uuid, text, jsonb) from public, anon;
revoke all on function public.admin_get_order_command_catalog(uuid) from public, anon;
revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
revoke all on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) from public, anon;
grant execute on function public.admin_preview_order_command(uuid, text, jsonb) to authenticated;
grant execute on function public.admin_get_order_command_catalog(uuid) to authenticated;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
grant execute on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) to authenticated;

create or replace function public.set_order_status_changed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_status_changed_at on public.orders;
create trigger trg_orders_status_changed_at
before update of status on public.orders
for each row execute function public.set_order_status_changed_at();

revoke all on function public.set_order_status_changed_at() from public, anon, authenticated;

create or replace function public.admin_add_production_file(
  p_order_id uuid,
  p_url text,
  p_filename text,
  p_public_label text,
  p_area_code text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_old public.orders;
  v_new public.orders;
  v_file public.order_production_files;
  v_started timestamptz := clock_timestamp();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede agregar archivos.'; end if;
  if nullif(trim(p_url), '') is null or nullif(trim(p_public_label), '') is null then
    raise exception 'El archivo y su etiqueta son obligatorios.';
  end if;
  if not exists (select 1 from public.production_areas where code = p_area_code and is_active) then
    raise exception 'Selecciona un area de produccion activa.';
  end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'La orden cambio mientras agregabas el archivo.'; end if;
  if v_old.status in ('cancelled', 'in_Delivered') then raise exception 'No se pueden agregar archivos en una orden terminal.'; end if;

  insert into public.order_production_files(
    order_id, url, filename, public_label, production_area_code, status, created_by, updated_by
  ) values (
    p_order_id, trim(p_url), coalesce(nullif(trim(p_filename), ''), 'Archivo'),
    trim(p_public_label), p_area_code, 'pending', v_actor, v_actor
  ) returning * into v_file;

  update public.orders set
    order_file_url = (coalesce(nullif(order_file_url, ''), '[]')::jsonb || jsonb_build_array(trim(p_url)))::text,
    last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'production_file_added', updated_at = now()
  where id = p_order_id returning * into v_new;
  perform public.record_admin_intervention(
    v_old, v_new, 'production_file_added', 'workflow_correction',
    'Archivo agregado por Administracion desde Configuracion avanzada.', v_started,
    jsonb_build_array(jsonb_build_object('field', 'production_file', 'label', trim(p_public_label),
      'old_value', null, 'new_value', trim(p_filename)))
  );
  return jsonb_build_object('file', to_jsonb(v_file), 'order_updated_at', v_new.updated_at);
end;
$$;

create or replace function public.admin_remove_production_file(
  p_file_id uuid,
  p_reason_detail text,
  p_expected_updated_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_file public.order_production_files;
  v_old public.orders;
  v_new public.orders;
  v_urls jsonb;
  v_count integer;
  v_started timestamptz := clock_timestamp();
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.role = 'admin'
      and coalesce(p.employment_status, true)
  ) then raise exception 'Solo un administrador activo puede retirar archivos.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'Explica el motivo con al menos 10 caracteres.';
  end if;
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  if v_file.updated_at is distinct from p_expected_updated_at then raise exception 'El archivo cambio mientras lo editabas.'; end if;
  select * into v_old from public.orders where id = v_file.order_id for update;
  if v_old.status in ('cancelled', 'in_Delivered') then raise exception 'No se pueden retirar archivos en una orden terminal.'; end if;
  select count(*) into v_count from public.order_production_files where order_id = v_file.order_id;
  if v_count <= 1 and v_old.status not in ('Pending', 'in_Design') then
    raise exception 'No se puede retirar el ultimo archivo desde Caja en adelante.';
  end if;

  insert into public.order_asset_cleanup_queue(order_id, bucket, object_path, requested_by)
  values (v_file.order_id, 'order-docs', v_file.url, v_actor)
  on conflict (bucket, object_path) do update set status = 'pending', requested_by = excluded.requested_by,
    requested_at = now(), processed_at = null;
  delete from public.order_production_files where id = p_file_id;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_urls
  from jsonb_array_elements_text(coalesce(nullif(v_old.order_file_url, ''), '[]')::jsonb) item
  where item <> v_file.url;
  update public.orders set order_file_url = v_urls::text,
    last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'production_file_removed', updated_at = now()
  where id = v_file.order_id returning * into v_new;
  perform public.record_admin_intervention(
    v_old, v_new, 'production_file_removed', 'workflow_correction', trim(p_reason_detail), v_started,
    jsonb_build_array(jsonb_build_object('field', 'production_file', 'label', v_file.public_label,
      'old_value', v_file.filename, 'new_value', null))
  );
  return p_file_id;
end;
$$;

revoke all on function public.admin_add_production_file(uuid, text, text, text, text, timestamptz) from public, anon;
revoke all on function public.admin_remove_production_file(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_add_production_file(uuid, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.admin_remove_production_file(uuid, text, timestamptz) to authenticated;
