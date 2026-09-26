-- Hide generic admin edit notifications that were replaced by field-specific
-- admin_order_edit_area_notice notifications. Review badges remain in
-- order_event_reviews.

update public.notifications
set deleted_at = now()
where metadata->>'event_kind' = 'admin_edited_order'
  and deleted_at is null
  and coalesce(is_archived, false) = false;
