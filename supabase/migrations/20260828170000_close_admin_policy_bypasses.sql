-- Close compatibility entrypoints that could bypass the stage-aware policy.

-- These pre-policy entrypoints are no longer used by the UI.  Keep their
-- implementations for migration compatibility, but do not expose a second
-- public command surface.
revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.admin_intervene_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon, authenticated;

-- Batch execution remains supported, but every order is locked and checked by
-- the same policy before it reaches the public command wrapper.
create or replace function public.admin_execute_order_batch(
  p_order_ids uuid[], p_action text, p_payload jsonb, p_reason_category text, p_reason_detail text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid; v_order public.orders; v_results jsonb := '[]'::jsonb; v_result jsonb; v_index integer := 0;
begin
  perform public.require_active_admin_order_actor();
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecciona al menos una orden.'; end if;
  if array_length(p_order_ids, 1) > 100 then raise exception 'El lote no puede superar 100 ordenes.'; end if;
  foreach v_order_id in array p_order_ids loop
    v_index := v_index + 1;
    begin
      select * into v_order from public.orders where id = v_order_id for update;
      if not found then raise exception 'La orden no existe.'; end if;
      perform public.assert_admin_order_action_allowed(v_order_id, p_action);
      v_result := public.admin_execute_order_command(v_order_id, p_action, p_payload, p_reason_category, p_reason_detail, v_order.updated_at, p_idempotency_key || ':' || v_index::text || ':' || v_order_id::text);
      v_results := v_results || jsonb_build_array(jsonb_build_object('order_id', v_order_id, 'success', true, 'result', v_result));
    exception when others then
      v_results := v_results || jsonb_build_array(jsonb_build_object('order_id', v_order_id, 'success', false, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('action', p_action, 'total', array_length(p_order_ids, 1), 'results', v_results);
end;
$$;

-- The force-status command is retained only as a private compatibility symbol.
-- Configuration avanzada uses the graph-validating update command below.
revoke all on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon, authenticated;

create or replace function public.admin_update_production_file_status(
  p_file_id uuid, p_next_status text, p_reason_category text, p_reason_detail text, p_expected_updated_at timestamptz, p_delivery_id uuid default null
) returns public.order_production_files language plpgsql security definer set search_path = '' as $$
declare v_order_id uuid; v_current_status text;
begin
  perform public.require_active_admin_order_actor();
  select order_id, status into v_order_id, v_current_status from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo de producción no existe.'; end if;
  perform public.assert_admin_order_action_allowed(v_order_id, 'manage_files', 'manage_production_files');
  if not (
    (v_current_status = 'pending' and p_next_status = 'in_production')
    or (v_current_status = 'in_production' and p_next_status = 'in_termination')
    or (v_current_status = 'in_termination' and p_next_status in ('in_production', 'completed'))
    or (v_current_status = 'completed' and p_next_status = 'in_termination')
  ) then raise exception 'La transición del archivo no está permitida.'; end if;
  if p_delivery_id is not null and not exists (
    select 1 from public.profiles p where p.id = p_delivery_id and p.role = 'delivery'
      and p.employment_status is true and p.deleted_at is null
  ) then raise exception 'Selecciona un Delivery activo.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'production_file_status', true);
  return public.admin_update_production_file_status_legacy(p_file_id, p_next_status, p_reason_category, p_reason_detail, p_expected_updated_at, p_delivery_id);
end;
$$;

-- Credit has a specialised financial write path.  Administration must satisfy
-- the policy; Caja keeps its equivalent assigned-Caja and unblocked checks.
create or replace function public.mark_order_as_credit(
  p_order_id uuid, p_due_date timestamptz, p_expected_updated_at timestamptz
) returns public.orders language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_role text; v_old public.orders; v_new public.orders; v_started timestamptz := clock_timestamp();
begin
  select p.role into v_role from public.profiles p where p.id = v_actor and coalesce(p.employment_status, true) and p.deleted_at is null;
  if v_actor is null or v_role not in ('admin', 'quote') then raise exception 'Solo Caja o Administración pueden aprobar pago a crédito.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  select * into v_old from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_old.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if v_old.operational_status = 'blocked' then raise exception 'La orden está bloqueada. Reanúdala antes de modificar el pago.'; end if;
  if v_role = 'admin' then
    perform public.assert_admin_order_action_allowed(p_order_id, 'register_payment');
  elsif v_old.quote_id is distinct from v_actor then
    raise exception 'No tienes acceso a esta orden.';
  end if;
  if v_old.status <> 'in_Quote' or coalesce(v_old.is_archived, false) or v_old.payment_status <> 'Pending_Payment' then raise exception 'La orden no es elegible para crédito.'; end if;
  if v_old.client_id is null or nullif(trim(coalesce(v_old.invoice_number, '')), '') is null then raise exception 'Para vender a crédito debes registrar cliente y factura.'; end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders set payment_status = 'credito', invoice_payment = null, updated_at = now(), updated_by = v_actor where id = p_order_id returning * into v_new;
  insert into public.accounts_receivable(order_id, client_id, invoice_number, status, issued_at, due_date, created_by)
  values (p_order_id, v_new.client_id, nullif(trim(v_new.invoice_number), ''), 'open', now(), p_due_date, v_actor)
  on conflict(order_id) do update set client_id = excluded.client_id, invoice_number = excluded.invoice_number, due_date = excluded.due_date, status = 'open', updated_at = now();
  if v_role = 'admin' then
    perform public.record_admin_intervention(v_old, v_new, 'register_payment', 'workflow_correction', 'Administración aprobó la orden a crédito.', v_started,
      jsonb_build_array(jsonb_build_object('field', 'payment_status', 'label', 'Estado de pago', 'old_value', v_old.payment_status, 'new_value', v_new.payment_status, 'due_date', p_due_date)));
  else
    insert into public.order_events(order_id, actor_id, event_type, old_payment_status, new_payment_status, changes)
    values (p_order_id, v_actor, 'credit_granted', v_old.payment_status, 'credito', jsonb_build_object('client_id', v_new.client_id, 'invoice_number', v_new.invoice_number, 'due_date', p_due_date));
  end if;
  return v_new;
end;
$$;

-- A browser that uploaded a file may request only an audited outbox entry for
-- that exact object; it never receives Storage delete authority.
create or replace function public.admin_enqueue_unattached_order_asset_deletion(p_order_id uuid, p_bucket text, p_url text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.require_active_admin_order_actor();
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_bucket not in ('order-docs', 'order-previews', 'payment-invoice') then raise exception 'Bucket de orden no permitido.'; end if;
  if exists (
    select 1 from public.order_production_files f
    where f.order_id = p_order_id and f.url = p_url
  ) or exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.preview_image is not distinct from p_url or coalesce(to_jsonb(o.reference_images), '[]'::jsonb) ? p_url)
  ) then
    raise exception 'El archivo ya está asociado a la orden y no puede limpiarse como huérfano.';
  end if;
  perform public.enqueue_admin_order_asset_deletion(p_order_id, p_url, p_bucket);
end;
$$;

-- The 4-argument overload cannot represent a caller-provided audit reason.
-- It remains defined only for migration history and is deliberately ungranted.
revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) from public, anon, authenticated;
comment on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) is 'Deprecated compatibility overload: no execution grant; use six-argument audited command.';

revoke all on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) from public, anon;
grant execute on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) to authenticated;
-- Only the optimistic three-argument credit command is exposed.  Retiring
-- older overloads prevents a caller from skipping policy and block checks.
revoke all on function public.mark_order_as_credit(uuid, timestamptz), public.mark_order_as_credit(uuid, timestamptz, numeric) from public, anon, authenticated;
revoke all on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid), public.mark_order_as_credit(uuid, timestamptz, timestamptz), public.admin_enqueue_unattached_order_asset_deletion(uuid, text, text) from public, anon;
grant execute on function public.admin_update_production_file_status(uuid, text, text, text, timestamptz, uuid), public.mark_order_as_credit(uuid, timestamptz, timestamptz), public.admin_enqueue_unattached_order_asset_deletion(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
