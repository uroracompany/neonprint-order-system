-- Keep generic Sales creation and assignment notices, but do not send their
-- actor-facing confirmation to the acting Semi-Admin: that actor receives the
-- dedicated audited confirmation emitted from the Semi-Admin event trigger.
create or replace function public.notify_many(
  p_recipients uuid[],
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  nid uuid;
  event_kind text := coalesce(p_metadata->>'event_kind', '');
  event_id text := coalesce(p_metadata->>'event_id', '');
  caller_id uuid := auth.uid();
  suppress_semi_admin_creation_notice boolean := false;
begin
  if p_type in ('new_order', 'order_assigned')
    and event_kind in ('order_created', 'designer_assigned_confirmation', 'quote_assignment_confirmation')
    and caller_id is not null then
    select exists (
      select 1
      from public.profiles profile
      where profile.id = caller_id
        and profile.role = 'semi_admin'
        and coalesce(profile.employment_status, true)
        and profile.deleted_at is null
    ) into suppress_semi_admin_creation_notice;
  end if;

  foreach recipient in array coalesce(p_recipients, array[]::uuid[]) loop
    if recipient is not null
      and not (suppress_semi_admin_creation_notice and recipient = caller_id) then
      select id into nid
      from public.notifications
      where user_id = recipient
        and type = p_type
        and order_id is not distinct from p_order_id
        and title = p_title
        and message = p_message
        and coalesce(metadata->>'event_kind', '') = event_kind
        and coalesce(metadata->>'event_id', '') = event_id
        and (deleted_at is not null or coalesce(is_archived, false) = true)
      order by created_at desc
      limit 1;

      if nid is null then
        select id into nid
        from public.notifications
        where user_id = recipient
          and type = p_type
          and order_id is not distinct from p_order_id
          and title = p_title
          and message = p_message
          and coalesce(metadata->>'event_kind', '') = event_kind
          and coalesce(metadata->>'event_id', '') = event_id
          and deleted_at is null
          and coalesce(is_archived, false) = false
          and created_at > now() - interval '10 minutes'
        order by created_at desc
        limit 1;
      end if;

      if nid is null then
        insert into public.notifications (user_id, type, title, message, order_id, metadata)
        values (recipient, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb));
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb)
  from public, anon, authenticated;

