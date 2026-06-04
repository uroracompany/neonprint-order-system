-- Version reference image URLs as structured order data.
-- Supports legacy text values that were stored as JSON strings or direct URLs.

create or replace function public._normalize_order_asset_urls_jsonb(p_value text)
returns jsonb
language plpgsql
immutable
as $$
declare
  parsed jsonb;
  cleaned text := nullif(trim(coalesce(p_value, '')), '');
begin
  if cleaned is null then
    return '[]'::jsonb;
  end if;

  begin
    parsed := cleaned::jsonb;

    if jsonb_typeof(parsed) = 'array' then
      return coalesce(
        (
          select jsonb_agg(to_jsonb(url))
          from (
            select
              case
                when jsonb_typeof(value) = 'string' then trim(value #>> '{}')
                when jsonb_typeof(value) = 'object' then trim(coalesce(value->>'url', ''))
                else ''
              end as url
            from jsonb_array_elements(parsed) item(value)
          ) normalized
          where length(url) > 0
        ),
        '[]'::jsonb
      );
    end if;

    if jsonb_typeof(parsed) = 'object' and length(trim(coalesce(parsed->>'url', ''))) > 0 then
      return jsonb_build_array(parsed->>'url');
    end if;

    if jsonb_typeof(parsed) = 'string' and length(trim(parsed #>> '{}')) > 0 then
      return jsonb_build_array(parsed #>> '{}');
    end if;
  exception
    when others then
      return jsonb_build_array(cleaned);
  end;

  return '[]'::jsonb;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'reference_images'
  ) then
    alter table public.orders
      add column reference_images jsonb not null default '[]'::jsonb;
  elsif exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'reference_images'
      and data_type <> 'jsonb'
  ) then
    alter table public.orders
      alter column reference_images drop default;

    alter table public.orders
      alter column reference_images type jsonb
      using public._normalize_order_asset_urls_jsonb(reference_images::text);

    update public.orders
    set reference_images = '[]'::jsonb
    where reference_images is null;

    alter table public.orders
      alter column reference_images set default '[]'::jsonb,
      alter column reference_images set not null;
  else
    update public.orders
    set reference_images = '[]'::jsonb
    where reference_images is null;

    alter table public.orders
      alter column reference_images set default '[]'::jsonb,
      alter column reference_images set not null;
  end if;
end $$;

drop function public._normalize_order_asset_urls_jsonb(text);
