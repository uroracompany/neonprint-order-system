-- Do not emit audit events or refresh a parent order while an explicitly
-- authorized transaction is cascading that same order's deletion.
-- The normal triggers remain unchanged for every other operation.

drop trigger if exists trg_order_production_files_audit on public.order_production_files;
create trigger trg_order_production_files_audit
  after insert or update or delete on public.order_production_files
  for each row
  when (coalesce(current_setting('app.order_purge_authorized', true), 'off') <> 'on')
  execute function public.handle_order_production_files_audit();

drop trigger if exists trg_order_production_assignments_audit on public.order_production_assignments;
create trigger trg_order_production_assignments_audit
  after insert or update or delete on public.order_production_assignments
  for each row
  when (coalesce(current_setting('app.order_purge_authorized', true), 'off') <> 'on')
  execute function public.handle_order_production_assignments_audit();

drop trigger if exists trg_refresh_order_file_specification_summary on public.order_production_files;
create trigger trg_refresh_order_file_specification_summary
  after insert or delete or update of material_names, termination_name on public.order_production_files
  for each row
  when (coalesce(current_setting('app.order_purge_authorized', true), 'off') <> 'on')
  execute function public.refresh_order_file_specification_summary_trigger();
