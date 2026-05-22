-- Enterprise hardening for NeonPrint order flow and notifications.
-- Supabase is now the single source of truth for notification creation.

create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Core schema hardening
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

alter table public.orders
  alter column created_at type timestamptz using created_at at time zone 'UTC',
  alter column created_at set default now();

create index if not exists idx_orders_created_by on public.orders(created_by);
create index if not exists idx_orders_seller_id on public.orders(seller_id);
create index if not exists idx_orders_designer_id on public.orders(designer_id);
create index if not exists idx_orders_quote_id on public.orders(quote_id);
create index if not exists idx_orders_production_id on public.orders(production_id);
create index if not exists idx_orders_delivery_id on public.orders(delivery_id);
create index if not exists idx_orders_status_created on public.orders(status, created_at desc);
create index if not exists idx_orders_payment_status on public.orders(payment_status);

create table if not exists public.order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  old_status text,
  new_status text,
  old_payment_status text,
  new_payment_status text,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_events_order_created
  on public.order_events(order_id, created_at desc);
create index if not exists idx_order_events_actor_created
  on public.order_events(actor_id, created_at desc);

-- ---------------------------------------------------------------------
-- Role helpers used by RLS. SECURITY DEFINER functions are locked down
-- and use an explicit search_path to avoid mutable path warnings.
-- ---------------------------------------------------------------------
create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_profile_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.get_role_user_ids(p_role text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(id), array[]::uuid[])
  from public.profiles
  where role = p_role and coalesce(employment_status, true) = true
$$;

create or replace function public.get_admin_user_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select public.get_role_user_ids('admin')
$$;

revoke all on function public.current_profile_role() from anon;
revoke all on function public.current_profile_is_admin() from anon;
revoke all on function public.get_role_user_ids(text) from anon;
revoke all on function public.get_admin_user_ids() from anon;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.current_profile_is_admin() to authenticated;
grant execute on function public.get_role_user_ids(text) to authenticated;
grant execute on function public.get_admin_user_ids() to authenticated;

-- ---------------------------------------------------------------------
-- Notification RPC with deduplication. Clients can only create their own
-- confirmation notifications; triggers can create notifications for others.
-- ---------------------------------------------------------------------
create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_order_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  nid uuid;
  caller uuid := auth.uid();
begin
  if p_user_id is null then
    raise exception 'Notification user_id is required';
  end if;

  if caller is not null and caller <> p_user_id and not public.current_profile_is_admin() then
    raise exception 'Cannot create notifications for another user';
  end if;

  select id into nid
  from public.notifications
  where user_id = p_user_id
    and type = p_type
    and order_id is not distinct from p_order_id
    and title = p_title
    and message = p_message
    and created_at > now() - interval '10 minutes'
  order by created_at desc
  limit 1;

  if nid is null then
    insert into public.notifications (user_id, type, title, message, order_id, metadata)
    values (p_user_id, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb))
    returning id into nid;
  end if;

  return nid;
end;
$$;

