-- Retired profiles are not authorized actors or assignment targets. Keep the
-- public command names stable while retaining the established implementation as
-- the compatibility engine for its idempotency, optimistic-locking and audit
-- behavior.
do $$
begin
  if to_regprocedure('public.admin_execute_order_command_legacy(uuid,text,jsonb,text,text,timestamptz,text)') is null
    and to_regprocedure('public.admin_execute_order_command(uuid,text,jsonb,text,text,timestamptz,text)') is not null then
    alter function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text)
      rename to admin_execute_order_command_legacy;
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
  v_actor uuid := auth.uid();
  v_order public.orders;
begin
  perform 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'admin'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
    for share;
  if v_actor is null or not found then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;

  -- An active administrator may retain the existing self-assignment behavior,
  -- but every seller target must be active and must not be retired.
  if p_action in ('assign_seller', 'route_sales')
     and p_target_user_id is not null
     and p_target_user_id <> v_actor
  then
    perform 1
       from public.profiles p
       where p.id = p_target_user_id
         and p.role = 'seller'
         and coalesce(p.employment_status, true)
         and p.deleted_at is null
       for share;
    if not found then
      raise exception 'Selecciona un vendedor activo.';
    end if;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;
  if not found then
    raise exception 'La orden no existe.';
  end if;
  if v_order.operational_status = 'blocked' then
    raise exception 'La orden esta bloqueada. Reanudala antes de cambiar su etapa o responsable.';
  end if;

  return public.admin_manage_order_legacy(
    p_order_id, p_action, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_target_user_id, p_area_assignments
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
  v_target_user_id uuid;
begin
  perform 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'admin'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
    for share;
  if v_actor is null or not found then
    raise exception 'Solo un administrador activo puede intervenir una orden.';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'Falta la clave de idempotencia.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  -- The legacy command returns an already-recorded idempotent result before
  -- performing workflow validation. Preserve that behavior exactly.
  if exists (
    select 1
    from public.admin_order_command_executions e
    where e.idempotency_key = p_idempotency_key
  ) then
    return public.admin_execute_order_command_legacy(
      p_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
      p_expected_updated_at, p_idempotency_key
    );
  end if;

  -- Validate seller routing before the legacy workflow command receives the
  -- target. A verified active admin may still assign the order to themselves.
  if p_action in ('assign_seller', 'route_sales') then
    v_target_user_id := nullif(p_payload->>'target_user_id', '')::uuid;
    if v_target_user_id is not null
       and v_target_user_id <> v_actor then
      perform 1
         from public.profiles p
         where p.id = v_target_user_id
           and p.role = 'seller'
           and coalesce(p.employment_status, true)
           and p.deleted_at is null
         for share;
      if not found then
        raise exception 'Selecciona un vendedor activo.';
      end if;
    end if;
  end if;

  return public.admin_execute_order_command_legacy(
    p_order_id, p_action, p_payload, p_reason_category, p_reason_detail,
    p_expected_updated_at, p_idempotency_key
  );
end;
$$;

-- Recompile the retained batch entrypoint against the new public command so it
-- cannot retain a cached reference to the renamed compatibility engine.
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

revoke all on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) from public, anon;
grant execute on function public.admin_manage_order(uuid, text, text, text, timestamptz, uuid, jsonb) to authenticated;
revoke all on function public.admin_execute_order_command_legacy(uuid, text, jsonb, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_execute_order_command(uuid, text, jsonb, text, text, timestamptz, text) to authenticated;
revoke all on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) from public, anon;
grant execute on function public.admin_execute_order_batch(uuid[], text, jsonb, text, text, text) to authenticated;
