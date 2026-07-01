-- Additive admin edit notices.
-- Keeps the existing "Editada por admin" review flow and adds targeted notice
-- notifications with field-specific messages for affected users or areas.

alter table public.notifications
  add column if not exists read_at timestamptz;

create or replace function public.admin_order_edit_area_for_field(
  p_field text,
  p_new_status text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_field = 'payment' then 'quote'
    when p_field in ('files', 'order_file_url', 'preview_image', 'reference_images') then 'design'
    when p_field = 'termination_type' then 'sales'
    when p_field = 'delivery_date' then 'delivery'
    when p_field = 'assignment' then 'assignment'
    when p_field = 'status' and p_new_status in ('in_Quote') then 'quote'
    when p_field = 'status' and p_new_status in ('in_Design') then 'design'
    when p_field = 'status' and p_new_status in ('in_Production', 'in_Termination') then 'production'
    when p_field = 'status' and p_new_status in ('in_Delivered', 'in_Completed') then 'delivery'
    else 'sales'
  end
$$;

create or replace function public.admin_order_edit_value(
  p_order public.orders,
  p_field text
)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when p_field = 'client' then nullif(concat_ws(' / ', p_order.client_name, p_order.client_contact), '')
    when p_field = 'invoice_number' then p_order.invoice_number
    when p_field = 'description' then p_order.description
    when p_field = 'material' then p_order.material
    when p_field = 'termination_type' then p_order.termination_type
    when p_field = 'delivery_date' then p_order.delivery_date::text
    when p_field = 'files' then 'Archivos de la orden'
    when p_field = 'order_file_url' then
      case
        when nullif(p_order.order_file_url, '') is null then 'Sin archivos adjuntos'
        else 'Archivos adjuntos cargados'
      end
    when p_field = 'preview_image' then
      case
        when nullif(p_order.preview_image, '') is null then 'Sin preview'
        else 'Preview cargado'
      end
    when p_field = 'reference_images' then
      case
        when jsonb_array_length(coalesce(p_order.reference_images, '[]'::jsonb)) = 0 then 'Sin imagenes de referencia'
        else 'Imagenes de referencia cargadas'
      end
    when p_field = 'status' then p_order.status
    when p_field = 'payment' then p_order.payment_status
    when p_field = 'assignment' then nullif(concat_ws(
      ' / ',
      p_order.designer_id::text,
      p_order.quote_id::text,
      p_order.production_id::text,
      p_order.delivery_id::text
    ), '')
    when p_field = 'workflow_note' then coalesce(p_order.return_reason, p_order.cancellation_reason)
    else null
  end
$$;

create or replace function public.order_cashier_quote_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct p_order.quote_id), array[]::uuid[])
  from public.profiles p
  where p.id = p_order.quote_id
    and p.role = 'quote'
    and coalesce(p.employment_status, true) = true
$$;

create or replace function public.admin_order_edit_production_recipients(
  p_order public.orders
)
returns uuid[]
language sql
stable
set search_path = public
as $$
  with legacy_assignee as (
    select p_order.production_id as recipient_id
    where p_order.production_id is not null
  ),
  area_assignees as (
    select opa.assigned_to as recipient_id
    from public.order_production_assignments opa
    join public.production_areas pa
      on pa.code = opa.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opa.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opa.order_id = p_order.id
  ),
  file_assignees as (
    select opf.assigned_to as recipient_id
    from public.order_production_files opf
    join public.production_areas pa
      on pa.code = opf.production_area_code
      and pa.is_active = true
    join public.profiles p
      on p.id = opf.assigned_to
      and p.role = pa.producer_role
      and coalesce(p.employment_status, true) = true
    where opf.order_id = p_order.id
      and opf.assigned_to is not null
  )
  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
  from (
    select recipient_id from legacy_assignee
    union all
    select recipient_id from area_assignees
    union all
    select recipient_id from file_assignees
  ) recipients
  where recipient_id is not null
$$;

create or replace function public.admin_order_edit_notice_recipients(
  p_area text,
  p_order public.orders,
  p_actor_id uuid
)
returns uuid[]
language plpgsql
stable
set search_path = public
as $$
declare
  base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]
    || public.admin_order_edit_production_recipients(p_order);
  recipients uuid[] := array[]::uuid[];
