-- Centralized order audit reviews and pending-change labels.
-- This complements the existing notifications trigger with a durable review queue
-- that can be consumed by role-specific UIs without duplicating module logic.

alter table public.notifications
  add column if not exists order_event_id uuid;

alter table public.notifications
  add column if not exists read_at timestamptz;

do $$
begin
  alter table public.notifications
    add constraint notifications_order_event_id_fkey
    foreign key (order_event_id) references public.order_events(id) on delete set null;
exception
  when duplicate_object then null;
end $$;

create index if not exists idx_notifications_order_event_id
  on public.notifications(order_event_id);

create table if not exists public.order_event_reviews (
  id uuid primary key default gen_random_uuid(),
  order_event_id uuid not null references public.order_events(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  label text not null,
  source_module text not null,
  event_key text not null,
  changed_fields jsonb not null default '[]'::jsonb,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  unique (order_event_id, user_id)
);

create index if not exists idx_order_event_reviews_user_pending
  on public.order_event_reviews(user_id, reviewed_at, created_at desc);

create index if not exists idx_order_event_reviews_order_user_pending
  on public.order_event_reviews(order_id, user_id, reviewed_at);

alter table public.order_event_reviews enable row level security;

drop policy if exists order_event_reviews_select_own_or_admin on public.order_event_reviews;
create policy order_event_reviews_select_own_or_admin
  on public.order_event_reviews for select
  to authenticated
  using (user_id = auth.uid() or public.current_profile_is_admin());

drop policy if exists order_event_reviews_update_own_pending on public.order_event_reviews;
create policy order_event_reviews_update_own_pending
  on public.order_event_reviews for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.order_event_reviews from anon;
grant select, update on public.order_event_reviews to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.order_event_reviews;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

create or replace function public.order_event_source_module(p_role text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when lower(coalesce(p_role, '')) = 'admin' then 'admin'
    when lower(coalesce(p_role, '')) in ('seller', 'sales', 'vendedor') then 'sales'
    when lower(coalesce(p_role, '')) in ('designer', 'design', 'disenador', 'diseñador') then 'design'
    when lower(coalesce(p_role, '')) in ('quote', 'cashier', 'caja', 'cotizador') then 'quote'
    when lower(coalesce(p_role, '')) in ('delivery', 'dispatcher', 'repartidor') then 'delivery'
    when lower(coalesce(p_role, '')) like '%production%'
      or lower(coalesce(p_role, '')) like '%product%'
      or lower(coalesce(p_role, '')) in ('printer', 'digital', 'dtf', 'plotter', 'ploteo')
      then 'production'
    else 'system'
  end
$$;

create or replace function public.order_business_changed_fields(
  old_row public.orders,
  new_row public.orders
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  fields jsonb := '[]'::jsonb;
begin
  if old_row.client_id is distinct from new_row.client_id
    or old_row.client_name is distinct from new_row.client_name
    or old_row.client_contact is distinct from new_row.client_contact then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'client', 'label', 'Cliente'));
  end if;

  if old_row.invoice_number is distinct from new_row.invoice_number then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'invoice_number', 'label', 'Facturacion'));
  end if;

  if old_row.description is distinct from new_row.description then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'description', 'label', 'Descripcion'));
  end if;

  if old_row.material is distinct from new_row.material then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'material', 'label', 'Material'));
  end if;

  if old_row.termination_type is distinct from new_row.termination_type then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'termination_type', 'label', 'Terminacion'));
  end if;

  if old_row.delivery_date is distinct from new_row.delivery_date then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'delivery_date', 'label', 'Fecha de entrega'));
  end if;

  if old_row.order_file_url is distinct from new_row.order_file_url then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'order_file_url', 'label', 'Archivos adjuntos'));
  end if;

  if old_row.preview_image is distinct from new_row.preview_image then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'preview_image', 'label', 'Imagen de preview'));
  end if;

  if old_row.reference_images is distinct from new_row.reference_images then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'reference_images', 'label', 'Imagenes de referencia'));
  end if;

  if old_row.status is distinct from new_row.status then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'status', 'label', 'Estado'));
  end if;

  if old_row.payment_status is distinct from new_row.payment_status
    or old_row.invoice_payment is distinct from new_row.invoice_payment then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'payment', 'label', 'Pago'));
  end if;

  if old_row.designer_id is distinct from new_row.designer_id
    or old_row.quote_id is distinct from new_row.quote_id
    or old_row.production_id is distinct from new_row.production_id
    or old_row.delivery_id is distinct from new_row.delivery_id then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'assignment', 'label', 'Responsable'));
  end if;

  if old_row.return_reason is distinct from new_row.return_reason
    or old_row.cancellation_reason is distinct from new_row.cancellation_reason then
    fields := fields || jsonb_build_array(jsonb_build_object('field', 'workflow_note', 'label', 'Nota operativa'));
  end if;

  return fields;
