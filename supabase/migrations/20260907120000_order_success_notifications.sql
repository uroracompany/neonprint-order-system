-- Canonical presentation metadata for successful order notifications.
-- This migration is intentionally local-only until an operator applies it.

create or replace function public.normalize_order_success_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_kind text := coalesce(new.metadata ->> 'event_kind', '');
  v_actor_id uuid := auth.uid();
  v_assignee_id uuid;
  v_assignee_name text;
  v_recipient_can_access_order boolean := false;
begin
  -- Notification metadata can be supplied by a client through the existing
  -- self-notification RPC. Never trust it to identify an actor or to authorize
  -- a lookup of an order's assignee.
  if v_actor_id is not null then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('actor_id', v_actor_id);
  end if;

  if new.order_id is not null and new.user_id is not null then
    select exists (
      select 1
      from public.orders o
      where o.id = new.order_id
        and (
          new.user_id in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
          or exists (
            select 1
            from public.profiles p
            where p.id = new.user_id
              and p.role = 'admin'
              and coalesce(p.employment_status, true)
              and p.deleted_at is null
          )
        )
    ) into v_recipient_can_access_order;
  end if;

  if v_event_kind = 'order_created' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'event_kind', 'order_created',
      'variant', 'success'
    );
    return new;
  end if;

  if v_event_kind = 'payment_updated'
    and coalesce(new.metadata ->> 'payment_status', '') = 'pagado' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'event_kind', 'payment_confirmed',
      'variant', 'payment_confirmed'
    );
    new.title := 'Pago confirmado';
    new.message := 'La orden fue marcada como pagada.';
    return new;
  end if;

  if v_event_kind in ('designer_assigned_confirmation', 'designer_assigned', 'design_routed_confirmation') then
    if not v_recipient_can_access_order then
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'success');
      return new;
    end if;

    select o.designer_id, p.name
    into v_assignee_id, v_assignee_name
    from public.orders o
    left join public.profiles p
      on p.id = o.designer_id
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
    where o.id = new.order_id;

    if v_event_kind = 'designer_assigned' and new.user_id is not distinct from v_actor_id then
      return null;
    end if;

    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'variant', 'success',
      'assignee_id', v_assignee_id,
      'assignee_name', v_assignee_name
    ));
    if v_event_kind in ('designer_assigned_confirmation', 'design_routed_confirmation')
      and new.user_id is not distinct from v_actor_id
      and v_assignee_id is distinct from v_actor_id then
      new.title := 'Orden enviada a Diseño correctamente';
      new.message := 'La orden fue enviada a Diseño exitosamente a ' || coalesce(v_assignee_name, 'la persona asignada') || '.';
    end if;
    return new;
  end if;

  if v_event_kind in ('quote_assignment_confirmation', 'quote_assigned', 'quote_routed_confirmation') then
    if not v_recipient_can_access_order then
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'success');
      return new;
    end if;

    select o.quote_id, p.name
    into v_assignee_id, v_assignee_name
    from public.orders o
    left join public.profiles p
      on p.id = o.quote_id
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
    where o.id = new.order_id;

    if v_event_kind = 'quote_assigned' and new.user_id is not distinct from v_actor_id then
      return null;
    end if;

    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'variant', 'success',
      'assignee_id', v_assignee_id,
      'assignee_name', v_assignee_name
    ));
    if v_event_kind in ('quote_assignment_confirmation', 'quote_routed_confirmation')
      and new.user_id is not distinct from v_actor_id
      and v_assignee_id is distinct from v_actor_id then
      new.title := 'Orden enviada a Caja correctamente';
      new.message := 'La orden fue enviada a Caja exitosamente a ' || coalesce(v_assignee_name, 'la persona asignada') || '.';
    end if;
    return new;
  end if;

  if v_event_kind in (
    'stage_assignment_confirmation',
    'stage_responsibility_assigned',
    'production_assigned',
    'production_reassigned',
    'production_file_sent_to_termination',
    'production_file_sent_to_termination_assigned',
    'semi_admin_confirmation'
  ) then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'success');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_normalize_order_success_notification on public.notifications;
create trigger trg_normalize_order_success_notification
  before insert on public.notifications
  for each row
  execute function public.normalize_order_success_notification();

revoke all on function public.normalize_order_success_notification() from public, anon, authenticated;

create or replace function public.notify_production_file_termination_success()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := coalesce(auth.uid(), new.updated_by);
  v_assignee_id uuid := new.assigned_to;
  v_assignee_name text;
  v_event_id text := 'termination:' || new.id::text || ':' || new.updated_at::text;
