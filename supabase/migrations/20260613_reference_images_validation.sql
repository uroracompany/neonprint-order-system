-- Backend validation for reference_images
-- Defense-in-depth: rejects orders with more than 3 reference images
-- The frontend also validates before upload.

create or replace function public.validate_order_reference_images()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ref_count integer;
begin
  if new.reference_images is not null then
    ref_count := jsonb_array_length(new.reference_images);

    if ref_count > 3 then
      raise exception 'Solo se permiten hasta 3 imagenes de referencia por orden.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_validate_order_reference_images on public.orders;

create trigger trg_validate_order_reference_images
  before insert or update of reference_images on public.orders
  for each row
  execute function public.validate_order_reference_images();
