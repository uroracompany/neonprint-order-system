-- Direct operational notices for administrative interventions.  Audit remains
-- one order event; delivery is individualized so recipient-specific messages
-- cannot leak to unrelated historical participants.

create or replace function public.admin_intervention_direct_recipients(
  p_old public.orders,
  p_new public.orders,
  p_action text,
  p_actor_id uuid
)
returns table(user_id uuid, template_key text, priority text, requires_ack boolean, role_context text)
language sql stable security definer set search_path = '' as $$
  with active_context as (
    -- A cancellation interrupts the stage that existed immediately before the
    -- command; every other intervention concerns the resulting active stage.
    select case when p_action = 'cancel_order' then p_old.status else p_new.status end as status
  ), candidates(user_id, template_key, priority, requires_ack, role_context) as (
    -- Explicit assignment and reassignment notices: never use created_by as a
    -- seller fallback because it is not an operational responsibility.
    select p_new.seller_id, 'assignment_received', 'action_required', true, 'seller'
      where p_action in ('assign_seller', 'route_sales') and (
        p_new.seller_id is distinct from p_old.seller_id
        or (p_new.status = 'Pending' and p_new.status is distinct from p_old.status)
      )
    union all select p_old.seller_id, 'assignment_removed', 'important', false, 'seller'
      where p_action = 'assign_seller' and p_old.seller_id is not null and p_new.seller_id is distinct from p_old.seller_id
    union all select p_new.designer_id, 'assignment_received', 'action_required', true, 'designer'
      where p_action in ('route_design', 'set_designer_assignee', 'return_to_design') and (
        p_new.designer_id is distinct from p_old.designer_id
        or (p_new.status = 'in_Design' and p_new.status is distinct from p_old.status)
      )
    union all select p_old.designer_id, 'assignment_removed', 'important', false, 'designer'
      where p_action in ('set_designer_assignee', 'route_sales', 'route_quote') and p_old.designer_id is not null and p_new.designer_id is distinct from p_old.designer_id
    union all select p_new.quote_id, 'assignment_received', 'action_required', true, 'quote'
      where p_action in ('route_quote', 'set_quote_assignee', 'return_to_quote') and (
        p_new.quote_id is distinct from p_old.quote_id
        or (p_new.status = 'in_Quote' and p_new.status is distinct from p_old.status)
      )
    union all select p_old.quote_id, 'assignment_removed', 'important', false, 'quote'
      where p_action in ('set_quote_assignee', 'route_sales', 'return_to_design', 'route_production') and p_old.quote_id is not null and p_new.quote_id is distinct from p_old.quote_id
    union all select p_new.delivery_id, 'assignment_received', 'action_required', true, 'delivery'
      where p_action in ('route_completed', 'return_to_completed') and (
        p_new.delivery_id is distinct from p_old.delivery_id
        or (p_new.status = 'in_Completed' and p_new.status is distinct from p_old.status)
      )
    union all select p_old.delivery_id, 'assignment_removed', 'important', false, 'delivery'
      where p_action in ('return_to_quote', 'return_to_completed') and p_old.delivery_id is not null and p_new.delivery_id is distinct from p_old.delivery_id

    -- Asset edits go only to the person owning the stage where those assets are
    -- actionable, not to all historical order participants.
    union all select p_new.designer_id, 'workflow_changed', 'important', false, 'designer'
      where p_action = 'design_assets_updated' and p_new.status = 'in_Design' and p_new.designer_id is not null
    union all select p_new.seller_id, 'workflow_changed', 'important', false, 'seller'
      where p_action = 'design_assets_updated' and p_new.status = 'Pending' and p_new.seller_id is not null

    -- A stage transfer also removes work from the owner of the previous stage,
    -- even when the historical assignment column remains stored on the order.
    union all select p_old.seller_id, 'assignment_removed', 'important', false, 'seller'
      where p_action in ('route_design', 'route_quote', 'route_production', 'route_completed', 'return_to_design', 'return_to_quote', 'return_to_completed', 'reclassify_design')
        and p_old.status = 'Pending' and p_new.status is distinct from p_old.status and p_old.seller_id is not null
    union all select p_old.designer_id, 'assignment_removed', 'important', false, 'designer'
      where p_action in ('route_sales', 'route_quote', 'route_production', 'route_completed', 'return_to_quote', 'return_to_completed', 'reclassify_design')
        and p_old.status = 'in_Design' and p_new.status is distinct from p_old.status and p_old.designer_id is not null
    union all select p_old.quote_id, 'assignment_removed', 'important', false, 'quote'
      where p_action in ('route_sales', 'route_design', 'route_production', 'route_completed', 'return_to_design', 'return_to_completed', 'reclassify_design')
        and p_old.status = 'in_Quote' and p_new.status is distinct from p_old.status and p_old.quote_id is not null
    union all select p_old.delivery_id, 'assignment_removed', 'important', false, 'delivery'
      where p_action in ('return_to_quote', 'reclassify_design')
        and p_old.status = 'in_Completed' and p_new.status is distinct from p_old.status and p_old.delivery_id is not null

    -- Production work belongs to the assignees of the active files, not every
    -- production user.  Each receives one deduplicated notice per event.
    union all select distinct f.assigned_to, 'assignment_received', 'action_required', true, 'production'
      from public.order_production_files f cross join active_context c
      where (
          p_action in ('route_production', 'production_file_status', 'production_file_reopened', 'production_file_added')
          or (p_action in ('block_order', 'update_block', 'resume_order', 'cancel_order', 'reopen_cancelled', 'update_requirements', 'reclassify_design', 'set_priority')
              and c.status in ('in_Production', 'in_Termination'))
        ) and f.order_id = p_new.id and f.assigned_to is not null
    -- Reassignments identify only the old and new file owner carried by the
    -- command's custom change payload; other production assignees are not
    -- participants in that intervention.
    union all select nullif(item->>'new_assigned_to', '')::uuid, 'assignment_received', 'action_required', true, 'production'
      from jsonb_array_elements(coalesce(nullif(current_setting('app.neonprint_admin_changed_fields', true), '')::jsonb, '[]'::jsonb)) item
      where p_action = 'reassign_production' and item->>'field' = 'production_file_assignment'
    union all select nullif(item->>'old_assigned_to', '')::uuid, 'assignment_removed', 'important', false, 'production'
      from jsonb_array_elements(coalesce(nullif(current_setting('app.neonprint_admin_changed_fields', true), '')::jsonb, '[]'::jsonb)) item
      where p_action = 'reassign_production' and item->>'field' = 'production_file_assignment'
    union all select nullif(item->>'old_assigned_to', '')::uuid, 'assignment_removed', 'important', false, 'production'
      from jsonb_array_elements(coalesce(nullif(current_setting('app.neonprint_admin_changed_fields', true), '')::jsonb, '[]'::jsonb)) item
      where p_action = 'production_file_removed' and item->>'field' = 'production_file_assignment'
    union all select distinct f.assigned_to, 'assignment_removed', 'important', false, 'production'
      from public.order_production_files f
      where p_action in ('route_completed', 'return_to_completed', 'reclassify_design')
        and p_old.status in ('in_Production', 'in_Termination') and p_new.status is distinct from p_old.status
        and f.order_id = p_old.id and f.assigned_to is not null

    -- Work interruptions and commercial changes only reach the people who own
    -- the active stage or its explicit blocking responsibility.
    union all select p_new.blocked_owner_id, 'work_paused', 'action_required', true, 'block_owner'
      where p_action in ('block_order', 'update_block') and p_new.blocked_owner_id is not null
    union all select p_new.seller_id,
      case when p_action = 'cancel_order' then 'work_cancelled' when p_action = 'reopen_cancelled' then 'work_resumed' else 'workflow_changed' end,
      case when p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design') then 'action_required' else 'important' end,
      p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design'), 'active_stage'
      from active_context c where p_action in ('block_order', 'update_block', 'resume_order', 'cancel_order', 'reopen_cancelled', 'update_requirements', 'reclassify_design', 'set_priority') and c.status = 'Pending'
    union all select p_new.designer_id,
      case when p_action = 'cancel_order' then 'work_cancelled' when p_action = 'reopen_cancelled' then 'work_resumed' else 'workflow_changed' end,
      case when p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design') then 'action_required' else 'important' end,
      p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design'), 'active_stage'
      from active_context c where p_action in ('block_order', 'update_block', 'resume_order', 'cancel_order', 'reopen_cancelled', 'update_requirements', 'reclassify_design', 'set_priority') and c.status = 'in_Design'
    union all select p_new.quote_id,
      case when p_action = 'cancel_order' then 'work_cancelled' when p_action = 'reopen_cancelled' then 'work_resumed' else 'workflow_changed' end,
      case when p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design') then 'action_required' else 'important' end,
      p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design'), 'active_stage'
      from active_context c where p_action in ('block_order', 'update_block', 'resume_order', 'cancel_order', 'reopen_cancelled', 'update_requirements', 'reclassify_design', 'set_priority') and c.status = 'in_Quote'
    union all select p_new.delivery_id,
      case when p_action = 'cancel_order' then 'work_cancelled' when p_action = 'reopen_cancelled' then 'work_resumed' else 'workflow_changed' end,
      case when p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design') then 'action_required' else 'important' end,
      p_action in ('block_order', 'resume_order', 'cancel_order', 'reopen_cancelled', 'reclassify_design'), 'active_stage'
      from active_context c where p_action in ('block_order', 'update_block', 'resume_order', 'cancel_order', 'reopen_cancelled', 'update_requirements', 'reclassify_design', 'set_priority') and c.status = 'in_Completed'
    union all select p_new.quote_id, 'payment_changed', 'important', false, 'quote'
      where p_action in ('register_payment', 'approve_commercial_review') and p_new.quote_id is not null
    union all select p_new.delivery_id, 'delivery_status_changed', 'info', false, 'delivery'
      where p_action = 'mark_delivered' and p_new.delivery_id is not null
  ), ranked as (
    select distinct on (c.user_id)
      c.user_id, c.template_key, c.priority, c.requires_ack, c.role_context,
      case c.priority when 'action_required' then 3 when 'important' then 2 else 1 end as rank
    from candidates c
    where c.user_id is not null and c.user_id is distinct from p_actor_id
    order by c.user_id, rank desc, c.requires_ack desc
  )
  select r.user_id, r.template_key, r.priority, r.requires_ack, r.role_context
  from ranked r
  join public.profiles p on p.id = r.user_id
  where coalesce(p.employment_status, true) and p.deleted_at is null
