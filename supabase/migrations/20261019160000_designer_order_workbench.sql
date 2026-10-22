-- Bounded, read-only workbench data for the authenticated designer.
-- Keep the explicit designer_id scope in addition to the existing RLS policy.
create or replace function public.designer_order_workbench(
  p_search text,
  p_order_type text,
  p_status text,
  p_created_from timestamptz,
  p_created_before timestamptz,
  p_client_id uuid,
  p_unlinked_client boolean,
  p_overdue_only boolean,
  p_archive text,
  p_page integer,
  p_page_size integer,
  p_edited_order_ids uuid[],
  p_pending_review_order_ids uuid[]
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 15), 1), 50);
  v_query text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.role = 'designer'
      and coalesce(p.employment_status, true) and p.deleted_at is null
  ) then
    raise exception 'Designer profile required' using errcode = '42501';
  end if;

  -- Escape LIKE metacharacters so search remains literal substring matching.
  v_query := replace(replace(replace(lower(trim(coalesce(p_search, ''))), chr(92), chr(92) || chr(92)), '%', chr(92) || '%'), '_', chr(92) || '_');

  with scoped as materialized (
    select
      o.id, o.client_id, o.client_name, o.client_contact, o.order_type,
      o.created_at, o.updated_at, o.updated_by, o.description, o.material,
      o.delivery_date, o.status, o.payment_status, o.order_design_type,
      o.production_authorized_at, o.production_authorized_by, o.operational_status,
      o.return_reason, o.returned_to_designer_at, o.order_file_url, o.preview_image,
      o.reference_images, o.designer_id, o.seller_id, o.created_by, o.tracking_token,
      o.is_archived_designer, o.quote_id, o.quantity,
      case lower(trim(coalesce(o.status, '')))
        when 'pending' then 'Pending' when 'pendiente' then 'Pending'
        when 'in_design' then 'in_Design' when 'in design' then 'in_Design'
        when 'diseño' then 'in_Design' when 'diseno' then 'in_Design'
        when 'in_quote' then 'in_Quote' when 'in_quotation' then 'in_Quote'
        when 'cotizacion' then 'in_Quote' when 'cotización' then 'in_Quote' when 'quote' then 'in_Quote'
        when 'en produccion' then 'in_Production' when 'en producción' then 'in_Production'
        when 'produccion' then 'in_Production' when 'producción' then 'in_Production' when 'in_production' then 'in_Production'
        when 'terminacion' then 'in_Termination' when 'terminación' then 'in_Termination' when 'in_termination' then 'in_Termination'
        when 'en entrega' then 'in_Delivered' when 'entregado' then 'in_Delivered'
        when 'entregada' then 'in_Delivered' when 'in_delivered' then 'in_Delivered'
        when 'completada' then 'in_Completed' when 'completado' then 'in_Completed'
        when 'completed' then 'in_Completed' when 'in_completed' then 'in_Completed'
        when 'cancelada' then 'cancelled' when 'cancelado' then 'cancelled' when 'cancelled' then 'cancelled'
        else coalesce(o.status, '')
      end as canonical_status
    from public.orders o
    where o.designer_id = (select auth.uid())
  ), filtered as materialized (
    select s.*
    from scoped s
    where
      (v_query = '' or lower(coalesce(s.client_name, '')) like '%' || v_query || '%' escape chr(92)
        or lower(coalesce(s.description, '')) like '%' || v_query || '%' escape chr(92)
        or lower(coalesce(s.material, '')) like '%' || v_query || '%' escape chr(92)
        or lower(s.id::text) like '%' || v_query || '%' escape chr(92))
      and (coalesce(p_order_type, 'all') = 'all'
        or (p_order_type = '911' and s.order_type = 'orden 911')
        or (p_order_type = 'normal' and s.order_type is distinct from 'orden 911'))
      and (coalesce(p_status, 'all') = 'all' or s.canonical_status = p_status)
      and (p_created_from is null or s.created_at >= p_created_from)
      and (p_created_before is null or s.created_at < p_created_before)
      and (p_unlinked_client is not true or s.client_id is null)
      and (p_unlinked_client is true or p_client_id is null or s.client_id = p_client_id)
      and (p_overdue_only is not true or (
        s.delivery_date < (now() at time zone 'America/Asuncion')::date
        and s.canonical_status not in ('in_Delivered', 'cancelled')
      ))
      and (coalesce(p_archive, 'all') = 'all'
        or (p_archive = 'active' and not coalesce(s.is_archived_designer, false))
        or (p_archive = 'archived' and coalesce(s.is_archived_designer, false))
        or (p_archive = 'cancelled' and s.canonical_status = 'cancelled')
        or (p_archive = 'returned' and s.canonical_status = 'in_Design' and length(trim(coalesce(s.return_reason, ''))) > 0))
  ), page_meta as (
    select least(v_page, greatest(1, ceil(count(*)::numeric / v_page_size)::integer)) as page
    from filtered
  ), paged as (
    select f.*
    from filtered f cross join page_meta pm
    order by f.created_at desc, f.id desc
    limit v_page_size offset ((select page from page_meta) - 1) * v_page_size
  ), page_rows as (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', p.id, 'client_id', p.client_id, 'client_name', p.client_name,
        'client_contact', p.client_contact, 'order_type', p.order_type,
        'created_at', p.created_at, 'updated_at', p.updated_at, 'updated_by', p.updated_by,
        'description', p.description, 'material', p.material, 'delivery_date', p.delivery_date,
        'status', p.status, 'payment_status', p.payment_status, 'order_design_type', p.order_design_type,
        'production_authorized_at', p.production_authorized_at, 'production_authorized_by', p.production_authorized_by,
        'operational_status', p.operational_status, 'return_reason', p.return_reason,
        'returned_to_designer_at', p.returned_to_designer_at, 'order_file_url', p.order_file_url,
        'preview_image', p.preview_image, 'reference_images', p.reference_images,
        'designer_id', p.designer_id, 'seller_id', p.seller_id, 'created_by', p.created_by,
        'tracking_token', p.tracking_token, 'is_archived_designer', p.is_archived_designer,
        'quote_id', p.quote_id, 'quantity', p.quantity,
        'order_production_files', coalesce((select jsonb_agg(jsonb_build_object(
          'id', pf.id, 'order_id', pf.order_id, 'url', pf.url, 'filename', pf.filename,
          'public_label', pf.public_label, 'production_area_code', pf.production_area_code,
          'material_names', pf.material_names, 'termination_name', pf.termination_name
        )) from public.order_production_files pf where pf.order_id = p.id), '[]'::jsonb),
        'order_files', coalesce((select jsonb_agg(jsonb_build_object(
          'id', ofile.id, 'provider', ofile.provider, 'bucket', ofile.bucket,
          'object_key', ofile.object_key, 'original_filename', ofile.original_filename,
          'content_type', ofile.content_type, 'category', ofile.category,
          'status', ofile.status, 'deleted_at', ofile.deleted_at, 'uploaded_by', ofile.uploaded_by
        )) from public.order_files ofile where ofile.order_id = p.id
          and ofile.status = 'uploaded' and ofile.deleted_at is null
          and ofile.category in ('design', 'production') and ofile.bucket <> 'payment-invoice'), '[]'::jsonb)
      ) order by p.created_at desc, p.id desc
    ), '[]'::jsonb) as orders
    from paged p
  ), counts as (
    select
      count(*)::integer as all_count,
      count(*) filter (where not coalesce(s.is_archived_designer, false) and s.canonical_status not in ('cancelled', 'in_Completed'))::integer as active_tab_count,
      count(*) filter (where coalesce(s.is_archived_designer, false))::integer as archived_count,
      count(*) filter (where s.canonical_status = 'cancelled')::integer as cancelled_count,
      count(*) filter (where s.canonical_status = 'in_Design' and length(trim(coalesce(s.return_reason, ''))) > 0)::integer as returned_count,
      count(*) filter (where not coalesce(s.is_archived_designer, false) and s.canonical_status = 'in_Design' and length(trim(coalesce(s.return_reason, ''))) > 0)::integer as returned_active,
      count(*) filter (where not coalesce(s.is_archived_designer, false) and s.canonical_status not in ('cancelled', 'in_Completed'))::integer as active_metric,
      count(*) filter (where s.canonical_status = 'in_Quote')::integer as quote_count,
      count(*) filter (where s.canonical_status = 'in_Production')::integer as production_count,
      count(*) filter (where not coalesce(s.is_archived_designer, false) and s.canonical_status not in ('cancelled', 'in_Completed')
        and s.id = any(coalesce(p_edited_order_ids, '{}'::uuid[]))
        and s.updated_by is distinct from v_uid
        and not (s.id = any(coalesce(p_pending_review_order_ids, '{}'::uuid[]))))::integer as edited_count,
      count(*) filter (where not coalesce(s.is_archived_designer, false) and s.canonical_status not in ('cancelled', 'in_Completed')
        and exists (select 1 from public.order_assignment_receipts r
          where r.order_id = s.id and r.user_id = v_uid and r.assignment_module = 'design'
            and r.assignment_source <> 'production_file_transfer' and r.seen_at is null))::integer as new_count
    from scoped s
  ), options as (
    select coalesce(jsonb_agg(jsonb_build_object('id', c.client_id, 'name', c.client_name) order by c.client_name), '[]'::jsonb) as clients
    from (select client_id, max(client_name) as client_name from scoped where client_id is not null group by client_id) c
  )
  select jsonb_build_object(
    'orders', page_rows.orders,
    'totalCount', (select count(*) from filtered),
    'page', (select page from page_meta),
    'pageSize', v_page_size,
    'totalPages', greatest(1, ceil((select count(*)::numeric from filtered) / v_page_size)::integer),
    'counts', jsonb_build_object(
      'all', counts.all_count, 'active', counts.active_tab_count, 'archived', counts.archived_count,
      'cancelled', counts.cancelled_count, 'returned', counts.returned_count,
      'returnedActive', counts.returned_active,
      'activeMetric', counts.active_metric, 'quote', counts.quote_count,
      'production', counts.production_count, 'new', counts.new_count, 'edited', counts.edited_count
    ),
    'clientOptions', options.clients
  ) into v_result
  from page_rows, counts, options;

  return v_result;
end;
$$;

revoke all on function public.designer_order_workbench(text, text, text, timestamptz, timestamptz, uuid, boolean, boolean, text, integer, integer, uuid[], uuid[]) from public, anon;
grant execute on function public.designer_order_workbench(text, text, text, timestamptz, timestamptz, uuid, boolean, boolean, text, integer, integer, uuid[], uuid[]) to authenticated;
