-- Notify anonymous FlowTrack pages as soon as the tracked order or one of its
-- production files changes. The topic is scoped by the existing bearer token;
-- the payload is deliberately only a change signal and contains no row data.
create or replace function public.broadcast_flowtrack_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_tracking_token uuid;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'orders'
      and new.status is not distinct from old.status
      and new.payment_status is not distinct from old.payment_status then
      return new;
    end if;
    if tg_table_name = 'order_production_files'
      and new.status is not distinct from old.status
      and new.production_area_code is not distinct from old.production_area_code
      and new.public_label is not distinct from old.public_label then
      return new;
    end if;
  end if;

  if tg_table_name = 'orders' then
    v_order_id := case when tg_op = 'DELETE' then old.id else new.id end;
    v_tracking_token := case when tg_op = 'DELETE' then old.tracking_token else new.tracking_token end;
  else
    v_order_id := case when tg_op = 'DELETE' then old.order_id else new.order_id end;
    select o.tracking_token
      into v_tracking_token
      from public.orders o
     where o.id = v_order_id;
  end if;

  if v_order_id is null or v_tracking_token is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform realtime.send(
    jsonb_build_object(
      'order_id', v_order_id,
      'operation', tg_op,
      'changed_at', clock_timestamp()
    ),
    'flowtrack_changed',
    'flowtrack:' || v_tracking_token::text,
    false
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.broadcast_flowtrack_change() from public, anon, authenticated;
grant execute on function public.broadcast_flowtrack_change() to service_role;

drop trigger if exists trg_broadcast_flowtrack_order_change on public.orders;
create trigger trg_broadcast_flowtrack_order_change
after insert or update of status, payment_status or delete on public.orders
for each row execute function public.broadcast_flowtrack_change();

drop trigger if exists trg_broadcast_flowtrack_file_change on public.order_production_files;
create trigger trg_broadcast_flowtrack_file_change
after insert or update of status, production_area_code, public_label or delete on public.order_production_files
for each row execute function public.broadcast_flowtrack_change();

-- Keep the public response narrow while including the production progress that
-- FlowTrackClient displays. Internal URLs, filenames and assignees stay out.
create or replace function public.get_public_order_tracking(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order', jsonb_build_object(
      'id', o.id,
      'status', o.status,
      'payment_status', o.payment_status,
      'created_at', o.created_at,
      'updated_at', o.updated_at,
      'delivery_date', o.delivery_date,
      'order_type', o.order_type,
      'order_design_type', o.order_design_type,
      'cancellation_reason', o.cancellation_reason,
      'production_files', coalesce(files.items, '[]'::jsonb)
    ),
    'events', coalesce(events.items, '[]'::jsonb)
  )
  from public.orders o
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'file_index', indexed_files.file_index,
      'display_label', case
        when nullif(trim(indexed_files.public_label), '') is not null
          then nullif(trim(indexed_files.public_label), '')
        else 'Parte ' || indexed_files.file_index || ' del pedido'
      end,
      'production_area_code', indexed_files.production_area_code,
      'production_area_label', coalesce(pa.label, 'Sin clasificar'),
      'status', indexed_files.status,
      'updated_at', indexed_files.updated_at,
      'completed_at', indexed_files.completed_at
    ) order by indexed_files.file_index) as items
    from (
      select
        opf.production_area_code,
        opf.public_label,
        opf.status,
        opf.updated_at,
        opf.completed_at,
        row_number() over (order by opf.created_at, opf.id) as file_index
      from public.order_production_files opf
      where opf.order_id = o.id
    ) indexed_files
    left join public.production_areas pa
      on pa.code = indexed_files.production_area_code
  ) files on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'new_status', e.new_status,
      'created_at', e.created_at
    ) order by e.created_at) as items
    from public.order_events e
    where e.order_id = o.id and e.new_status is not null
  ) events on true
  where o.tracking_token = case
    when p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then p_token::uuid
    else null
  end
  limit 1;
$$;

revoke all on function public.get_public_order_tracking(text) from public, anon, authenticated;
grant execute on function public.get_public_order_tracking(text) to service_role;
