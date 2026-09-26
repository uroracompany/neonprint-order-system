-- Public tracking links remain available for the physical lifetime of their
-- order. The existing order deletion and retention job are the only lifecycle
-- controls for a FlowTrack link.

create or replace function public.set_tracking_token()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tracking_token is null then
    new.tracking_token := gen_random_uuid();
  end if;

  return new;
end;
$$;

drop function if exists public.get_order_tracking(text);
create or replace function public.get_order_tracking(p_token text)
returns table(
  id uuid,
  client_name text,
  status text,
  payment_status text,
  created_at timestamptz,
  updated_at timestamptz,
  delivery_date text,
  order_type text,
  order_design_type text,
  cancellation_reason text,
  production_files jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id::uuid,
    o.client_name::text,
    o.status::text,
    o.payment_status::text,
    o.created_at::timestamptz,
    o.updated_at::timestamptz,
    o.delivery_date::text,
    o.order_type::text,
    o.order_design_type::text,
    o.cancellation_reason::text,
    coalesce(files.production_files, '[]'::jsonb) as production_files
  from public.orders o
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'file_index', indexed_files.file_index,
        'display_label',
          case
            when nullif(trim(indexed_files.public_label), '') is not null
              then nullif(trim(indexed_files.public_label), '')
            when indexed_files.total_count = 1 and nullif(trim(o.material), '') is not null
              then nullif(trim(o.material), '')
            else 'Parte ' || indexed_files.file_index || ' del pedido'
          end,
        'production_area_code', indexed_files.production_area_code,
        'production_area_label', coalesce(pa.label, 'Sin clasificar'),
        'status', indexed_files.status,
        'updated_at', indexed_files.updated_at,
        'completed_at', indexed_files.completed_at
      ) order by indexed_files.file_index
    ) as production_files
    from (
      select
        opf.production_area_code,
        opf.public_label,
        opf.status,
        opf.updated_at,
        opf.completed_at,
        row_number() over (order by opf.created_at, opf.id) as file_index,
        count(*) over () as total_count
      from public.order_production_files opf
      where opf.order_id = o.id
    ) indexed_files
    left join public.production_areas pa on pa.code = indexed_files.production_area_code
  ) files on true
  where o.tracking_token = case
      when p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then p_token::uuid
      else null
    end
  limit 1;
$$;

drop function if exists public.get_order_tracking_events(text);
create or replace function public.get_order_tracking_events(p_token text)
returns table(event_type text, new_status text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select e.event_type::text, e.new_status::text, e.created_at::timestamptz
  from public.order_events e
  inner join public.orders o on o.id = e.order_id
  where o.tracking_token = case
      when p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then p_token::uuid
      else null
    end
    and e.new_status is not null
  order by e.created_at asc;
$$;

revoke all on function public.get_order_tracking(text) from public;
revoke all on function public.get_order_tracking_events(text) from public;
grant execute on function public.get_order_tracking(text) to anon;
grant execute on function public.get_order_tracking_events(text) to anon;

-- Never allow active SVG or generic binary payloads in Storage. The upload
-- gateway additionally requires an allowed extension and declared MIME type.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif', 'image/tiff',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.rar', 'application/x-rar-compressed',
  'text/plain', 'text/csv', 'application/postscript',
  'application/illustrator', 'application/vnd.adobe.illustrator', 'image/vnd.adobe.photoshop'
]
where id = 'order-docs';