-- This private validator is the shared authority for the required files at
-- the Design -> Caja boundary. It verifies stored records, not browser values.
create or replace function public.assert_order_ready_for_quote(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_file_urls jsonb;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'La orden no existe.';
  end if;

  if nullif(trim(coalesce(v_order.preview_image, '')), '') is null
    or not exists (
      select 1
      from public.order_files file
      where file.order_id = p_order_id
        and file.category = 'preview'
        and file.status = 'uploaded'
        and file.deleted_at is null
        and file.bucket = 'order-previews'
        and file.object_key like ('orders/' || p_order_id::text || '/preview/%')
        and (
          ('r2://' || file.bucket || '/' || file.object_key) = v_order.preview_image
          or ('supabase://' || file.bucket || '/' || file.object_key) = v_order.preview_image
          or (
            file.provider = 'supabase'
            and file.object_key = regexp_replace(
              v_order.preview_image,
              '^https?://[^/]+/storage/v1/object/(?:public|sign)/order-previews/([^?]+).*$',
              '\1'
            )
          )
        )
    ) then
    raise exception 'Falta una orden de trabajo válida. Adjuntala antes de enviar a Caja.';
  end if;

  begin
    v_file_urls := case
      when nullif(trim(coalesce(v_order.order_file_url, '')), '') is null then '[]'::jsonb
      when left(trim(v_order.order_file_url), 1) = '[' then v_order.order_file_url::jsonb
      else jsonb_build_array(v_order.order_file_url)
    end;
  exception when others then
    raise exception 'Los archivos de diseño no son válidos.';
  end;

  if jsonb_typeof(v_file_urls) <> 'array'
    or not exists (
      select 1
      from jsonb_array_elements_text(v_file_urls) item(value)
      join public.order_production_files production_file
        on production_file.order_id = p_order_id
       and production_file.url = item.value
      join public.order_files file
        on file.order_id = p_order_id
       and file.category = 'design'
       and file.status = 'uploaded'
       and file.deleted_at is null
       and (
         file.id = production_file.order_file_id
         or ('r2://' || file.bucket || '/' || file.object_key) = production_file.url
         or ('supabase://' || file.bucket || '/' || file.object_key) = production_file.url
       )
    ) then
    raise exception 'Falta un archivo de diseño válido. Adjuntalo antes de enviar a Caja.';
  end if;

  if exists (
    select 1
    from public.order_production_files production_file
    where production_file.order_id = p_order_id
      and (
        nullif(trim(coalesce(production_file.public_label, '')), '') is null
        or nullif(trim(coalesce(production_file.production_area_code, '')), '') is null
        or not exists (
          select 1
          from unnest(coalesce(production_file.material_names, '{}'::text[])) material(name)
          where nullif(trim(material.name), '') is not null
        )
        or nullif(trim(coalesce(production_file.termination_name, '')), '') is null
      )
  ) then
    raise exception 'Cada archivo debe tener nombre visible, área, materiales y terminación antes de enviar a Caja.';
  end if;
end;
$$;

revoke all on function public.assert_order_ready_for_quote(uuid)
  from public, anon, authenticated;

create or replace function public.designer_send_order_to_quote(
  p_order_id uuid,
  p_quote_id uuid
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles profile
    where profile.id = v_actor
      and profile.role = 'designer'
      and coalesce(profile.employment_status, true)
      and profile.deleted_at is null
  ) then
    raise exception 'Solo Diseño activo puede enviar a Caja.';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found
    or v_order.designer_id is distinct from v_actor
    or v_order.status <> 'in_Design'
    or coalesce(v_order.is_archived, false)
    or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no está disponible en Diseño.';
  end if;
  if not exists (
    select 1
    from public.profiles profile
    where profile.id = p_quote_id
      and profile.role = 'quote'
      and coalesce(profile.employment_status, true)
      and profile.deleted_at is null
  ) then
    raise exception 'Caja no disponible.';
  end if;

  perform public.assert_order_ready_for_quote(p_order_id);
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Quote',
      quote_id = p_quote_id,
      return_reason = null,
      returned_to_designer_at = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;
  return v_updated;
end;
$$;

revoke all on function public.designer_send_order_to_quote(uuid, uuid) from public, anon;
grant execute on function public.designer_send_order_to_quote(uuid, uuid) to authenticated;

create or replace function public.semi_admin_send_design_to_quote(
  p_order_id uuid,
  p_quote_id uuid,
  p_expected_updated_at timestamptz
) returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := public.require_active_semi_admin_actor();
  v_order public.orders%rowtype;
  v_new public.orders%rowtype;
  v_role text;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.updated_at is distinct from p_expected_updated_at then
    raise exception 'ORDER_STALE';
  end if;
  if coalesce(v_order.is_archived, false) or v_order.operational_status = 'blocked' then
    raise exception 'La orden está archivada o bloqueada.';
  end if;
  if not public.semi_admin_can_operate_stage(p_order_id, 'design', null) then
    raise exception 'Asígnate como responsable de Diseño antes de avanzar la orden.';
  end if;

  select role into v_role
  from public.profiles
  where id = p_quote_id
    and coalesce(employment_status, true)
    and deleted_at is null;
  if v_role not in ('quote', 'semi_admin') then
    raise exception 'Selecciona un responsable activo de Caja.';
  end if;

  perform public.assert_order_ready_for_quote(p_order_id);
  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Quote',
      quote_id = p_quote_id,
      return_reason = null,
      returned_to_designer_at = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_new;
  insert into public.order_events(order_id, actor_id, event_type, old_status, new_status, changes)
  values (
    p_order_id,
    v_actor,
    'semi_admin_send_design_to_quote',
    v_order.status,
    v_new.status,
    jsonb_build_object('quote_id', p_quote_id, 'asset_validation', 'passed')
  );
  return v_new;
end;
$$;

revoke all on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function public.semi_admin_send_design_to_quote(uuid, uuid, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
