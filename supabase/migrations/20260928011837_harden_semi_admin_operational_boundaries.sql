-- Close the remaining Semi-Admin security-boundary gaps identified by the
-- lifecycle audit. This migration is forward-only and preserves the command
-- gateway as the supported entry point.

create or replace function public.semi_admin_route_order_to_production_v2(
  p_order_id uuid,
  p_area_assignments jsonb,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_area record;
  v_assignee uuid;
  v_role text;
begin
  if jsonb_typeof(coalesce(p_area_assignments, '{}'::jsonb)) <> 'object' then
    raise exception 'Las asignaciones de Producción son inválidas.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if p_expected_updated_at is null or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if v_order.production_authorized_at is null or v_order.production_authorized_by is null then
    raise exception 'Caja o Administración debe autorizar la orden antes de enviarla a Producción.';
  end if;
  if not public.semi_admin_can_operate_stage(p_order_id, 'quote', null) then
    raise exception 'Asígnate como responsable de Caja antes de preparar el envío a Producción.';
  end if;

  for v_area in
    select distinct a.code, a.label, a.producer_role
    from public.order_production_files f
    join public.production_areas a on a.code = f.production_area_code and a.is_active
    where f.order_id = p_order_id
  loop
    begin
      v_assignee := nullif(p_area_assignments ->> v_area.code, '')::uuid;
    exception when invalid_text_representation then
      raise exception 'Responsable inválido para %.', v_area.label;
    end;
    select role into v_role from public.profiles
      where id = v_assignee and coalesce(employment_status, true) and deleted_at is null;
    if v_role is distinct from v_area.producer_role then
      raise exception 'Selecciona un operador activo para %.', v_area.label;
    end if;
  end loop;

  return public.semi_admin_route_order_to_production_v2_base(
    p_order_id, p_area_assignments, p_expected_updated_at
  );
end;
$$;

create or replace function public.semi_admin_can_manage_order_assets(p_order_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_admin, false)
     or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled', 'in_Delivered') then
    return false;
  end if;
  if v_order.status not in ('Pending', 'pending', 'in_Design', 'In_Design', 'in_Quote',
      'in_Production', 'in_Termination', 'in_Completed') then
    return false;
  end if;
  return v_order.created_by = v_actor
    or v_order.seller_id = v_actor
    or v_order.designer_id = v_actor
    or v_order.quote_id = v_actor
    or v_order.delivery_id = v_actor;
end;
$$;

revoke all on function public.semi_admin_can_manage_order_assets(uuid) from public, anon, authenticated;

-- Retain the established asset-edit implementation, but put the missing
-- administration-archive check in front of its direct SQL entry point.
alter function public.semi_admin_update_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text, boolean)
  rename to semi_admin_update_order_with_assets_pre_archive_guard;
revoke all on function public.semi_admin_update_order_with_assets_pre_archive_guard(uuid, timestamptz, jsonb, jsonb, text[], text, boolean)
  from public, anon, authenticated;