revoke all on function public.create_notification(uuid, text, text, text, uuid, jsonb) from public;
revoke all on function public.create_notification(uuid, text, text, text, uuid, jsonb) from anon;
grant execute on function public.create_notification(uuid, text, text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Order audit and notification trigger.
-- ---------------------------------------------------------------------
create or replace function public.set_order_update_metadata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_set_order_update_metadata on public.orders;
create trigger trg_set_order_update_metadata
  before update on public.orders
  for each row
  execute function public.set_order_update_metadata();

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
begin
  foreach recipient in array coalesce(p_recipients, array[]::uuid[]) loop
    if recipient is not null then
      select id into nid
      from public.notifications
      where user_id = recipient
        and type = p_type
        and order_id is not distinct from p_order_id
        and title = p_title
        and message = p_message
        and created_at > now() - interval '10 minutes'
      order by created_at desc
      limit 1;

      if nid is null then
        insert into public.notifications (user_id, type, title, message, order_id, metadata)
        values (recipient, p_type, p_title, p_message, p_order_id, coalesce(p_metadata, '{}'::jsonb));
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from public;
revoke all on function public.notify_many(uuid[], text, text, text, uuid, jsonb) from anon;

create or replace function public.handle_order_change_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid := auth.uid();
  admins uuid[] := public.get_admin_user_ids();
  printers uuid[] := public.get_role_user_ids('printer');
  base_recipients uuid[];
  meta jsonb;
  event_type text := 'order_updated';
begin
  meta := jsonb_build_object(
    'status', new.status,
    'previous_status', case when tg_op = 'UPDATE' then old.status else null end,
    'payment_status', new.payment_status,
    'client_name', new.client_name,
    'order_type', new.order_type,
    'order_design_type', new.order_design_type,
    'actor_id', actor_id
  );

  if tg_op = 'INSERT' then
    event_type := 'new_order';
    base_recipients := array_remove(array[new.created_by, new.seller_id, actor_id] || admins, null);

    perform public.notify_many(
      base_recipients,
      'new_order',
      'Nueva orden creada',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' creada correctamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_created')
    );

    insert into public.order_events(order_id, actor_id, event_type, new_status, new_payment_status, changes)
    values (new.id, actor_id, 'order_created', new.status, new.payment_status, to_jsonb(new));

    return new;
  end if;

  insert into public.order_events(
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
    'order_updated',
    old.status,
    new.status,
    old.payment_status,
    new.payment_status,
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );

  if new.designer_id is distinct from old.designer_id and new.designer_id is not null then
    perform public.notify_many(
      array_remove(array_remove(array[new.seller_id, new.created_by], null), new.designer_id),
      'order_assigned',
      'Asignada a diseño',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' asignada correctamente a diseno.',
      new.id,
      meta || jsonb_build_object('event_kind', 'designer_assigned_confirmation')
    );

    perform public.notify_many(
      array_remove(array[new.designer_id], null),
      'order_assigned',
      'Nueva orden asignada',
      'Se te asigno una nueva orden de ' || coalesce(new.client_name, 'cliente') || ' para diseno.',
      new.id,
      meta || jsonb_build_object('event_kind', 'designer_assigned')
    );
  end if;

  if new.quote_id is distinct from old.quote_id and new.quote_id is not null then
    perform public.notify_many(
      array_remove(array_remove(array[new.quote_id], null), new.designer_id),
      'order_assigned',
      'Nueva orden asignada',
      'Se te asigno una nueva orden de ' || coalesce(new.client_name, 'cliente') || ' para cotizacion.',
      new.id,
      meta || jsonb_build_object('event_kind', 'quote_assigned')
    );

    perform public.notify_many(
      array_remove(array_remove(array[new.designer_id], null), new.quote_id),
      'order_assigned',
      'Enviada a cotizacion',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' enviada correctamente a cotizacion.',
      new.id,
      meta || jsonb_build_object('event_kind', 'quote_sent_confirmation')
    );
  end if;

  if new.return_reason is distinct from old.return_reason and new.return_reason is not null then
    perform public.notify_many(
      array_remove(array[new.designer_id, new.quote_id, new.seller_id, new.created_by, actor_id] || admins, null),
      'order_returned',
      'Orden devuelta',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' devuelta: ' || new.return_reason,
      new.id,
      meta || jsonb_build_object('event_kind', 'order_returned', 'return_reason', new.return_reason)
    );
  end if;

  if new.payment_status is distinct from old.payment_status then
    perform public.notify_many(
      array_remove(array[new.quote_id, new.seller_id, new.created_by, actor_id] || admins || printers, null),
      'order_updated',
      'Pago actualizado',
      'Pago de la orden de ' || coalesce(new.client_name, 'cliente') || ' actualizado a ' || new.payment_status || '.',
      new.id,
      meta || jsonb_build_object('event_kind', 'payment_updated', 'previous_payment_status', old.payment_status)
    );
  end if;

  if new.status is distinct from old.status
    and not (
      new.designer_id is distinct from old.designer_id
      and new.designer_id is not null
      and new.status = 'In_Design'
    )
    and not (
      new.quote_id is distinct from old.quote_id
      and new.quote_id is not null
      and new.status = 'cotizacion'
    ) then
    event_type := case
      when new.status = 'cancelled' then 'order_cancelled'
      when new.status = 'completada' then 'order_completed'
      else 'order_updated'
    end;

    perform public.notify_many(
      array_remove(array[new.designer_id, new.quote_id, new.seller_id, new.created_by, actor_id] || admins || printers, null),
      event_type,
      case
        when new.status = 'cancelled' then 'Orden cancelada'
        when new.status = 'completada' then 'Orden completada'
        when new.status = 'In_Design' then 'Orden en diseno'
        when new.status = 'cotizacion' then 'Orden en cotizacion'
        when new.status = 'en produccion' then 'Orden en produccion'
        when new.status = 'terminacion' then 'Orden lista para entrega'
        when new.status = 'en entrega' then 'Orden en entrega'
        else 'Estado actualizado'
      end,
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' cambio de ' ||
        coalesce(old.status, 'sin estado') || ' a ' || coalesce(new.status, 'sin estado') || '.',
      new.id,
      meta || jsonb_build_object('event_kind', 'status_changed')
    );
  end if;

  if new.is_archived is distinct from old.is_archived
    or new.is_archived_admin is distinct from old.is_archived_admin
    or new.is_archived_designer is distinct from old.is_archived_designer
    or new.is_archived_quote is distinct from old.is_archived_quote then
    perform public.notify_many(
      array_remove(array[actor_id, new.seller_id, new.created_by] || admins, null),
      'order_archived',
      'Orden archivada',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' archivada correctamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_archived')
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_order_change_notification() from public;
revoke all on function public.handle_order_change_notification() from anon;
revoke all on function public.handle_order_change_notification() from authenticated;

