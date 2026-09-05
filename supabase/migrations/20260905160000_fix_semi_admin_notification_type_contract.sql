-- `notifications.type` is a domain category, not a presentation severity.
-- Keep Semi-Admin confirmations in the existing valid `info` category and
-- preserve their green UI treatment through `metadata.variant`.
create or replace function public.notify_semi_admin_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_only_update boolean := false;
  v_title text;
  v_message text;
  v_assignee_name text;
  v_stage_label text;
begin
  if new.event_type = 'semi_admin_order_updated' then
    select not exists (
      select 1
      from jsonb_object_keys(coalesce(new.changes -> 'changes', '{}'::jsonb)) as key(name)
      where key.name not in ('order_file_url', 'preview_image', 'reference_images')
    ) into v_asset_only_update;
  end if;

  if new.actor_id is null
    or new.event_type not like 'semi_admin_%'
    or v_asset_only_update
    or not exists (
      select 1
      from public.profiles profile
      where profile.id = new.actor_id and profile.role = 'semi_admin'
    ) then
    return new;
  end if;

  case new.event_type
    when 'semi_admin_order_created' then
      v_title := 'Orden creada correctamente';
      v_message := 'La orden fue creada y quedó lista para continuar el flujo.';
    when 'semi_admin_send_to_designer' then
      v_title := 'Orden enviada a Diseño correctamente';
      v_message := 'La orden fue asignada a Diseño correctamente.';
    when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then
      v_title := 'Orden enviada a Caja correctamente';
      v_message := 'La orden fue asignada a Caja correctamente.';
    when 'semi_admin_production_routed' then
      v_title := 'Orden enviada a Producción correctamente';
      v_message := 'Las asignaciones por área fueron registradas correctamente.';
    when 'semi_admin_stage_responsibility_changed' then
      if coalesce((new.changes->>'self_assigned')::boolean, false) then
        v_title := 'Orden asignada a mí correctamente';
        v_message := 'Ahora eres el responsable de esta etapa.';
      else
        select name into v_assignee_name
        from public.profiles
        where id = nullif(new.changes->>'responsible_id', '')::uuid;
        v_stage_label := case new.changes->>'stage'
          when 'design' then 'Diseño'
          when 'quote' then 'Caja'
          when 'delivery' then 'Entrega'
          else 'la etapa'
        end;
        v_title := 'Responsable actualizado correctamente';
        v_message := 'Responsable de ' || v_stage_label || ' asignado a ' || coalesce(v_assignee_name, 'usuario seleccionado') || '.';
      end if;
    else
      return new;
  end case;

  insert into public.notifications(user_id, type, title, message, order_id, metadata)
  values (
    new.actor_id,
    'info',
    v_title,
    v_message,
    new.order_id,
    jsonb_build_object(
      'event_type', new.event_type,
      'actor_id', new.actor_id,
      'event_kind', 'semi_admin_confirmation',
      'variant', 'success'
    )
  );
  return new;
end;
$$;

revoke all on function public.notify_semi_admin_order_event() from public, anon, authenticated;
notify pgrst, 'reload schema';
