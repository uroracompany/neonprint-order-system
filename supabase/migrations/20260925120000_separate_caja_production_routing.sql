-- Separate Caja's financial responsibility from production routing.
-- The public RPC signature is preserved; only its authorization boundary changes.

create or replace function public.can_send_order_to_production(
  p_order_id uuid,
  p_actor_id uuid default auth.uid()
) returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_order public.orders;
begin
  if v_actor is null or p_actor_id is distinct from v_actor then
    return false;
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id;
  if not found
    or coalesce(v_order.is_archived, false)
    or coalesce(v_order.is_archived_quote, false)
    or coalesce(v_order.is_archived_designer, false)
    or v_order.operational_status = 'blocked'
    or v_order.status <> 'in_Quote'
    or v_order.payment_status not in ('pagado', 'parcial', 'credito') then
    return false;
  end if;

  select p.role into v_role
  from public.profiles p
  where p.id = v_actor
    and coalesce(p.employment_status, true)
    and p.deleted_at is null;

  if v_role = 'admin' then
    return true;
  end if;

  if v_role = 'designer' then
    return v_order.order_design_type = 'INTERNAL_DESING'
      and v_order.designer_id = v_actor;
  end if;

  if v_role = 'seller' then
    return v_order.order_design_type = 'EXTERNAL_DESING'
      and (v_order.seller_id = v_actor or v_order.created_by = v_actor);
  end if;

  if v_role = 'semi_admin' then
    return public.semi_admin_can_operate_stage(p_order_id, 'quote', null);
  end if;

  -- In particular, quote/Caja is deliberately not authorized here.
  return false;
end;
$$;

revoke all on function public.can_send_order_to_production(uuid, uuid) from public, anon;
grant execute on function public.can_send_order_to_production(uuid, uuid) to authenticated;

-- Patch the already audited production command in place so its assignment,
-- locking, concurrency and file validation remain unchanged.
do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.send_order_to_production(uuid,jsonb)'::regprocedure)
    into v_definition;

  v_patched := replace(
    v_definition,
    $old_role$if v_profile_role is null or v_profile_role not in ('admin', 'quote') then
    raise exception 'Solo caja o admin pueden enviar ordenes a produccion.';
  end if;$old_role$,
    $new_role$if v_profile_role is null or v_profile_role not in ('admin', 'designer', 'seller', 'semi_admin') then
    raise exception 'Este rol no puede enviar ordenes a produccion.';
  end if;$new_role$
  );

  v_patched := replace(
    v_patched,
    $old_owner$if v_profile_role <> 'admin' and v_order.quote_id is distinct from v_uid then
    raise exception 'No tienes acceso a esta orden.';
  end if;$old_owner$,
    $new_owner$if not public.can_send_order_to_production(p_order_id, v_uid) then
    raise exception 'No tienes permiso para enviar esta orden a produccion.';
  end if;
  if exists (
    select 1
    from public.order_production_files opf
    where opf.order_id = p_order_id
      and (
        nullif(trim(coalesce(opf.production_area_code, '')), '') is null
        or coalesce(cardinality(opf.material_names), 0) = 0
        or nullif(trim(coalesce(opf.termination_name, '')), '') is null
      )
  ) then
    raise exception 'Cada archivo requiere area, materiales y terminacion antes de enviarse a produccion.';
  end if;$new_owner$
  );

  if v_patched = v_definition
    or v_patched like '%Solo caja o admin pueden enviar ordenes a produccion.%'
    or v_patched like '%v_order.quote_id is distinct from v_uid%' then
    raise exception 'No se pudo actualizar de forma segura la autorizacion de produccion.';
  end if;

  execute v_patched;
end;
$$;

-- Keep financial notifications for Caja, but remove Caja from generic
-- cancellation/status fan-out (production, termination, completion, delivery).
do $$
declare
  v_definition text;
  v_patched text;
begin
  select pg_get_functiondef('public.handle_order_change_notification()'::regprocedure)
    into v_definition;

  v_patched := replace(
    v_definition,
    'designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || production_users',
    'designer_recipients || array[new.seller_id, new.created_by, actor_id] || admins || production_users'
  );
  v_patched := replace(
    v_patched,
    'designer_recipients || quote_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers || production_users',
    'designer_recipients || array[new.seller_id, new.created_by, actor_id] || admins || printers || production_users'
  );

  if v_patched = v_definition then
    raise exception 'No se pudo actualizar de forma segura el reparto operativo de notificaciones.';
  end if;

  execute v_patched;
end;
$$;

notify pgrst, 'reload schema';
