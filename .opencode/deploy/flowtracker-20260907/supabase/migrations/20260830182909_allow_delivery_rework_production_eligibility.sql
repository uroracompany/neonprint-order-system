-- Preserve the current production-entry eligibility checks. The only new path
-- is the already-authorized Delivery rework command returning a completed
-- order to production; payment and file-readiness checks remain unchanged.
create or replace function public.check_production_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  file_count integer;
  invalid_file_count integer;
begin
  if new.status = 'in_Production' and old.status is distinct from new.status then
    if old.status not in ('in_Quote', 'in_Termination')
       and not (
         old.status = 'in_Completed'
         and current_setting('app.neonprint_order_command', true) = 'delivery_rework'
       ) then
      raise exception 'La orden debe pasar por Caja antes de entrar a Produccion.';
    end if;
    if coalesce(new.payment_status, old.payment_status) not in ('pagado', 'parcial', 'credito') then
      raise exception 'Produccion requiere pago pagado, parcial o aprobado a credito.';
    end if;
    select
      count(*),
      count(*) filter (
        where opf.production_area_code is null
          or nullif(trim(coalesce(opf.public_label, '')), '') is null
          or pa.code is null
      )
    into file_count, invalid_file_count
    from public.order_production_files opf
    left join public.production_areas pa
      on pa.code = opf.production_area_code and pa.is_active = true
    where opf.order_id = new.id;
    if nullif(trim(coalesce(new.preview_image, '')), '') is null
      or file_count = 0 or invalid_file_count > 0 then
      raise exception 'La orden requiere imagen de trabajo y todos sus archivos clasificados antes de Produccion.';
    end if;
  end if;
  return new;
end;
$$;