begin
  if old.status is not distinct from new.status
    or new.status <> 'in_termination'
    or coalesce(current_setting('app.order_purge_authorized', true), 'off') = 'on' then
    return new;
  end if;

  if v_assignee_id is not null then
    select p.name into v_assignee_name
    from public.profiles p
    where p.id = v_assignee_id and coalesce(p.employment_status, true) and p.deleted_at is null;
  end if;

  if v_actor_id is not null and exists (
    select 1 from public.profiles p
    where p.id = v_actor_id and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    perform public.notify_many(
      array[v_actor_id],
      'info',
      'Archivo enviado a Terminación correctamente',
      case
        when v_assignee_id is distinct from v_actor_id then
          'El archivo fue enviado a Terminación exitosamente a ' || coalesce(v_assignee_name, 'la persona asignada') || '.'
        else 'El archivo fue enviado a Terminación exitosamente.'
      end,
      new.order_id,
      jsonb_build_object(
        'event_kind', 'production_file_sent_to_termination',
        'variant', 'success',
        'event_id', v_event_id,
        'actor_id', v_actor_id,
        'assignee_id', v_assignee_id,
        'assignee_name', v_assignee_name,
        'file_id', new.id,
        'production_area_code', new.production_area_code
      )
    );
  end if;

  if v_assignee_id is distinct from v_actor_id and exists (
    select 1 from public.profiles p
    where p.id = v_assignee_id and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    perform public.notify_many(
      array[v_assignee_id],
      'info',
      'Archivo enviado a Terminación',
      'Se te envió un archivo a Terminación exitosamente.',
      new.order_id,
      jsonb_strip_nulls(jsonb_build_object(
        'event_kind', 'production_file_sent_to_termination_assigned',
        'variant', 'success',
        'event_id', v_event_id,
        'actor_id', v_actor_id,
        'assignee_id', v_assignee_id,
        'assignee_name', v_assignee_name,
        'file_id', new.id,
        'production_area_code', new.production_area_code
      ))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_production_file_termination_success on public.order_production_files;
create trigger trg_notify_production_file_termination_success
  after update of status on public.order_production_files
  for each row
  execute function public.notify_production_file_termination_success();

revoke all on function public.notify_production_file_termination_success() from public, anon, authenticated;

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
  v_assignee_id uuid;
  v_assignee_name text;
  v_stage_label text;
  v_event_kind text;
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
      select 1 from public.profiles profile
      where profile.id = new.actor_id
        and profile.role = 'semi_admin'
        and coalesce(profile.employment_status, true)
        and profile.deleted_at is null
    ) then
    return new;
  end if;

  case new.event_type
    when 'semi_admin_order_created' then
      v_title := 'Orden creada correctamente';
      v_message := 'La orden fue creada correctamente y quedó lista para continuar el flujo.';
      v_event_kind := 'order_created';
    when 'semi_admin_send_to_designer' then
      select designer_id into v_assignee_id from public.orders where id = new.order_id;
      v_title := 'Orden enviada a Diseño correctamente';
      v_event_kind := 'design_routed_confirmation';
    when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then
      select quote_id into v_assignee_id from public.orders where id = new.order_id;
      v_title := 'Orden enviada a Caja correctamente';
      v_event_kind := 'quote_routed_confirmation';
    when 'semi_admin_production_routed' then
      v_title := 'Orden enviada a Producción correctamente';
      v_message := 'Las asignaciones por área fueron registradas correctamente.';
      v_event_kind := 'production_assigned';
    when 'semi_admin_stage_responsibility_changed' then
      v_assignee_id := nullif(new.changes ->> 'responsible_id', '')::uuid;
      v_stage_label := case new.changes ->> 'stage'
        when 'design' then 'Diseño'
        when 'quote' then 'Caja'
        when 'delivery' then 'Entrega'
        else 'la etapa'
      end;
      v_title := 'Responsable actualizado correctamente';
      v_event_kind := 'stage_assignment_confirmation';
    else
      return new;
  end case;

  if v_assignee_id is not null then
    select p.name into v_assignee_name
    from public.profiles p
    where p.id = v_assignee_id and coalesce(p.employment_status, true) and p.deleted_at is null;
  end if;

  if v_message is null then
    if v_assignee_id is distinct from new.actor_id then
      v_message := case new.event_type
        when 'semi_admin_send_to_designer' then 'La orden fue enviada a Diseño exitosamente a ' || coalesce(v_assignee_name, 'la persona asignada') || '.'
        when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then 'La orden fue enviada a Caja exitosamente a ' || coalesce(v_assignee_name, 'la persona asignada') || '.'
        else 'Responsable de ' || coalesce(v_stage_label, 'la etapa') || ' asignado a ' || coalesce(v_assignee_name, 'la persona asignada') || '.'
      end;
    else
      v_message := case new.event_type
        when 'semi_admin_send_to_designer' then 'La orden fue enviada a Diseño correctamente.'
        when 'semi_admin_send_to_quote', 'semi_admin_send_design_to_quote' then 'La orden fue enviada a Caja correctamente.'
        else 'Ahora eres el responsable de ' || coalesce(v_stage_label, 'esta etapa') || '.'
      end;
    end if;
  end if;

  insert into public.notifications(user_id, type, title, message, order_id, metadata)
  values (
    new.actor_id,
    'info',
    v_title,
    v_message,
    new.order_id,
    jsonb_strip_nulls(jsonb_build_object(
      'event_type', new.event_type,
      'actor_id', new.actor_id,
      'event_kind', v_event_kind,
      'variant', 'success',
      'assignee_id', v_assignee_id,
      'assignee_name', v_assignee_name
    ))
  );
  return new;
end;
$$;

revoke all on function public.notify_semi_admin_order_event() from public, anon, authenticated;
notify pgrst, 'reload schema';