drop trigger if exists trg_order_notification on public.orders;
create trigger trg_order_notification
  after insert or update on public.orders
  for each row
  execute function public.handle_order_change_notification();

-- ---------------------------------------------------------------------
-- RLS policies
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.notifications enable row level security;
alter table public.order_events enable row level security;

drop policy if exists profiles_select_authenticated on public.profiles;
drop policy if exists profiles_insert_admin on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;

create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

create policy profiles_insert_admin
  on public.profiles for insert
  to authenticated
  with check (public.current_profile_is_admin());

create policy profiles_update_admin
  on public.profiles for update
  to authenticated
  using (public.current_profile_is_admin())
  with check (public.current_profile_is_admin());

create policy profiles_delete_admin
  on public.profiles for delete
  to authenticated
  using (public.current_profile_is_admin());

drop policy if exists orders_select_by_role on public.orders;
drop policy if exists orders_insert_by_seller on public.orders;
drop policy if exists orders_update_by_role on public.orders;
drop policy if exists orders_delete_admin on public.orders;

create policy orders_select_by_role
  on public.orders for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('en produccion', 'terminacion', 'en entrega', 'completada')
    )
  );

create policy orders_insert_by_seller
  on public.orders for insert
  to authenticated
  with check (
    public.current_profile_is_admin()
    or auth.uid() = created_by
    or auth.uid() = seller_id
  );

create policy orders_update_by_role
  on public.orders for update
  to authenticated
  using (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('en produccion', 'terminacion', 'en entrega', 'completada')
    )
  )
  with check (
    public.current_profile_is_admin()
    or auth.uid() in (created_by, seller_id, designer_id, quote_id, production_id, delivery_id)
    or (
      public.current_profile_role() = 'printer'
      and status in ('en produccion', 'terminacion', 'en entrega', 'completada')
    )
  );

create policy orders_delete_admin
  on public.orders for delete
  to authenticated
  using (public.current_profile_is_admin());

drop policy if exists notif_select on public.notifications;
drop policy if exists notif_update on public.notifications;
drop policy if exists notif_delete on public.notifications;
drop policy if exists notif_insert on public.notifications;

create policy notif_select
  on public.notifications for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy notif_update
  on public.notifications for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notif_delete
  on public.notifications for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy notif_insert_own
  on public.notifications for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists order_events_select_by_order_access on public.order_events;
create policy order_events_select_by_order_access
  on public.order_events for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or exists (
      select 1
      from public.orders o
      where o.id = order_events.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.production_id, o.delivery_id)
          or (
            public.current_profile_role() = 'printer'
            and o.status in ('en produccion', 'terminacion', 'en entrega', 'completada')
          )
        )
    )
  );

-- Realtime publication is idempotently maintained.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
