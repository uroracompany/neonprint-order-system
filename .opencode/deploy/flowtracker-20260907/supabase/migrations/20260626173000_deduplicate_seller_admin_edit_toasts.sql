-- Avoid duplicate seller toasts for admin edits.
-- Sellers keep the area-specific "Aviso de orden editada" notification and the
-- order_event_reviews badge, but no longer receive the generic notification row.

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
  recipients uuid[];
  source_module text := public.order_event_source_module(actor_role);
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if coalesce(actor_role, '') <> 'admin' then
    return new;
  end if;

  if jsonb_array_length(changed_fields) = 0 then
    return new;
  end if;

  select array_agg(distinct recipient_id)
    into recipients
  from unnest(array[new.seller_id, new.created_by]) as recipient_id
  where recipient_id is not null
    and recipient_id is distinct from actor_id;

  if coalesce(array_length(recipients, 1), 0) = 0 then
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

  perform public.create_order_event_reviews(
    event_id,
    new.id,
    recipients,
    'Editada por admin',
    source_module,
    'admin_edited_order',
    changed_fields,
    'La orden fue modificada por administracion.',
    jsonb_build_object('actor_id', actor_id, 'actor_role', actor_role)
  );

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

revoke all on function public.handle_admin_order_edit_review() from public;
revoke all on function public.handle_admin_order_edit_review() from anon;
revoke all on function public.handle_admin_order_edit_review() from authenticated;
