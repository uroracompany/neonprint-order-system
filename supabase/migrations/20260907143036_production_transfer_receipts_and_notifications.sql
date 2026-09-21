-- Persistent recipient-only acknowledgement for production file transfers.
-- This migration extends the existing local notification and transfer contracts.

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

  if v_event_kind = 'production_assignment_confirmation' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('variant', 'success');
    new.title := 'Orden enviada a Producción';
    new.message := 'Orden enviada a producción exitosamente';
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

revoke all on function public.normalize_order_success_notification() from public, anon, authenticated;

create or replace function public.get_pending_production_file_transfer_receipts()
returns table (
  receipt_id uuid,
  order_id uuid,
  assigned_at timestamptz,
  event_id uuid,
  transferred_at timestamptz,
  sender_id uuid,
  sender_name text,
  production_area_code text,
  production_area_label text,
  files jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.production_areas area
      on area.producer_role = profile.role
     and area.is_active = true
    where profile.id = v_user_id
      and profile.deleted_at is null
      and coalesce(profile.employment_status, true) = true
  ) then
    raise exception 'No tienes acceso a los traspasos de Producción.';
  end if;

  return query
  select
    receipt.id,
    receipt.order_id,
    receipt.assigned_at,
    event.id,
    event.created_at,
    event.actor_id,
    coalesce(nullif(btrim(sender.name), ''), 'Operador de producción')::text,
    event.changes ->> 'production_area_code',
    event.changes ->> 'production_area_label',
    coalesce(event.changes -> 'files', '[]'::jsonb)
  from public.order_assignment_receipts receipt
  join public.order_events event
    on event.id = receipt.source_assignment_id
   and event.order_id = receipt.order_id
   and event.event_type = 'production_files_transferred'
  left join public.profiles sender on sender.id = event.actor_id
  where receipt.user_id = v_user_id
    and receipt.assignment_module = 'production'
    and receipt.assignment_source = 'production_file_transfer'
    and receipt.seen_at is null
    and (
      not (event.changes ? 'recipient_id')
      or event.changes ->> 'recipient_id' = v_user_id::text
    )
  order by receipt.assigned_at asc;
end;
$$;

create or replace function public.acknowledge_production_file_transfer_receipts(
  p_order_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_seen_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.profiles profile
    join public.production_areas area
      on area.producer_role = profile.role
     and area.is_active = true
    where profile.id = v_user_id
      and profile.deleted_at is null
      and coalesce(profile.employment_status, true) = true
  ) then
    raise exception 'No tienes acceso a los traspasos de Producción.';
  end if;

  if p_order_id is null then
    raise exception 'Order is required';
  end if;

  with seen as (
    update public.order_assignment_receipts
       set seen_at = now(),
           seen_by = v_user_id
     where order_id = p_order_id
       and user_id = v_user_id
       and assignment_module = 'production'
       and assignment_source = 'production_file_transfer'
       and seen_at is null
     returning id
  )
  select count(*)::integer into v_seen_count from seen;

  return v_seen_count;
end;
$$;

revoke all on function public.get_pending_production_file_transfer_receipts() from public, anon;
revoke all on function public.acknowledge_production_file_transfer_receipts(uuid) from public, anon;
grant execute on function public.get_pending_production_file_transfer_receipts() to authenticated;
grant execute on function public.acknowledge_production_file_transfer_receipts(uuid) to authenticated;

notify pgrst, 'reload schema';
