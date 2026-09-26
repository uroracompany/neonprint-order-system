-- Unify durable admin-edit reviews across every order module.
-- Notification rows remain ephemeral; order_event_reviews are the source of truth
-- for pending badges and explicit acknowledgement.

create or replace function public.create_order_event_reviews(
  p_order_event_id uuid,
  p_order_id uuid,
  p_user_ids uuid[],
  p_label text,
  p_source_module text,
  p_event_key text,
  p_changed_fields jsonb default '[]'::jsonb,
  p_summary text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  with recipients as (
    select distinct recipient_id as user_id
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as recipient_id
    where recipient_id is not null
  )
  insert into public.order_event_reviews as review (
    order_event_id,
    order_id,
    user_id,
    label,
    source_module,
    event_key,
    changed_fields,
    summary,
    metadata
  )
  select
    p_order_event_id,
    p_order_id,
    recipients.user_id,
    p_label,
    p_source_module,
    p_event_key,
    coalesce(p_changed_fields, '[]'::jsonb),
    p_summary,
    coalesce(p_metadata, '{}'::jsonb)
  from recipients
  on conflict (order_event_id, user_id) do update
    set label = excluded.label,
        changed_fields = coalesce(review.changed_fields, '[]'::jsonb)
          || coalesce(excluded.changed_fields, '[]'::jsonb),
        summary = excluded.summary,
        metadata = coalesce(review.metadata, '{}'::jsonb)
          || coalesce(excluded.metadata, '{}'::jsonb);

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

revoke all on function public.create_order_event_reviews(uuid, uuid, uuid[], text, text, text, jsonb, text, jsonb) from public;
revoke all on function public.create_order_event_reviews(uuid, uuid, uuid[], text, text, text, jsonb, text, jsonb) from anon;
revoke all on function public.create_order_event_reviews(uuid, uuid, uuid[], text, text, text, jsonb, text, jsonb) from authenticated;

create or replace function public.mark_order_events_reviewed(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  reviewed_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  with reviewed as (
    update public.order_event_reviews
       set reviewed_at = now(),
           reviewed_by = current_user_id
     where order_id = p_order_id
       and user_id = current_user_id
       and reviewed_at is null
     returning id
  )
  select count(*)::integer into reviewed_count from reviewed;

  update public.notifications
     set is_read = true,
         read_at = coalesce(read_at, now())
   where user_id = current_user_id
     and order_id = p_order_id
     and is_read = false
     and metadata->>'event_kind' in (
       'admin_order_edit_area_notice',
       'admin_edited_order',
       'design_files_changed',
       'production_files_changed',
       'production_assignment_changed',
       'delivery_changed',
       'payment_updated'
     );

  return reviewed_count;
end;
$$;

revoke all on function public.mark_order_events_reviewed(uuid) from public;
revoke all on function public.mark_order_events_reviewed(uuid) from anon;
grant execute on function public.mark_order_events_reviewed(uuid) to authenticated;

create or replace function public.notify_admin_order_edit_area_alerts(
  old_row public.orders,
  new_row public.orders,
  p_order_event_id uuid,
  p_actor_id uuid,
  p_actor_role text,
  p_changed_fields jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  change_item jsonb;
  review_change jsonb;
  field_name text;
  field_label text;
  area_name text;
  old_value text;
  new_value text;
  recipients uuid[];
  order_label text := coalesce(new_row.order_code::text, left(new_row.id::text, 8));
  notice_message text;
begin
  if jsonb_typeof(coalesce(p_changed_fields, '[]'::jsonb)) <> 'array' then
    return;
  end if;

  for change_item in
    select value from jsonb_array_elements(p_changed_fields)
  loop
    field_name := change_item->>'field';
    field_label := change_item->>'label';
    area_name := public.admin_order_edit_area_for_field(field_name, new_row.status);
    recipients := public.admin_order_edit_notice_recipients(area_name, new_row, p_actor_id);

    -- Caja/Cotizador is the assigned quote user. Client changes join the
    -- existing payment flow without broadcasting to the entire role.
    if field_name = 'client' then
      select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
        into recipients
      from unnest(
        coalesce(recipients, array[]::uuid[])
        || public.order_cashier_quote_recipients(new_row)
      ) as recipient_id
      where recipient_id is not null
        and recipient_id is distinct from p_actor_id;
    end if;

    if coalesce(array_length(recipients, 1), 0) = 0 then
      continue;
    end if;

    old_value := public.admin_order_edit_value(old_row, field_name);
    new_value := public.admin_order_edit_value(new_row, field_name);
    review_change := change_item || jsonb_build_object(
      'old_value', old_value,
      'new_value', new_value,
      'area', area_name
    );

    perform public.create_order_event_reviews(
      p_order_event_id,
      new_row.id,
      recipients,
      'Editada por Admin',
      'admin',
      'admin_edited_order',
      jsonb_build_array(review_change),
      'La orden fue modificada por administracion.',
      jsonb_build_object(
        'actor_id', p_actor_id,
        'actor_role', p_actor_role,
        'changed_at', now()
      )
    );

    notice_message := public.admin_order_edit_notice_message(
      order_label,
      field_label,
      field_name,
      old_value,
      new_value
    );

    perform public.notify_many(
      recipients,
      'order_updated',
      case
        when field_name = 'payment' then 'Pago editado por admin'
        when field_name in ('files', 'order_file_url', 'preview_image', 'reference_images') then 'Archivos editados por admin'
        else 'Aviso de orden editada'
      end,
      notice_message,
      new_row.id,
      jsonb_build_object(
        'event_kind', 'admin_order_edit_area_notice',
        'event_id', p_order_event_id,
        'source_module', 'admin',
        'actor_id', p_actor_id,
        'actor_role', p_actor_role,
        'area', area_name,
        'order_id', new_row.id,
        'order_code', order_label,
        'field', field_name,
        'label', field_label,
        'old_value', old_value,
        'new_value', new_value,
        'changed_at', now(),
        'deep_link', '/dashboard?order=' || new_row.id::text,
        'changed_fields', jsonb_build_array(review_change)
      )
    );
  end loop;
end;
$$;

create or replace function public.handle_admin_order_edit_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_profile_role();
  changed_fields jsonb := public.order_business_changed_fields(old, new);
  event_id uuid;
  source_module text := public.order_event_source_module(actor_role);
begin
  if tg_op <> 'UPDATE' or coalesce(actor_role, '') <> 'admin' then
    return new;
  end if;

  if jsonb_array_length(changed_fields) = 0 then
    return new;
  end if;

  insert into public.order_events (
    order_id,
    actor_id,
    event_type,
    old_status,
    new_status,
    old_payment_status,
    new_payment_status,
    changes
  )
  values (
    new.id,
    actor_id,
    'admin_edited_order',
    old.status,
    new.status,
    old.payment_status,
    new.payment_status,
    jsonb_build_object(
      'source_module', source_module,
      'changed_fields', changed_fields,
      'old', to_jsonb(old),
      'new', to_jsonb(new)
    )
  )
  returning id into event_id;

  perform public.notify_admin_order_edit_area_alerts(
    old,
    new,
    event_id,
    actor_id,
    actor_role,
    changed_fields
  );

  return new;
end;
$$;

-- Convert existing area notices into durable reviews for modules that previously
-- derived their badges directly from notifications. Soft-deleted and archived
-- notices are included because dismissing a notification must not acknowledge it.
with historical_notices as (
  select
    (notification.metadata->>'event_id')::uuid as order_event_id,
    notification.order_id,
    notification.user_id,
    min(notification.created_at) as created_at,
    jsonb_agg(change_item) as changed_fields,
    (array_agg(notification.metadata->>'actor_id'))[1] as actor_id,
    (array_agg(notification.metadata->>'actor_role'))[1] as actor_role
  from public.notifications as notification
  cross join lateral jsonb_array_elements(
    coalesce(notification.metadata->'changed_fields', '[]'::jsonb)
  ) as change_item
  where notification.metadata->>'event_kind' = 'admin_order_edit_area_notice'
    and notification.order_id is not null
    and notification.user_id is not null
    and coalesce(notification.metadata->>'event_id', '')
      ~ '^[0-9a-fA-F-]{36}$'
  group by
    (notification.metadata->>'event_id')::uuid,
    notification.order_id,
    notification.user_id
)
insert into public.order_event_reviews (
  order_event_id,
  order_id,
  user_id,
  label,
  source_module,
  event_key,
  changed_fields,
  summary,
  metadata,
  created_at
)
select
  historical.order_event_id,
  historical.order_id,
  historical.user_id,
  'Editada por Admin',
  'admin',
  'admin_edited_order',
  historical.changed_fields,
  'La orden fue modificada por administracion.',
  jsonb_build_object(
    'actor_id', historical.actor_id,
    'actor_role', historical.actor_role,
    'backfilled_from_notifications', true
  ),
  historical.created_at
from historical_notices as historical
join public.order_events as event on event.id = historical.order_event_id
on conflict (order_event_id, user_id) do nothing;

-- Normalize and enrich pending rows produced by the previous implementation.
update public.order_event_reviews
set label = 'Editada por Admin'
where event_key = 'admin_edited_order'
  and reviewed_at is null;

with enriched as (
  select
    review.id,
    jsonb_agg(
      item || jsonb_build_object(
        'old_value', public.admin_order_edit_value(
          jsonb_populate_record(null::public.orders, event.changes->'old'),
          item->>'field'
        ),
        'new_value', public.admin_order_edit_value(
          jsonb_populate_record(null::public.orders, event.changes->'new'),
          item->>'field'
        )
      )
    ) as changed_fields
  from public.order_event_reviews as review
  join public.order_events as event on event.id = review.order_event_id
  cross join lateral jsonb_array_elements(coalesce(review.changed_fields, '[]'::jsonb)) as item
  where review.event_key = 'admin_edited_order'
    and review.reviewed_at is null
  group by review.id
)
update public.order_event_reviews as review
set changed_fields = enriched.changed_fields
from enriched
where review.id = enriched.id
  and review.event_key = 'admin_edited_order'
  and review.reviewed_at is null;

revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from public;
revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from anon;
revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from authenticated;

revoke all on function public.handle_admin_order_edit_review() from public;
revoke all on function public.handle_admin_order_edit_review() from anon;
revoke all on function public.handle_admin_order_edit_review() from authenticated;