begin
  if p_area = 'quote' then
    recipients := base_recipients
      || public.order_cashier_quote_recipients(p_order);
  elsif p_area = 'design' then
    recipients := base_recipients || public.get_role_user_ids('designer');
  elsif p_area = 'production' then
    recipients := base_recipients
      || public.admin_order_edit_production_recipients(p_order);
  elsif p_area = 'delivery' then
    recipients := base_recipients
      || array[p_order.delivery_id]
      || public.get_role_user_ids('delivery');
  elsif p_area = 'assignment' then
    recipients := base_recipients || array[
      p_order.quote_id,
      p_order.delivery_id
    ];
  else
    recipients := base_recipients;
  end if;

  select coalesce(array_agg(distinct recipient_id), array[]::uuid[])
    into recipients
  from unnest(coalesce(recipients, array[]::uuid[])) as recipient_id
  where recipient_id is not null
    and recipient_id is distinct from p_actor_id;

  return recipients;
end;
$$;

revoke all on function public.order_cashier_quote_recipients(public.orders) from public;
revoke all on function public.order_cashier_quote_recipients(public.orders) from anon;
revoke all on function public.order_cashier_quote_recipients(public.orders) from authenticated;

revoke all on function public.admin_order_edit_production_recipients(public.orders) from public;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from anon;
revoke all on function public.admin_order_edit_production_recipients(public.orders) from authenticated;

create or replace function public.admin_order_edit_notice_message(
  p_order_label text,
  p_label text,
  p_field text,
  p_old_value text,
  p_new_value text
)
returns text
language plpgsql
stable
set search_path = public
as $$
begin
  if p_field = 'payment' then
    return 'El administrador cambio el estado de pago de la orden #' || p_order_label
      || case
        when p_old_value is not null and p_new_value is not null and p_old_value is distinct from p_new_value
          then ' de "' || p_old_value || '" a "' || p_new_value || '".'
        else '.'
      end;
  end if;

  if p_field = 'files' then
    return 'El administrador modifico archivos de la orden #' || p_order_label || '.';
  end if;

  if p_field in ('order_file_url', 'preview_image', 'reference_images') then
    return 'El administrador modifico ' || lower(coalesce(p_label, 'archivos')) || ' de la orden #' || p_order_label || '.';
  end if;

  return 'El administrador modifico ' || coalesce(p_label, 'informacion') || ' en la orden #' || p_order_label
    || case
      when p_old_value is not null and p_new_value is not null and p_old_value is distinct from p_new_value
        then ' de "' || p_old_value || '" a "' || p_new_value || '".'
      else '.'
    end;
end;
$$;

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

    if coalesce(array_length(recipients, 1), 0) = 0 then
      continue;
    end if;

    old_value := public.admin_order_edit_value(old_row, field_name);
    new_value := public.admin_order_edit_value(new_row, field_name);
    notice_message := public.admin_order_edit_notice_message(order_label, field_label, field_name, old_value, new_value);

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
        'changed_fields', jsonb_build_array(jsonb_build_object(
          'field', field_name,
          'label', field_label,
          'old_value', old_value,
          'new_value', new_value,
          'area', area_name
        ))
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
  recipients uuid[];
  source_module text := public.order_event_source_module(actor_role);
  order_label text := coalesce(new.order_code::text, left(new.id::text, 8));
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

revoke all on function public.admin_order_edit_area_for_field(text, text) from public;
revoke all on function public.admin_order_edit_area_for_field(text, text) from anon;
revoke all on function public.admin_order_edit_area_for_field(text, text) from authenticated;

revoke all on function public.admin_order_edit_value(public.orders, text) from public;
revoke all on function public.admin_order_edit_value(public.orders, text) from anon;
revoke all on function public.admin_order_edit_value(public.orders, text) from authenticated;

revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from public;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from anon;
revoke all on function public.admin_order_edit_notice_recipients(text, public.orders, uuid) from authenticated;

revoke all on function public.admin_order_edit_notice_message(text, text, text, text, text) from public;
revoke all on function public.admin_order_edit_notice_message(text, text, text, text, text) from anon;
revoke all on function public.admin_order_edit_notice_message(text, text, text, text, text) from authenticated;

revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from public;
revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from anon;
revoke all on function public.notify_admin_order_edit_area_alerts(public.orders, public.orders, uuid, uuid, text, jsonb) from authenticated;

revoke all on function public.handle_admin_order_edit_review() from public;
revoke all on function public.handle_admin_order_edit_review() from anon;
revoke all on function public.handle_admin_order_edit_review() from authenticated;
