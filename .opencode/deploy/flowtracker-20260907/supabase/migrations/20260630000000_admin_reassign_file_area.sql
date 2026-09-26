-- Admin RPC to reassign a production file to a different production area
-- Validates that if the file has an assigned user, a new user from the target area must be selected
-- Sends specific notifications to the old and new assignee

create or replace function public.admin_reassign_file_production_area(
  p_file_id uuid,
  p_new_area_code text,
  p_new_assigned_user_id uuid,
  p_expected_updated_at timestamptz
)
returns public.order_production_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_file public.order_production_files;
  v_order public.orders;
  v_old_user_id uuid;
  v_old_user_name text;
  v_new_user_name text;
  v_area_label text;
  v_file_label text;
  v_order_number text;
begin
  if v_actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = v_actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede realizar esta accion.';
  end if;

  if not exists (
    select 1 from public.production_areas
    where code = p_new_area_code and is_active = true
  ) then
    raise exception 'El area de produccion seleccionada no es valida o no esta activa.';
  end if;

  select * into v_file
  from public.order_production_files
  where id = p_file_id
  for update;
  if not found then
    raise exception 'El archivo de produccion no existe.';
  end if;

  if p_expected_updated_at is null or v_file.updated_at is distinct from p_expected_updated_at then
    raise exception 'El archivo cambio mientras lo editabas. Actualiza los datos e intenta nuevamente.';
  end if;

  select * into v_order from public.orders where id = v_file.order_id;
  if v_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se puede modificar archivos de una orden cancelada o entregada.';
  end if;

  if v_file.production_area_code = p_new_area_code then
    raise exception 'El archivo ya pertenece a esa area de produccion.';
  end if;

  v_old_user_id := v_file.assigned_to;
  v_file_label := coalesce(v_file.public_label, v_file.filename, 'Archivo');
  v_order_number := coalesce(v_order.order_code::text, left(v_order.id::text, 8));

  select label into v_area_label from public.production_areas where code = p_new_area_code;

  if v_old_user_id is not null then
    if p_new_assigned_user_id is null then
      raise exception 'El archivo tiene un responsable asignado. Debes seleccionar un nuevo responsable del area %.',
        coalesce(v_area_label, p_new_area_code);
    end if;
  end if;

  if p_new_assigned_user_id is not null then
    if not exists (
      select 1 from public.profiles p
      join public.production_areas pa on pa.producer_role = p.role
      where p.id = p_new_assigned_user_id
        and pa.code = p_new_area_code
        and coalesce(p.employment_status, true) = true
    ) then
      raise exception 'El usuario seleccionado no pertenece al area %.',
        coalesce(v_area_label, p_new_area_code);
    end if;
  end if;

  update public.order_production_files
  set production_area_code = p_new_area_code,
      assigned_to = coalesce(p_new_assigned_user_id, v_file.assigned_to),
      updated_by = v_actor_id,
      updated_at = now()
  where id = p_file_id
  returning * into v_file;

  if v_old_user_id is not null and v_old_user_id is distinct from p_new_assigned_user_id then
    select name into v_old_user_name from public.profiles where id = v_old_user_id;
    perform public.create_notification(
      v_old_user_id,
      'order_updated',
      'Archivo reasignado',
      'El administrador ha reasignado el archivo ' || v_file_label || ' de la orden #' || v_order_number || '. Ya no eres el responsable de este archivo.',
      v_order.id,
      jsonb_build_object(
        'event_kind', 'file_reassignment',
        'file_id', p_file_id,
        'file_label', v_file_label,
        'order_number', v_order_number,
        'actor_id', v_actor_id,
        'new_area', p_new_area_code
      )
    );
  end if;

  if p_new_assigned_user_id is not null then
    select name into v_new_user_name from public.profiles where id = p_new_assigned_user_id;
    perform public.create_notification(
      p_new_assigned_user_id,
      'order_updated',
      'Nuevo archivo asignado',
      'El administrador te ha asignado el archivo ' || v_file_label || ' de la orden #' || v_order_number || ' para su procesamiento.',
      v_order.id,
      jsonb_build_object(
        'event_kind', 'file_assigned',
        'file_id', p_file_id,
        'file_label', v_file_label,
        'order_number', v_order_number,
        'actor_id', v_actor_id,
        'area', p_new_area_code
      )
    );
  end if;

  return v_file;
