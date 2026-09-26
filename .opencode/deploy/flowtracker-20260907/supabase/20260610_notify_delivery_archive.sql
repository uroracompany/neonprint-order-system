-- Migration: Add archive notification for Delivery module
-- 2026-06-10
-- Description: When an order's is_archived_delivery field changes, create a
-- notification via a dedicated trigger (same pattern as Seller/Admin/Designer/Quote).
-- Production module uses a separate RPC + order_production_user_archives table,
-- so its notification is handled in the frontend instead.

create or replace function public.notify_order_delivery_archive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
begin
  if new.is_archived_delivery is distinct from old.is_archived_delivery then
    meta := jsonb_build_object(
      'status', new.status,
      'payment_status', new.payment_status,
      'client_name', new.client_name,
      'order_type', new.order_type,
      'order_design_type', new.order_design_type,
      'actor_id', auth.uid()
    );

    perform public.notify_many(
      array_remove(array[auth.uid(), new.seller_id, new.created_by] || public.get_admin_user_ids(), null),
      'order_archived',
      'Orden archivada',
      'Orden de ' || coalesce(new.client_name, 'cliente') || ' archivada correctamente.',
      new.id,
      meta || jsonb_build_object('event_kind', 'order_archived')
    );
  end if;

  return new;
end;
$$;

create trigger trg_order_delivery_archive_notification
  after update of is_archived_delivery on public.orders
  for each row
  execute function public.notify_order_delivery_archive();