$$;

revoke all on function public.admin_intervention_direct_recipients(public.orders, public.orders, text, uuid) from public, anon, authenticated;

create or replace function public.write_admin_intervention_notice(
  p_event_id uuid,
  p_order public.orders,
  p_recipient_id uuid,
  p_template_key text,
  p_priority text,
  p_requires_ack boolean,
  p_action text,
  p_reason_label text,
  p_reason_detail text,
  p_changed_fields jsonb,
  p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_review_id uuid;
  v_name text;
  v_role text;
  v_order_code text := coalesce(p_order.order_code::text, left(p_order.id::text, 8));
  v_title text;
  v_message text;
  v_deep_link text;
begin
  select coalesce(nullif(trim(p.name), ''), p.email, 'usuario'), p.role into v_name, v_role
  from public.profiles p
  where p.id = p_recipient_id and coalesce(p.employment_status, true) and p.deleted_at is null;
  if not found or p_recipient_id is null or p_recipient_id = p_actor_id then return null; end if;

  v_title := case p_template_key
    when 'assignment_received' then 'Administración te asignó como responsable'
    when 'assignment_removed' then 'La orden fue asignada a otra persona'
    when 'work_paused' then 'La orden está bloqueada temporalmente'
    when 'work_resumed' then 'La orden volvió a estar disponible'
    when 'work_cancelled' then 'La orden fue cancelada'
    when 'payment_changed' then 'Administración actualizó el pago de la orden'
    when 'delivery_status_changed' then 'Administración actualizó la entrega'
    else 'Administración realizó un cambio en tu orden'
  end;
  v_message := case p_template_key
    when 'assignment_received' then 'Hola, ' || v_name || '. Administración te asignó como responsable de la orden #' || v_order_code || ' de ' || coalesce(p_order.client_name, 'este cliente') || '. Revísala para continuar.'
    when 'assignment_removed' then 'Hola, ' || v_name || '. Administración asignó la orden #' || v_order_code || ' de ' || coalesce(p_order.client_name, 'este cliente') || ' a otra persona. Ya no eres responsable de ella.'
    when 'work_paused' then 'Hola, ' || v_name || '. La orden #' || v_order_code || ' quedó bloqueada. Revisa el motivo antes de continuar.'
    when 'work_resumed' then 'Hola, ' || v_name || '. La orden #' || v_order_code || ' volvió a estar disponible para continuar el flujo.'
    when 'work_cancelled' then 'Hola, ' || v_name || '. Administración canceló la orden #' || v_order_code || '. No continúes el trabajo asociado.'
    else 'Hola, ' || v_name || '. Administración actualizó la orden #' || v_order_code || ' de ' || coalesce(p_order.client_name, 'este cliente') || '. Revisa la información antes de continuar.'
  end;
  v_deep_link := case v_role
    when 'seller' then '/page-seller?order=' || p_order.id::text
    when 'designer' then '/designer?order=' || p_order.id::text
    when 'quote' then '/quote?order=' || p_order.id::text
    when 'delivery' then '/delivery?order=' || p_order.id::text
    when 'digital_producer' then '/production?order=' || p_order.id::text
    when 'dtf_producer' then '/production?order=' || p_order.id::text
    when 'ploteo_producer' then '/production?order=' || p_order.id::text
    else '/dashboard?order=' || p_order.id::text
  end;

  insert into public.order_event_reviews(order_event_id, order_id, user_id, label, source_module, event_key, changed_fields, summary, metadata)
  values (
    p_event_id, p_order.id, p_recipient_id, v_title, 'admin', 'admin_intervention_notice', coalesce(p_changed_fields, '[]'::jsonb), v_message,
    jsonb_build_object('event_kind', 'admin_intervention_notice', 'template_key', p_template_key, 'priority', p_priority,
      'requires_ack', p_requires_ack, 'action', p_action, 'actor_id', p_actor_id, 'reason_label', p_reason_label,
      'reason_detail', p_reason_detail, 'deep_link', v_deep_link, 'order_code', v_order_code, 'client_name', p_order.client_name)
  ) on conflict (order_event_id, user_id) do update
    set label = excluded.label, summary = excluded.summary, changed_fields = excluded.changed_fields, metadata = excluded.metadata
  returning id into v_review_id;

  if not exists (select 1 from public.notifications n where n.user_id = p_recipient_id and n.metadata->>'review_id' = v_review_id::text and n.deleted_at is null) then
    insert into public.notifications(user_id, type, title, message, order_id, metadata)
    values (p_recipient_id, 'order_updated', v_title, v_message, p_order.id,
      jsonb_build_object('event_kind', 'admin_intervention_notice', 'event_id', p_event_id, 'review_id', v_review_id,
        'template_key', p_template_key, 'priority', p_priority, 'requires_ack', p_requires_ack, 'action', p_action,
        'actor_id', p_actor_id, 'reason_label', p_reason_label, 'reason_detail', p_reason_detail, 'deep_link', v_deep_link));
  end if;
  return v_review_id;
end;
$$;

revoke all on function public.write_admin_intervention_notice(uuid, public.orders, uuid, text, text, boolean, text, text, text, jsonb, uuid) from public, anon, authenticated;

create or replace function public.acknowledge_order_event_review(p_review_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_event_id uuid;
  v_count integer := 0;
begin
  if v_user_id is null or p_review_id is null then raise exception 'Authentication required'; end if;
  update public.order_event_reviews set reviewed_at = now(), reviewed_by = v_user_id
  where id = p_review_id and user_id = v_user_id and reviewed_at is null
  returning order_event_id into v_event_id;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    update public.notifications set is_read = true, read_at = coalesce(read_at, now())
    where user_id = v_user_id and metadata->>'review_id' = p_review_id::text and is_read = false;
  end if;
  return v_count;
end;
$$;

revoke all on function public.acknowledge_order_event_review(uuid) from public, anon;
grant execute on function public.acknowledge_order_event_review(uuid) to authenticated;

create or replace function public.record_admin_intervention(
  p_old public.orders, p_new public.orders, p_action text, p_reason_category text,
  p_reason_detail text, p_started_at timestamptz, p_custom_changed_fields jsonb default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_event_id uuid;
  v_changed_fields jsonb;
  v_reason_label text := public.admin_intervention_reason_label(p_reason_category);
  v_recipient record;
begin
  if p_custom_changed_fields is null then
    select coalesce(jsonb_agg(item || jsonb_build_object('old_value', public.admin_order_edit_value(p_old, item->>'field'), 'new_value', public.admin_order_edit_value(p_new, item->>'field'))), '[]'::jsonb)
    into v_changed_fields from jsonb_array_elements(public.order_business_changed_fields(p_old, p_new)) changed(item);
  else v_changed_fields := p_custom_changed_fields; end if;

  delete from public.order_events where order_id = p_new.id and actor_id is not distinct from v_actor_id
    and event_type in ('order_updated', 'admin_edited_order') and created_at >= p_started_at;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, old_payment_status, new_payment_status, changes)
  values (p_new.id, v_actor_id, 'admin_intervention', p_old.status, p_new.status, p_old.payment_status, p_new.payment_status,
    jsonb_build_object('source_module', 'admin', 'action', p_action, 'reason_category', p_reason_category, 'reason_label', v_reason_label,
      'reason_detail', p_reason_detail, 'changed_fields', v_changed_fields, 'old', to_jsonb(p_old), 'new', to_jsonb(p_new)))
  returning id into v_event_id;

  perform set_config('app.neonprint_admin_changed_fields', v_changed_fields::text, true);
  for v_recipient in select * from public.admin_intervention_direct_recipients(p_old, p_new, p_action, v_actor_id) loop
    perform public.write_admin_intervention_notice(v_event_id, p_new, v_recipient.user_id, v_recipient.template_key,
      v_recipient.priority, v_recipient.requires_ack, p_action, v_reason_label, p_reason_detail, v_changed_fields, v_actor_id);
  end loop;

  -- Admin update triggers may have emitted broad generic rows in the same
  -- transaction.  Direct notices above are the canonical employee message.
  update public.notifications set deleted_at = coalesce(deleted_at, now())
  where order_id = p_new.id and created_at >= p_started_at
    and metadata->>'actor_id' = v_actor_id::text
    and coalesce(metadata->>'event_kind', '') <> 'admin_intervention_notice';
  return v_event_id;
end;
$$;

revoke all on function public.record_admin_intervention(public.orders, public.orders, text, text, text, timestamptz, jsonb) from public, anon, authenticated;

-- The previous wrapper emitted a second generic notification to the actor when
-- reopening a cancelled order.  The central recorder above owns all employee
-- communication, so retain the command guards while removing that duplicate.
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
  v_actor uuid := public.require_active_admin_order_actor();
  v_target_user_id uuid;
  v_order_status text;
  v_result jsonb;
begin
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then raise exception 'Selecciona una categoria de motivo valida.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.'; end if;
  if exists (select 1 from public.admin_order_command_executions e where e.idempotency_key = p_idempotency_key) then
    perform set_config('app.neonprint_order_command', 'on', true);
    return public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  select status into v_order_status from public.orders where id = p_order_id for share;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_action = 'register_payment' and v_order_status <> 'in_Quote' then raise exception 'El pago solo puede modificarse cuando la orden esta en Caja.'; end if;
  if p_action in ('assign_seller', 'route_sales') then
    v_target_user_id := nullif(p_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is not null and v_target_user_id <> v_actor and not exists (
      select 1 from public.profiles p where p.id = v_target_user_id and p.role = 'seller' and coalesce(p.employment_status, true) and p.deleted_at is null
    ) then raise exception 'Selecciona un vendedor activo.'; end if;
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  if p_action = 'return_to_quote' and v_order_status = 'in_Completed' then
    v_result := public.admin_return_completed_to_quote_command(p_order_id, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  else
    v_result := public.admin_execute_order_command_legacy(p_order_id, p_action, p_payload, p_reason_category, p_reason_detail, p_expected_updated_at, p_idempotency_key);
  end if;
  return v_result;
end;
$$;

revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;

-- Credit approved by Administration is an operational Caja change.  Preserve
-- the existing Caja permission while only Administration emits an intervention
-- event and its direct recipient notice.
create or replace function public.mark_order_as_credit(
  p_order_id uuid, p_due_date timestamptz, p_expected_updated_at timestamptz
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_old public.orders;
  v_new public.orders;
  v_started_at timestamptz := clock_timestamp();
begin
  select p.role into v_role from public.profiles p where p.id = v_actor and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_actor is null or v_role not in ('admin', 'quote') then raise exception 'Solo caja o admin pueden aprobar pago a credito.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_role <> 'admin' and v_old.quote_id is distinct from v_actor then raise exception 'No tienes acceso a esta orden.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_old.status <> 'in_Quote' or coalesce(v_old.is_archived, false) or v_old.payment_status <> 'Pending_Payment' then raise exception 'La orden no es elegible para credito.'; end if;
  if v_old.client_id is null or nullif(trim(coalesce(v_old.invoice_number, '')), '') is null then raise exception 'Para vender a credito debes registrar cliente y factura.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set payment_status = 'credito', invoice_payment = null, updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
  insert into public.accounts_receivable(order_id, client_id, invoice_number, status, issued_at, due_date, created_by)
  values (p_order_id, v_new.client_id, nullif(trim(v_new.invoice_number), ''), 'open', now(), p_due_date, v_actor)
  on conflict(order_id) do update set client_id = excluded.client_id, invoice_number = excluded.invoice_number, due_date = excluded.due_date, status = 'open', updated_at = now();
  if v_role = 'admin' then
    perform public.record_admin_intervention(v_old, v_new, 'register_payment', 'workflow_correction',
      'Administración aprobó la orden a crédito.', v_started_at,
      jsonb_build_array(jsonb_build_object('field', 'payment_status', 'label', 'Estado de pago', 'old_value', v_old.payment_status, 'new_value', v_new.payment_status, 'due_date', p_due_date)));
  else
    insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
    values (p_order_id, v_actor, 'credit_granted', v_old.payment_status, 'credito', jsonb_build_object('client_id', v_new.client_id, 'invoice_number', v_new.invoice_number, 'due_date', p_due_date));
  end if;
  return v_new;
end;
$$;

revoke all on function public.mark_order_as_credit(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.mark_order_as_credit(uuid, timestamptz, timestamptz) to authenticated;

-- Replace the legacy per-file reassignment notifications with one audited
-- intervention and two individualized notices (incoming and outgoing owner).
create or replace function public.admin_reassign_file_production_area(
  p_file_id uuid, p_new_area_code text, p_new_assigned_user_id uuid, p_expected_updated_at timestamptz
)
returns public.order_production_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.require_active_admin_order_actor();
  v_old_file public.order_production_files;
  v_new_file public.order_production_files;
  v_old_order public.orders;
  v_new_order public.orders;
  v_started_at timestamptz := clock_timestamp();
begin
  select * into v_old_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo de produccion no existe.'; end if;
  select * into v_old_order from public.orders where id = v_old_file.order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_new_assigned_user_id is not null and not exists (
    select 1
    from public.profiles p
    join public.production_areas a on a.producer_role = p.role
    where p.id = p_new_assigned_user_id and a.code = p_new_area_code and a.is_active
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Selecciona un responsable activo del area de Produccion.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_reassigned', true);
  select * into v_new_file from public.admin_reassign_file_production_area_legacy(p_file_id, p_new_area_code, p_new_assigned_user_id, p_expected_updated_at);
  select * into v_new_order from public.orders where id = v_old_order.id;
  update public.notifications set deleted_at = coalesce(deleted_at, now())
   where order_id = v_old_order.id and created_at >= v_started_at
     and metadata->>'actor_id' = v_actor::text
     and coalesce(metadata->>'event_kind', '') in ('file_reassignment', 'file_assigned');
  perform public.record_admin_intervention(v_old_order, v_new_order, 'reassign_production', 'assignment_correction',
    'Administración reasignó un archivo de Producción.', v_started_at,
    jsonb_build_array(jsonb_build_object('field', 'production_file_assignment', 'file_id', v_old_file.id,
      'old_assigned_to', v_old_file.assigned_to, 'new_assigned_to', v_new_file.assigned_to,
      'old_area_code', v_old_file.production_area_code, 'new_area_code', v_new_file.production_area_code)));
  return v_new_file;
end;
$$;

revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) to authenticated;

-- Preserve the removed file's owner in the intervention payload before the
-- row is deleted, so the person losing that work receives the direct notice.
create or replace function public.admin_remove_production_file(
  p_file_id uuid, p_reason_detail text, p_expected_updated_at timestamptz
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
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then raise exception 'Solo un administrador activo puede retirar archivos.'; end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then raise exception 'Explica el motivo con al menos 10 caracteres.'; end if;
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  if v_file.updated_at is distinct from p_expected_updated_at then raise exception 'El archivo cambio mientras lo editabas.'; end if;
  select * into v_old from public.orders where id = v_file.order_id for update;
  if v_old.status in ('cancelled', 'in_Delivered') then raise exception 'No se pueden retirar archivos en una orden terminal.'; end if;
  select count(*) into v_count from public.order_production_files where order_id = v_file.order_id;
  if v_count <= 1 and v_old.status not in ('Pending', 'in_Design') then raise exception 'No se puede retirar el ultimo archivo desde Caja en adelante.'; end if;
  perform public.enqueue_admin_order_asset_deletion(v_file.order_id, v_file.url, 'order-docs');
  perform set_config('app.neonprint_order_command', 'on', true);
  delete from public.order_production_files where id = p_file_id;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_urls
  from jsonb_array_elements_text(coalesce(nullif(v_old.order_file_url, ''), '[]')::jsonb) item where item <> v_file.url;
  update public.orders set order_file_url = v_urls::text,
    last_admin_intervention_at = now(), last_admin_intervention_by = v_actor,
    last_admin_intervention_kind = 'production_file_removed', updated_at = now()
  where id = v_file.order_id returning * into v_new;
  perform public.record_admin_intervention(v_old, v_new, 'production_file_removed', 'workflow_correction', trim(p_reason_detail), v_started,
    jsonb_build_array(
      jsonb_build_object('field', 'production_file', 'label', v_file.public_label, 'old_value', v_file.filename, 'new_value', null),
      jsonb_build_object('field', 'production_file_assignment', 'file_id', v_file.id, 'old_assigned_to', v_file.assigned_to, 'new_assigned_to', null,
        'old_area_code', v_file.production_area_code, 'new_area_code', null)
    ));
  return p_file_id;
end;
$$;

revoke all on function public.admin_remove_production_file(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_remove_production_file(uuid, text, timestamptz) to authenticated;
