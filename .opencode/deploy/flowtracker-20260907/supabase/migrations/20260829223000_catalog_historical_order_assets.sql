-- Catalog valid historic Supabase objects before clients resolve legacy URLs through
-- the signed asset gateway. This migration never changes buckets or source columns.
create or replace function public._decode_historical_asset_path(value text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  remaining text := value;
  encoded_match text[];
  match_position integer;
  decoded text := '';
begin
  while remaining <> '' loop
    encoded_match := regexp_match(remaining, '%(?:[0-9A-Fa-f]{2}%?)+');
    if encoded_match is null then
      return decoded || remaining;
    end if;
    match_position := position(encoded_match[1] in remaining);
    decoded := decoded || left(remaining, match_position - 1)
      || convert_from(decode(replace(encoded_match[1], '%', ''), 'hex'), 'UTF8');
    remaining := substring(remaining from match_position + length(encoded_match[1]));
  end loop;
  return decoded;
end;
$$;

with legacy_assets as (
  select o.id as order_id, o.created_by as uploaded_by, 'preview'::text as category, o.preview_image::text as asset_url, 1 as source_priority
  from public.orders o
  where nullif(trim(o.preview_image::text), '') is not null

  union all

  select o.id, o.created_by, 'reference'::text, trim(ref.value), 1
  from public.orders o
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(coalesce(o.reference_images, '[]'::jsonb)) = 'array'
      then coalesce(o.reference_images, '[]'::jsonb)
      else '[]'::jsonb
    end
  ) as ref(value)

  union all

  select o.id, o.created_by, 'reference'::text, o.reference_images #>> '{}', 1
  from public.orders o
  where jsonb_typeof(o.reference_images) = 'string'

  union all

  select o.id, o.created_by, 'design'::text, trim(file.url), 1
  from public.orders o
  cross join lateral public._production_file_urls_from_legacy(o.order_file_url::text) as file(url)

  union all

  select o.id, o.created_by, 'payment'::text, o.invoice_payment::text, 1
  from public.orders o
  where nullif(trim(o.invoice_payment::text), '') is not null

  union all

  select production_file.order_id, coalesce(production_file.created_by, order_row.created_by), 'production'::text, trim(production_file.url), 2
  from public.order_production_files production_file
  join public.orders order_row on order_row.id = production_file.order_id
  where nullif(trim(production_file.url), '') is not null
), normalized_assets as (
  select order_id, uploaded_by, category, source_priority, split_part(trim(both '"' from asset_url), '?', 1) as asset_url
  from legacy_assets
), parsed_assets as (
  select *, coalesce(
    regexp_match(asset_url, '^supabase://(order-docs|order-previews|payment-invoice)/(.*)$'),
    regexp_match(asset_url, '^https?://[^/]+/storage/v1/object/(?:public/|sign/|authenticated/)?(order-docs|order-previews|payment-invoice)/(.*)$')
  ) as asset_parts
  from normalized_assets
), valid_assets as (
  select
    order_id,
    uploaded_by,
    category,
    source_priority,
    asset_parts[1] as bucket,
    public._decode_historical_asset_path(asset_parts[2]) as object_key
  from parsed_assets
  where asset_parts is not null
    and asset_parts[2] <> ''
    and asset_parts[2] !~ '(^|/)\.\.(/|$)'
), order_scoped_assets as (
  select *
  from valid_assets
  where (
    category = 'preview'
    and bucket = 'order-previews'
    and object_key like 'orders/' || order_id::text || '/preview/%'
  ) or (
    category = 'reference'
    and bucket = 'order-docs'
    and object_key like 'orders/' || order_id::text || '/ref-images/%'
  ) or (
    category = 'design'
    and bucket = 'order-docs'
    and object_key like 'orders/' || order_id::text || '/files/%'
  ) or (
    category = 'payment'
    and bucket = 'payment-invoice'
    and object_key like order_id::text || '/%'
  ) or (
    category = 'production'
    and bucket = 'order-docs'
    and object_key like 'orders/' || order_id::text || '/%'
  )
), deduplicated_assets as (
  select *, row_number() over (
    partition by bucket, object_key
    order by source_priority, category
  ) as row_number
  from order_scoped_assets
)
insert into public.order_files (
  order_id,
  provider,
  bucket,
  object_key,
  original_filename,
  category,
  status,
  uploaded_by
)
select
  source.order_id,
  'supabase',
  source.bucket,
  source.object_key,
  nullif(regexp_replace(source.object_key, '^.*/', ''), ''),
  source.category,
  'uploaded',
  source.uploaded_by
from deduplicated_assets source
join storage.objects stored_object
  on stored_object.bucket_id = source.bucket
  and stored_object.name = source.object_key
where source.row_number = 1
on conflict (provider, bucket, object_key) do nothing;

drop function public._decode_historical_asset_path(text);