end;
$$;

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
  inserted_count integer := 0;
begin
  with recipients as (
    select distinct recipient_id as user_id
    from unnest(coalesce(p_user_ids, array[]::uuid[])) as recipient_id
    where recipient_id is not null
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
  on conflict (order_event_id, user_id) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
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

  return new;
end;
$$;

drop trigger if exists trg_admin_order_edit_review on public.orders;
create trigger trg_admin_order_edit_review
  after update on public.orders
  for each row
  execute function public.handle_admin_order_edit_review();

revoke all on function public.handle_admin_order_edit_review() from public;
revoke all on function public.handle_admin_order_edit_review() from anon;
revoke all on function public.handle_admin_order_edit_review() from authenticated;

create or replace function public.handle_order_production_files_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_profile_role();
  source_module text := public.order_event_source_module(actor_role);
  event_key text;
  target_order_id uuid;
  changed_fields jsonb := '[]'::jsonb;
begin
  if tg_op = 'INSERT' then
    target_order_id := new.order_id;
    event_key := case when source_module = 'design' then 'design_file_added' else 'production_file_added' end;
    changed_fields := jsonb_build_array(jsonb_build_object('field', 'production_file', 'label', 'Archivo agregado'));
  elsif tg_op = 'DELETE' then
    target_order_id := old.order_id;
    event_key := case when source_module = 'design' then 'design_file_removed' else 'production_file_removed' end;
    changed_fields := jsonb_build_array(jsonb_build_object('field', 'production_file', 'label', 'Archivo eliminado'));
  else
    target_order_id := new.order_id;
    event_key := case
      when old.status is distinct from new.status then 'production_file_status_changed'
      when old.assigned_to is distinct from new.assigned_to then 'production_file_assignment_changed'
      else 'production_file_updated'
    end;
    changed_fields := jsonb_build_array(jsonb_build_object(
      'field',
      case
        when old.status is distinct from new.status then 'production_file_status'
        when old.assigned_to is distinct from new.assigned_to then 'production_file_assignment'
        else 'production_file'
      end,
      'label',
      case
        when old.status is distinct from new.status then 'Estado de produccion'
        when old.assigned_to is distinct from new.assigned_to then 'Responsable de produccion'
        else 'Archivo de produccion'
      end
    ));
  end if;

  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (
    target_order_id,
    actor_id,
    event_key,
    jsonb_build_object(
      'source_module', source_module,
      'changed_fields', changed_fields,
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_production_files_audit on public.order_production_files;
create trigger trg_order_production_files_audit
  after insert or update or delete on public.order_production_files
  for each row
  execute function public.handle_order_production_files_audit();

revoke all on function public.handle_order_production_files_audit() from public;
revoke all on function public.handle_order_production_files_audit() from anon;
revoke all on function public.handle_order_production_files_audit() from authenticated;

create or replace function public.handle_order_production_assignments_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text := public.current_profile_role();
  target_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  insert into public.order_events(order_id, actor_id, event_type, changes)
  values (
    target_order_id,
    actor_id,
    'production_assignment_changed',
    jsonb_build_object(
      'source_module', public.order_event_source_module(actor_role),
      'changed_fields', jsonb_build_array(jsonb_build_object('field', 'production_assignment', 'label', 'Asignacion de produccion')),
      'old', case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
      'new', case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
    )
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_production_assignments_audit on public.order_production_assignments;
create trigger trg_order_production_assignments_audit
  after insert or update or delete on public.order_production_assignments
  for each row
  execute function public.handle_order_production_assignments_audit();

revoke all on function public.handle_order_production_assignments_audit() from public;
revoke all on function public.handle_order_production_assignments_audit() from anon;
revoke all on function public.handle_order_production_assignments_audit() from authenticated;
