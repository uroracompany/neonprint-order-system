-- Detect delivery commitments after the local calendar day has ended. This is
-- an operational signal only: it never mutates public.orders.status.

create table if not exists public.order_delivery_overdue_notification_runs (
  order_id uuid not null references public.orders(id) on delete cascade,
  delivery_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (order_id, delivery_date, user_id)
);

alter table public.order_delivery_overdue_notification_runs enable row level security;

create or replace function public.dispatch_order_delivery_overdue_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := timezone('America/Asuncion', now())::date;
  v_order record;
  v_status text;
  v_delivery_date date;
  v_recipients uuid[];
  v_recipient_id uuid;
  v_inserted_user_id uuid;
  v_sent_count integer := 0;
begin
  for v_order in
    select o.id, o.status, o.client_name, o.delivery_date, o.seller_id, o.created_by,
      o.designer_id, o.quote_id, o.production_id, o.delivery_id
    from public.orders o
    where o.delivery_date is not null
      and o.delivery_date::date < v_today
      and lower(coalesce(o.status, '')) not in ('in_delivered', 'delivered', 'cancelled')
    order by o.delivery_date asc
  loop
    v_status := lower(coalesce(v_order.status, ''));
    v_delivery_date := v_order.delivery_date::date;
    v_recipients := array[]::uuid[];

    if v_status = 'pending' then
      v_recipients := array_remove(array[v_order.seller_id, v_order.created_by], null);
    elsif v_status = 'in_design' then
      v_recipients := array_remove(array[v_order.designer_id], null);
    elsif v_status = 'in_quote' then
      v_recipients := array_remove(array[v_order.quote_id], null);
    elsif v_status in ('in_production', 'in_termination') then
      select coalesce(array_agg(distinct opa.assigned_to), array[]::uuid[])
      into v_recipients
      from public.order_production_assignments opa
      where opa.order_id = v_order.id
        and opa.assigned_to is not null;

      if coalesce(cardinality(v_recipients), 0) = 0 then
        v_recipients := array_remove(array[v_order.production_id], null);
      end if;
    elsif v_status in ('in_completed', 'completed') then
      v_recipients := array_remove(array[v_order.delivery_id], null);
    end if;

    select coalesce(array_agg(distinct p.id), array[]::uuid[])
    into v_recipients
    from unnest(v_recipients || public.get_admin_user_ids()) as candidate(id)
    join public.profiles p on p.id = candidate.id
    where coalesce(p.employment_status, true) = true
      and p.deleted_at is null;

    foreach v_recipient_id in array v_recipients loop
      v_inserted_user_id := null;
      insert into public.order_delivery_overdue_notification_runs (order_id, delivery_date, user_id)
      values (v_order.id, v_delivery_date, v_recipient_id)
      on conflict do nothing
      returning user_id into v_inserted_user_id;

      if v_inserted_user_id is not null then
        perform public.notify_many(
          array[v_recipient_id],
          'order_updated',
          'Orden atrasada',
          format(
            'La orden de %s superó su fecha de entrega hace %s día(s).',
            coalesce(nullif(v_order.client_name, ''), 'cliente'),
            v_today - v_delivery_date
          ),
          v_order.id,
          jsonb_build_object(
            'event_kind', 'order_delivery_overdue',
            'delivery_date', v_delivery_date,
            'days_overdue', v_today - v_delivery_date,
            'navigation_target', 'orders'
          )
        );
        v_sent_count := v_sent_count + 1;
      end if;
    end loop;
  end loop;

  return v_sent_count;
end;
$$;

revoke all on function public.dispatch_order_delivery_overdue_notifications() from public;
revoke all on function public.dispatch_order_delivery_overdue_notifications() from anon;
revoke all on function public.dispatch_order_delivery_overdue_notifications() from authenticated;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-order-delivery-overdue') then
    perform cron.unschedule('dispatch-order-delivery-overdue');
  end if;
end;
$$;

select cron.schedule(
  'dispatch-order-delivery-overdue',
  '5 * * * *',
  $$select public.dispatch_order_delivery_overdue_notifications();$$
);
