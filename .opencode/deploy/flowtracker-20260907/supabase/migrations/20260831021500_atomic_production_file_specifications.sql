-- Keep attachment commands and file specifications in one transaction. The
-- delegated commands retain their existing ownership, storage, and lifecycle
-- validation; a failed specification update rolls the entire command back.

create or replace function public.create_seller_order_with_file_specifications(
  p_idempotency_key uuid,
  p_order jsonb,
  p_production_files jsonb default '[]'::jsonb,
  p_asset_refs jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  v_order := public.create_seller_order_with_assets(
    p_idempotency_key, p_order, p_production_files, p_asset_refs
  );

  if jsonb_array_length(coalesce(p_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_production_files
    );
  end if;

  return v_order;
end;
$$;

create or replace function public.seller_update_order_with_files_and_specifications(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb,
  p_removed_file_urls text[] default '{}'::text[]
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  v_order := public.seller_update_order_with_files(
    p_order_id, p_expected_updated_at, p_changes, p_new_production_files, p_removed_file_urls
  );

  if jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_new_production_files
    );
  end if;

  return v_order;
end;
$$;

create or replace function public.admin_edit_order_with_file_specifications(
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
set search_path = public
as $$
declare
  v_result jsonb;
  v_order public.orders%rowtype;
begin
  v_result := public.admin_edit_order_with_assets(
    p_order_id, p_expected_updated_at, p_changes, p_new_production_files,
    p_removed_file_urls, p_idempotency_key
  );

  if jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0 then
    select * into v_order from jsonb_populate_record(null::public.orders, v_result->'order');
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_new_production_files
    );
    v_result := jsonb_set(v_result, '{order}', to_jsonb(v_order));
    update public.admin_order_command_executions
    set result = v_result, completed_at = now()
    where idempotency_key = p_idempotency_key;
  end if;

  return v_result;
end;
$$;

create or replace function public.designer_update_order_with_file_specifications(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  v_order := public.designer_update_order_assets(
    p_order_id, p_expected_updated_at, p_changes, p_new_production_files
  );

  if jsonb_array_length(coalesce(p_new_production_files, '[]'::jsonb)) > 0 then
    v_order := public.save_order_production_file_specifications(
      v_order.id, v_order.updated_at, p_new_production_files
    );
  end if;

  return v_order;
end;
$$;

create or replace function public.admin_add_production_file_with_specifications(
  p_order_id uuid,
  p_url text,
  p_filename text,
  p_public_label text,
  p_area_code text,
  p_material_names jsonb,
  p_termination_name text,
  p_expected_updated_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_order public.orders%rowtype;
  v_file public.order_production_files%rowtype;
  v_specification jsonb;
begin
  v_result := public.admin_add_production_file(
    p_order_id, p_url, p_filename, p_public_label, p_area_code, p_expected_updated_at
  );
  select * into v_order from jsonb_populate_record(
    null::public.orders,
    jsonb_build_object('updated_at', v_result->>'order_updated_at', 'id', p_order_id)
  );

  v_specification := jsonb_build_object(
    'url', p_url,
    'production_area_code', p_area_code,
    'material_names', coalesce(p_material_names, '[]'::jsonb),
    'termination_name', p_termination_name
  );
  v_order := public.save_order_production_file_specifications(
    p_order_id, v_order.updated_at, jsonb_build_array(v_specification)
  );
  select * into v_file from public.order_production_files
  where order_id = p_order_id and url = trim(p_url);

  return jsonb_build_object('file', to_jsonb(v_file), 'order_updated_at', v_order.updated_at);
end;
$$;

revoke all on function public.create_seller_order_with_file_specifications(uuid, jsonb, jsonb, jsonb) from public, anon;
revoke all on function public.seller_update_order_with_files_and_specifications(uuid, timestamptz, jsonb, jsonb, text[]) from public, anon;
revoke all on function public.admin_edit_order_with_file_specifications(uuid, timestamptz, jsonb, jsonb, text[], text) from public, anon;
revoke all on function public.designer_update_order_with_file_specifications(uuid, timestamptz, jsonb, jsonb) from public, anon;
revoke all on function public.admin_add_production_file_with_specifications(uuid, text, text, text, text, jsonb, text, timestamptz) from public, anon;

grant execute on function public.create_seller_order_with_file_specifications(uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.seller_update_order_with_files_and_specifications(uuid, timestamptz, jsonb, jsonb, text[]) to authenticated;
grant execute on function public.admin_edit_order_with_file_specifications(uuid, timestamptz, jsonb, jsonb, text[], text) to authenticated;
grant execute on function public.designer_update_order_with_file_specifications(uuid, timestamptz, jsonb, jsonb) to authenticated;
grant execute on function public.admin_add_production_file_with_specifications(uuid, text, text, text, text, jsonb, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
