-- Preserve delivery_id when order transitions to in_Completed
-- The delivery user should be assigned BEFORE completing production,
-- so clearing delivery_id at this point breaks the flow.
-- Delivery assignment now happens inside the "complete last file" flow.

create or replace function public.recalculate_order_production_status(p_order_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  total_count integer;
  completed_count integer;
  ready_count integer;
  next_status text;
begin
  select
    count(*) filter (where production_area_code is not null),
    count(*) filter (where production_area_code is not null and status = 'completed'),
    count(*) filter (where production_area_code is not null and status in ('in_termination', 'completed'))
  into total_count, completed_count, ready_count
  from public.order_production_files
  where order_id = p_order_id;

  if total_count = 0 then
    select status into next_status from public.orders where id = p_order_id;
    return next_status;
  end if;

  if completed_count = total_count then
    next_status := 'in_Completed';
  elsif ready_count = total_count then
    next_status := 'in_Termination';
  else
    next_status := 'in_Production';
  end if;

  update public.orders
  set status = next_status,
      updated_at = now()
  where id = p_order_id
    and status not in ('cancelled', 'in_Delivered');

  return next_status;
end;
$$;

revoke all on function public.recalculate_order_production_status(uuid) from public, anon;
grant execute on function public.recalculate_order_production_status(uuid) to authenticated;
