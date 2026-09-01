-- P2: retain the Caja -> Produccion guard while allowing the already-validated
-- producer command to recalculate a permitted Terminacion -> Produccion return.
create or replace function public.guard_orders_direct_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.neonprint_order_command', true) is distinct from 'on'
     and not public.current_profile_is_admin()
     and (
       new.created_by is distinct from old.created_by or new.seller_id is distinct from old.seller_id
       or new.designer_id is distinct from old.designer_id or new.quote_id is distinct from old.quote_id
       or new.production_id is distinct from old.production_id or new.delivery_id is distinct from old.delivery_id
       or new.status is distinct from old.status or new.payment_status is distinct from old.payment_status
       or new.invoice_payment is distinct from old.invoice_payment or new.client_id is distinct from old.client_id
       or new.client_name is distinct from old.client_name or new.client_contact is distinct from old.client_contact
       or new.invoice_number is distinct from old.invoice_number or new.description is distinct from old.description
       or new.material is distinct from old.material or new.termination_type is distinct from old.termination_type
       or new.order_type is distinct from old.order_type or new.order_design_type is distinct from old.order_design_type
       or new.delivery_date is distinct from old.delivery_date or new.order_file_url is distinct from old.order_file_url
       or new.preview_image is distinct from old.preview_image or new.reference_images is distinct from old.reference_images
       or new.cancellation_reason is distinct from old.cancellation_reason or new.cancelled_from_status is distinct from old.cancelled_from_status
       or new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
       or new.return_reason is distinct from old.return_reason or new.returned_to_designer_at is distinct from old.returned_to_designer_at
       or new.delivery_note is distinct from old.delivery_note or new.operational_status is distinct from old.operational_status
       or new.blocked_reason_category is distinct from old.blocked_reason_category or new.blocked_reason_detail is distinct from old.blocked_reason_detail
       or new.blocked_owner_id is distinct from old.blocked_owner_id or new.blocked_by is distinct from old.blocked_by
       or new.blocked_at is distinct from old.blocked_at or new.blocked_expected_resolution_at is distinct from old.blocked_expected_resolution_at
       or new.commercial_review_required is distinct from old.commercial_review_required
       or new.status_changed_at is distinct from old.status_changed_at
       or new.last_admin_intervention_at is distinct from old.last_admin_intervention_at
       or new.last_admin_intervention_by is distinct from old.last_admin_intervention_by
       or new.last_admin_intervention_kind is distinct from old.last_admin_intervention_kind
       or new.is_archived is distinct from old.is_archived or new.is_archived_designer is distinct from old.is_archived_designer
       or new.is_archived_quote is distinct from old.is_archived_quote or new.is_archived_delivery is distinct from old.is_archived_delivery
       or new.is_archived_admin is distinct from old.is_archived_admin or new.updated_by is distinct from old.updated_by
     ) then raise exception 'ORDER_PROTECTED_UPDATE: usa un comando autorizado de la orden'; end if;

  -- A normal route to Produccion still originates in Caja. The sole exception
  -- is the producer-owned, previously validated file reversal, whose local
  -- command context is propagated into the recalculator in the same transaction.
  if new.status = 'in_Production'
     and old.status is distinct from 'in_Quote'
     and not (
       old.status = 'in_Termination'
       and current_setting('app.neonprint_order_command', true) = 'on'
     ) then
    raise exception 'La orden debe estar en Caja antes de enviarse a Produccion.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_orders_direct_update() from public, anon, authenticated;
