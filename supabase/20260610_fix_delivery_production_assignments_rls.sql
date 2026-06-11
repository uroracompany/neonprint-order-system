-- Delivery module needs to read order_production_assignments to show
-- which production users are involved in an order (modal traceability).
-- The existing policy only allows admin or the assigned producer.
-- Mirror the same delivery exception already present in order_production_files.

drop policy if exists order_production_assignments_select_assigned
  on public.order_production_assignments;

create policy order_production_assignments_select_assigned
  on public.order_production_assignments for select
  to authenticated
  using (
    public.current_profile_is_admin()
    or assigned_to = auth.uid()
    or exists (
      select 1
      from public.orders o
      where o.id = order_production_assignments.order_id
        and (
          auth.uid() in (o.created_by, o.seller_id, o.designer_id, o.quote_id, o.delivery_id)
          or (public.current_profile_role() = 'delivery'
              and o.status in ('in_Completed', 'in_Delivered'))
        )
    )
  );
