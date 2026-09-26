-- Permit the existing managed purge transaction to remove dependent production
-- files. Ordinary user-driven deletes remain protected by the last-file guard.
create or replace function public._admin_prevent_last_file_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_status text;
  v_file_count integer;
begin
  if coalesce(current_setting('app.order_purge_authorized', true), 'off') = 'on' then
    return old;
  end if;

  select status into v_order_status
  from public.orders
  where id = old.order_id;

  if v_order_status in ('Pending', 'in_Design', 'cancelled') then
    return old;
  end if;

  select count(*) into v_file_count
  from public.order_production_files
  where order_id = old.order_id
    and id <> old.id;

  if v_file_count = 0 then
    raise exception 'No se puede eliminar el unico archivo de areas. Debe cargar otro archivo antes de eliminar este.';
  end if;

  return old;
end;
$$;

revoke all on function public._admin_prevent_last_file_delete() from public, anon, authenticated;

comment on function public._admin_prevent_last_file_delete() is
  'Prevents deleting the last production file outside an explicitly authorized managed order purge.';
