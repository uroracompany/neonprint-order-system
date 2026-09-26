-- Semi-Administrador confirmations are actor-facing. Keep one precise success
-- notification for creation and Sales -> Diseño, and avoid an interruption for
-- asset-only saves from the nested asset editor.
create or replace function public.notify_semi_admin_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_only_update boolean := false;
begin
  if new.event_type = 'semi_admin_order_updated' then
    select not exists (
      select 1
      from jsonb_object_keys(coalesce(new.changes -> 'changes', '{}'::jsonb)) as key(name)
      where key.name not in ('order_file_url', 'preview_image', 'reference_images')
    ) into v_asset_only_update;
  end if;

  if new.actor_id is not null
    and new.event_type like 'semi_admin_%'
    and not v_asset_only_update
    and exists (
      select 1 from public.profiles profile
      where profile.id = new.actor_id and profile.role = 'semi_admin'
    ) then
    insert into public.notifications(user_id, type, title, message, order_id, metadata)
    values (
      new.actor_id,
      case new.event_type
        when 'semi_admin_order_created' then 'success'
        when 'semi_admin_send_to_designer' then 'success'
        else 'info'
      end,
      case new.event_type
        when 'semi_admin_order_created' then 'Orden creada correctamente'
        when 'semi_admin_send_to_designer' then 'Orden asignada a Diseño correctamente'
        else 'Acción confirmada'
      end,
      case new.event_type
        when 'semi_admin_order_created' then 'La orden fue creada y quedó lista para continuar el flujo.'
        when 'semi_admin_send_to_designer' then 'La orden fue asignada a Diseño correctamente.'
        else 'Tu acción operativa fue registrada en la orden.'
      end,
      new.order_id,
      jsonb_build_object('event_type', new.event_type, 'actor_id', new.actor_id)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.notify_semi_admin_order_event() from public, anon, authenticated;
notify pgrst, 'reload schema';