create function public.semi_admin_update_order_with_assets(
  p_order_id uuid,
  p_expected_updated_at timestamptz,
  p_changes jsonb,
  p_new_production_files jsonb default '[]'::jsonb,
  p_removed_file_urls text[] default '{}'::text[],
  p_asset_operation text default null,
  p_asset_removal_only boolean default false
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if found and coalesce(v_order.is_archived_admin, false) then
    raise exception 'La orden está archivada por Administración y no admite cambios de archivos.';
  end if;
  return public.semi_admin_update_order_with_assets_pre_archive_guard(
    p_order_id,
    p_expected_updated_at,
    p_changes,
    p_new_production_files,
    p_removed_file_urls,
    p_asset_operation,
    p_asset_removal_only
  );
end;
$$;

revoke all on function public.semi_admin_update_order_with_assets(uuid, timestamptz, jsonb, jsonb, text[], text, boolean)
  from public, anon, authenticated;

create or replace function public.semi_admin_assign_stage_responsibility(
  p_order_id uuid,
  p_stage text,
  p_assignee_id uuid,
  p_expected_updated_at timestamptz,
  p_production_area_code text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders;
  v_assignee_role text;
  v_previous uuid;
  v_area text := nullif(trim(p_production_area_code), '');
begin
  if p_stage = 'production' then
    raise exception 'Semi-Administración no puede asignar ni reasignar responsables de Producción.';
  end if;
  if p_stage is null or p_stage not in ('design', 'quote', 'delivery') then
    raise exception 'Etapa inválida.';
  end if;
  if p_expected_updated_at is null then raise exception 'ORDER_STALE'; end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'La orden no existe.'; end if;
  if v_order.updated_at is distinct from p_expected_updated_at then raise exception 'ORDER_STALE'; end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked'
     or v_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'La orden no está disponible para reasignación.';
  end if;
  select role into v_assignee_role from public.profiles
    where id = p_assignee_id and coalesce(employment_status, true) and deleted_at is null;
  if v_assignee_role is null then raise exception 'Selecciona un usuario activo.'; end if;

  if p_stage = 'design' then
    if v_order.status not in ('in_Design', 'In_Design') then raise exception 'La responsabilidad de Diseño solo se asigna durante Diseño.'; end if;
    if v_assignee_role not in ('designer', 'semi_admin') then raise exception 'Diseño requiere un Diseñador o Semi-Administrador.'; end if;
    if (
      (nullif(trim(coalesce(v_order.order_file_url, '')), '') is not null and trim(v_order.order_file_url) <> '[]')
      or nullif(trim(coalesce(v_order.preview_image, '')), '') is not null
      or exists (select 1 from public.order_files file where file.order_id = v_order.id and file.category in ('design', 'preview', 'reference') and file.status = 'uploaded' and file.deleted_at is null)
      or exists (select 1 from public.order_production_files file where file.order_id = v_order.id)
    ) then
      raise exception 'No se puede reasignar Diseño mientras la orden tenga archivos u Orden de Trabajo. Elimina todos los archivos antes de reasignar.';
    end if;
    v_previous := v_order.designer_id;
    update public.orders set designer_id = p_assignee_id, updated_by = v_actor, updated_at = now()
      where id = v_order.id returning * into v_order;
  elsif p_stage = 'quote' then
    if v_order.status <> 'in_Quote' then raise exception 'La responsabilidad de Caja solo se asigna durante Caja.'; end if;
    if v_assignee_role not in ('quote', 'semi_admin') then raise exception 'Caja requiere un usuario de Caja o Semi-Administrador.'; end if;
    v_previous := v_order.quote_id;
    update public.orders set quote_id = p_assignee_id, updated_by = v_actor, updated_at = now()
      where id = v_order.id returning * into v_order;
  else
    if v_order.status <> 'in_Completed' then raise exception 'La responsabilidad de Entrega solo se asigna cuando la orden está completada.'; end if;
    if v_assignee_role not in ('delivery', 'semi_admin') then raise exception 'Entrega requiere un Delivery o Semi-Administrador.'; end if;
    v_previous := v_order.delivery_id;
    update public.orders set delivery_id = p_assignee_id, updated_by = v_actor, updated_at = now()
      where id = v_order.id returning * into v_order;
  end if;

  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (
    v_order.id,
    v_actor,
    'semi_admin_stage_responsibility_changed',
    jsonb_build_object('stage', p_stage, 'production_area_code', v_area, 'previous_responsible_id', v_previous,
      'responsible_id', p_assignee_id, 'self_assigned', p_assignee_id = v_actor)
  );
  perform public.notify_many(
    array_remove(array[p_assignee_id], v_actor),
    'order_assigned',
    'Responsabilidad de etapa asignada',
    'Se te asignó la responsabilidad de ' || case p_stage
      when 'design' then 'Diseño' when 'quote' then 'Caja' else 'Entrega' end || '.',
    v_order.id,
    jsonb_build_object('event_kind', 'stage_responsibility_assigned', 'stage', p_stage,
      'production_area_code', v_area, 'assigned_by', v_actor)
  );
  return v_order;
end;
$$;

-- The helper remains callable only by SECURITY DEFINER command wrappers. Its
-- body also rejects Production so accidental future grants cannot bypass policy.
revoke all on function public.semi_admin_assign_stage_responsibility(uuid, text, uuid, timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.semi_admin_route_order_to_production_v2(uuid, jsonb, timestamptz)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
