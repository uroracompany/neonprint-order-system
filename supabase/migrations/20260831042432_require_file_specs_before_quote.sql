-- The Design UI blocks incomplete files, but Caja must enforce the same rule
-- when the state transition is invoked outside the browser.
create or replace function public.designer_send_order_to_quote(
  p_order_id uuid,
  p_quote_id uuid
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_file_urls jsonb;
begin
  if v_actor is null or not exists (
    select 1
    from public.profiles p
    where p.id = v_actor
      and p.role = 'designer'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Solo Diseno activo puede enviar a Caja';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
     or v_order.designer_id is distinct from v_actor
     or v_order.status <> 'in_Design'
     or coalesce(v_order.is_archived, false)
     or coalesce(v_order.is_archived_designer, false) then
    raise exception 'La orden no esta disponible en Diseno';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_quote_id
      and p.role = 'quote'
      and coalesce(p.employment_status, true)
      and p.deleted_at is null
  ) then
    raise exception 'Caja no disponible';
  end if;

  if nullif(trim(coalesce(v_order.preview_image, '')), '') is null
     or not exists (
       select 1
       from public.order_files f
       where f.order_id = p_order_id
         and f.category = 'preview'
         and f.status = 'uploaded'
         and f.deleted_at is null
         and f.bucket = 'order-previews'
         and f.object_key like ('orders/' || p_order_id::text || '/preview/%')
         and (
           ('r2://' || f.bucket || '/' || f.object_key) = v_order.preview_image
           or ('supabase://' || f.bucket || '/' || f.object_key) = v_order.preview_image
           or (
             f.provider = 'supabase'
             and f.object_key = regexp_replace(
               v_order.preview_image,
               '^https?://[^/]+/storage/v1/object/(?:public|sign)/order-previews/([^?]+).*$',
                '\1'
             )
           )
         )
     ) then
    raise exception 'Falta una orden de trabajo valida. Adjuntala antes de enviar a Caja.';
  end if;

  v_file_urls := case
    when nullif(trim(coalesce(v_order.order_file_url, '')), '') is null then '[]'::jsonb
    when left(trim(v_order.order_file_url), 1) = '[' then v_order.order_file_url::jsonb
    else jsonb_build_array(v_order.order_file_url)
  end;
  if jsonb_typeof(v_file_urls) <> 'array'
     or not exists (
       select 1
       from jsonb_array_elements_text(v_file_urls) item(value)
       join public.order_production_files pf
         on pf.order_id = p_order_id
        and pf.url = item.value
       join public.order_files f
         on f.order_id = p_order_id
        and f.category = 'design'
        and f.status = 'uploaded'
        and f.deleted_at is null
        and (
          f.id = pf.order_file_id
          or ('r2://' || f.bucket || '/' || f.object_key) = pf.url
          or ('supabase://' || f.bucket || '/' || f.object_key) = pf.url
        )
     ) then
    raise exception 'Falta un archivo de diseno valido. Adjuntalo antes de enviar a Caja.';
  end if;

  if exists (
    select 1
    from public.order_production_files pf
    where pf.order_id = p_order_id
      and (
        nullif(trim(coalesce(pf.public_label, '')), '') is null
        or nullif(trim(coalesce(pf.production_area_code, '')), '') is null
        or not exists (
          select 1
          from unnest(coalesce(pf.material_names, '{}'::text[])) as material(name)
          where nullif(trim(material.name), '') is not null
        )
        or nullif(trim(coalesce(pf.termination_name, '')), '') is null
      )
  ) then
    raise exception 'Cada archivo debe tener nombre visible, área, materiales y terminación antes de enviar a Caja.';
  end if;

  perform set_config('app.neonprint_order_command', 'on', true);
  update public.orders
  set status = 'in_Quote',
      quote_id = p_quote_id,
      return_reason = null,
      returned_to_designer_at = null,
      updated_at = now(),
      updated_by = v_actor
  where id = p_order_id
  returning * into v_updated;

  return v_updated;
end;
$$;

revoke all on function public.designer_send_order_to_quote(uuid, uuid) from public, anon;
grant execute on function public.designer_send_order_to_quote(uuid, uuid) to authenticated;
