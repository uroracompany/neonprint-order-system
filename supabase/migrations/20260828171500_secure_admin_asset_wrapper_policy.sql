-- Close the remaining administrative asset wrappers behind the same catalogue
-- policy used by every other public administrative command.

do $$
begin
  if to_regprocedure('public.admin_order_action_policy_legacy(uuid)') is null
     and to_regprocedure('public.admin_order_action_policy(uuid)') is not null then
    alter function public.admin_order_action_policy(uuid) rename to admin_order_action_policy_legacy;
  end if;
  if to_regprocedure('public.admin_edit_order_with_assets_legacy(uuid,timestamptz,jsonb,jsonb,text[],text)') is null
     and to_regprocedure('public.admin_edit_order_with_assets(uuid,timestamptz,jsonb,jsonb,text[],text)') is not null then
    alter function public.admin_edit_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text) rename to admin_edit_order_with_assets_legacy;
  end if;
end;
$$;

-- Commercial editing remains an administrative privilege for any active,
-- non-terminal order, but is declared as an internal policy action so it is
-- never surfaced as an unsupported Advanced Settings transition.
create or replace function public.admin_order_action_policy(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_policy jsonb;
begin
  perform public.require_active_admin_order_actor();
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'La orden no existe.'; end if;
  v_policy := public.admin_order_action_policy_legacy(p_order_id);
  if v_order.operational_status <> 'blocked'
     and v_order.status not in ('cancelled', 'in_Delivered') then
    v_policy := v_policy || jsonb_build_object(
      'internal_actions',
      jsonb_build_array(jsonb_build_object(
        'key', 'edit_order',
        'requirements', jsonb_build_object('capability', 'commercial_edit')
      ))
    );
  else
    v_policy := v_policy || jsonb_build_object('internal_actions', '[]'::jsonb);
  end if;
  return v_policy;
end;
$$;

create or replace function public.assert_admin_order_action_allowed(p_order_id uuid, p_key text, p_capability text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_action jsonb;
begin
  perform public.require_active_admin_order_actor();
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  v_policy := public.admin_order_action_policy(p_order_id);
  select item into v_action
  from jsonb_array_elements(
    coalesce(v_policy->'actions', '[]'::jsonb) || coalesce(v_policy->'internal_actions', '[]'::jsonb)
  ) item
  where item->>'key' = p_key
  limit 1;
  if v_action is null then
    raise exception 'La acción administrativa no está disponible en la etapa actual.';
  end if;
  if p_capability is not null and not (
    coalesce(v_action->'requirements'->'capabilities', '[]'::jsonb) ? p_capability
    or coalesce(v_action->'requirements'->>'capability', '') = p_capability
  ) then
    raise exception 'La capacidad administrativa no está disponible en la etapa actual.';
  end if;
  return v_action;
end;
$$;

create or replace function public.admin_get_order_command_catalog(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.admin_order_action_policy(p_order_id)
$$;

create or replace function public.admin_edit_order_with_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb,
  p_removed_file_urls text[] default '{}'::text[],
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_changes_assets boolean;
begin
  perform public.require_active_admin_order_actor();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at
     and not exists (
       select 1 from public.admin_order_command_executions e
       where e.idempotency_key = p_idempotency_key and e.result is not null
     ) then
    raise exception 'ORDER_STALE';
  end if;
  perform public.assert_admin_order_action_allowed(p_order_id, 'edit_order', 'commercial_edit');
  v_changes_assets := jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0
    or cardinality(coalesce(p_removed_file_urls, '{}'::text[])) > 0
    or coalesce(p_changes, '{}'::jsonb) ? 'preview_image'
    or coalesce(p_changes, '{}'::jsonb) ? 'reference_images';
  if v_changes_assets then
    perform public.assert_admin_order_action_allowed(p_order_id, 'manage_files', 'manage_design_assets');
  end if;
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'admin_order_assets', true);
  return public.admin_edit_order_with_assets_legacy(
    p_order_id, p_expected_updated_at, p_changes, p_new_production_files, p_removed_file_urls, p_idempotency_key
  );
end;
$$;

create or replace function public.admin_update_order_asset_metadata(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders;
  v_result jsonb;
  v_key text;
begin
  perform public.require_active_admin_order_actor();
  for v_key in select jsonb_object_keys(coalesce(p_changes, '{}'::jsonb)) loop
    if v_key not in ('preview_image', 'reference_images') then raise exception 'Campo no permitido: %', v_key; end if;
  end loop;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform public.assert_admin_order_action_allowed(p_order_id, 'manage_files', 'manage_design_assets');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'admin_order_assets', true);
  v_result := public.admin_edit_order_with_assets(
    p_order_id, p_expected_updated_at, p_changes, '[]'::jsonb, '{}'::text[], gen_random_uuid()::text
  );
  return jsonb_populate_record(null::public.orders, v_result->'order');
end;
$$;

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
  v_order public.orders;
  v_file public.order_production_files;
  v_result jsonb;
begin
  perform public.require_active_admin_order_actor();
  if nullif(trim(coalesce(p_url, '')), '') is null or nullif(trim(coalesce(p_public_label, '')), '') is null then
    raise exception 'El archivo y su etiqueta son obligatorios.';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  perform public.assert_admin_order_action_allowed(p_order_id, 'manage_files', 'manage_design_assets');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'admin_order_assets', true);
  v_result := public.admin_edit_order_with_assets(
    p_order_id, p_expected_updated_at, '{}'::jsonb,
    jsonb_build_array(jsonb_build_object('url', trim(p_url), 'filename', p_filename, 'public_label', p_public_label, 'production_area_code', p_area_code)),
    '{}'::text[], gen_random_uuid()::text
  );
  select * into v_file from public.order_production_files where order_id = p_order_id and url = trim(p_url);
  return jsonb_build_object('file', to_jsonb(v_file), 'order_updated_at', (v_result->'order'->>'updated_at')::timestamptz);
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
  v_actor uuid := public.require_active_admin_order_actor();
  v_file public.order_production_files;
  v_old public.orders;
  v_new public.orders;
  v_urls jsonb;
  v_count integer;
  v_started timestamptz := clock_timestamp();
begin
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'Explica el motivo con al menos 10 caracteres.';
  end if;
  select * into v_file from public.order_production_files where id = p_file_id for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  if v_file.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  select * into v_old from public.orders where id = v_file.order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  perform public.assert_admin_order_action_allowed(v_file.order_id, 'manage_files', 'manage_design_assets');
  select count(*) into v_count from public.order_production_files where order_id = v_file.order_id;
  if v_count <= 1 and v_old.status not in ('Pending', 'in_Design') then
    raise exception 'No se puede retirar el último archivo fuera de su etapa de activos.';
  end if;
  perform public.enqueue_admin_order_asset_deletion(v_file.order_id, v_file.url, 'order-docs');
  perform set_config('app.neonprint_order_command', 'on', true);
  perform set_config('app.admin_intervention_context', 'admin_order_assets', true);
  delete from public.order_production_files where id = p_file_id;
  select coalesce(jsonb_agg(item), '[]'::jsonb) into v_urls
  from jsonb_array_elements_text(coalesce(nullif(v_old.order_file_url, ''), '[]')::jsonb) item
  where item <> v_file.url;
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

-- The original implementation follows the renamed function OID and must never
-- remain callable after the policy wrapper replaces it.
revoke all on function public.admin_edit_order_with_assets_legacy(uuid, timestamptz, jsonb, jsonb, text[], text) from public, anon, authenticated;
revoke all on function public.admin_order_action_policy_legacy(uuid), public.assert_admin_order_action_allowed(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_get_order_command_catalog(uuid), public.admin_edit_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text), public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb), public.admin_add_production_file(uuid, text, text, text, text, timestamptz), public.admin_remove_production_file(uuid, text, timestamptz) from public, anon;
grant execute on function public.admin_get_order_command_catalog(uuid), public.admin_edit_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text), public.admin_update_order_asset_metadata(uuid, timestamptz, jsonb), public.admin_add_production_file(uuid, text, text, text, text, timestamptz), public.admin_remove_production_file(uuid, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
