-- Expose sanitized production-file progress in the public FlowTrack RPC.
-- This keeps direct table access private and avoids leaking URLs, filenames or assignees.

alter table public.order_production_files
  add column if not exists public_label text;

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
      )
      order by indexed_files.file_index
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
    left join public.production_areas pa
      on pa.code = indexed_files.production_area_code
  ) files on true
  where o.tracking_token = p_token::uuid
  limit 1;
$$;

grant execute on function public.get_order_tracking(text) to anon;