end;
$$;

revoke all on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.admin_reassign_file_production_area(uuid, text, uuid, timestamptz) to authenticated;

-- Admin RPC to force any valid file status (skips transition validation)
-- Allows admin to set a production file to any of the 4 valid statuses
create or replace function public.admin_force_file_status(
  p_file_id uuid,
  p_new_status text,
  p_reason_category text,
  p_reason_detail text,
  p_expected_updated_at timestamptz,
  p_delivery_id uuid default null
)
returns public.order_production_files
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  file_row public.order_production_files;
  old_file_status text;
  old_order public.orders;
  new_order public.orders;
  other_incomplete integer;
  action_key text := 'production_file_status';
  started_at timestamptz := clock_timestamp();
  changed_fields jsonb;
begin
  if actor_id is null or not exists (
    select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin'
      and coalesce(p.employment_status, true) = true
  ) then
    raise exception 'Solo un administrador activo puede cambiar archivos de Produccion.';
  end if;
  if public.admin_intervention_reason_label(p_reason_category) is null then
    raise exception 'Selecciona una categoria de motivo valida.';
  end if;
  if char_length(trim(coalesce(p_reason_detail, ''))) not between 10 and 500 then
    raise exception 'El detalle del motivo debe tener entre 10 y 500 caracteres.';
  end if;

  select * into file_row
  from public.order_production_files
  where id = p_file_id
  for update;
  if not found then raise exception 'El archivo no existe.'; end if;
  old_file_status := file_row.status;
  if p_expected_updated_at is null or file_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'El archivo cambio mientras lo editabas. Actualiza e intenta nuevamente.';
  end if;

  if p_new_status not in ('pending', 'in_production', 'in_termination', 'completed') then
    raise exception 'El estado seleccionado no es valido.';
  end if;

  if p_new_status = old_file_status then
    raise exception 'El archivo ya se encuentra en el estado seleccionado.';
  end if;

  select * into old_order from public.orders where id = file_row.order_id for update;
  if old_order.status in ('cancelled', 'in_Delivered') then
    raise exception 'No se pueden modificar archivos de una orden terminal.';
  end if;

  perform set_config('app.admin_intervention_context', 'production_file_status', true);

  if old_file_status = 'completed' and p_new_status in ('pending', 'in_production', 'in_termination') then
    action_key := 'production_file_reopened';
  end if;

  if p_new_status = 'completed' then
    select count(*) into other_incomplete
    from public.order_production_files
    where order_id = file_row.order_id and id <> file_row.id and status <> 'completed';
    if other_incomplete = 0 then
      if not exists (
        select 1 from public.profiles p
        where p.id = p_delivery_id and p.role = 'delivery'
          and coalesce(p.employment_status, true) = true
      ) then
        raise exception 'Selecciona un usuario Delivery activo para completar el ultimo archivo.';
      end if;
      update public.orders set delivery_id = p_delivery_id where id = old_order.id;
    end if;
  end if;

  update public.order_production_files
  set status = p_new_status, updated_by = actor_id, updated_at = now()
  where id = p_file_id
  returning * into file_row;

  perform public.recalculate_order_production_status(file_row.order_id);
  update public.orders
  set last_admin_intervention_at = now(),
      last_admin_intervention_by = actor_id,
      last_admin_intervention_kind = action_key,
      updated_at = now()
  where id = file_row.order_id
  returning * into new_order;

  changed_fields := jsonb_build_array(jsonb_build_object(
    'field', 'production_file_status',
    'label', coalesce(file_row.public_label, 'Archivo de Produccion'),
    'old_value', case old_file_status
      when 'pending' then 'Pendiente'
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'new_value', case p_new_status
      when 'pending' then 'Pendiente'
      when 'in_production' then 'En produccion'
      when 'in_termination' then 'En terminacion'
      when 'completed' then 'Completado'
    end,
    'area', file_row.production_area_code
  ));

  perform public.record_admin_intervention(
    old_order, new_order, action_key, p_reason_category,
    trim(p_reason_detail), started_at, changed_fields
  );
  return file_row;
end;
$$;

revoke all on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) from public, anon;
grant execute on function public.admin_force_file_status(uuid, text, text, text, timestamptz, uuid) to authenticated;
