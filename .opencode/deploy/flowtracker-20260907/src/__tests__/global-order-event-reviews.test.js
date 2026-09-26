/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("global order event reviews", () => {
  it("adds a centralized review queue for order changes", () => {
    const migration = readProjectFile("supabase/migrations/20260626010000_global_order_event_reviews.sql");

    expect(migration).toContain("create table if not exists public.order_event_reviews");
    expect(migration).toContain("order_event_id uuid not null references public.order_events(id)");
    expect(migration).toContain("reviewed_at timestamptz");
    expect(migration).toContain("alter publication supabase_realtime add table public.order_event_reviews");
    expect(migration).toContain("create or replace function public.mark_order_events_reviewed");
    expect(migration).toContain("grant execute on function public.mark_order_events_reviewed(uuid) to authenticated");
  });

  it("records admin edits with the exact seller review label", () => {
    const migration = readProjectFile("supabase/migrations/20260626010000_global_order_event_reviews.sql");

    expect(migration).toContain("create or replace function public.handle_admin_order_edit_review");
    expect(migration).toContain("'admin_edited_order'");
    expect(migration).toContain("'Editada por admin'");
    expect(migration).toContain("public.order_business_changed_fields(old, new)");
    expect(migration).toContain("new.order_code::text");
    expect(migration).toContain("drop trigger if exists trg_admin_order_edit_review on public.orders");
  });

  it("audits file and production assignment mutations from design and production modules", () => {
    const migration = readProjectFile("supabase/migrations/20260626010000_global_order_event_reviews.sql");

    expect(migration).toContain("create or replace function public.handle_order_production_files_audit");
    expect(migration).toContain("after insert or update or delete on public.order_production_files");
    expect(migration).toContain("'design_file_added'");
    expect(migration).toContain("'production_file_status_changed'");
    expect(migration).toContain("create or replace function public.handle_order_production_assignments_audit");
    expect(migration).toContain("after insert or update or delete on public.order_production_assignments");
  });

  it("connects seller UI badges to pending order reviews", () => {
    const sellerPage = readProjectFile("src/pages/pages-seller.jsx");
    const detailModal = readProjectFile("src/components/orders/OrderDetailModal.jsx");
    const reviewCard = readProjectFile("src/components/orders/OrderReviewCard.jsx");
    const sellerCss = readProjectFile("src/css-components/page-seller.css");

    expect(sellerPage).toContain("useOrderEventReviews");
    expect(sellerPage).toContain("OrderReviewBadge");
    expect(sellerPage).toContain("pendingReview={selectedOrderReview}");
    expect(detailModal).toContain("pendingReview = null");
    expect(reviewCard).toContain("Cambios pendientes");
    expect(reviewCard).toContain("Entendido");
    expect(sellerCss).toContain(".ps-order-review-badge");
  });

  it("unifies durable reviews for every assigned module", () => {
    const migration = readProjectFile("supabase/migrations/20260627150918_unify_admin_order_review_history.sql");
    const designer = readProjectFile("src/pages/page-designer.jsx");
    const production = readProjectFile("src/pages/page-production.jsx");
    const quote = readProjectFile("src/pages/page-quote.jsx");

    expect(migration).toContain("on conflict (order_event_id, user_id) do update");
    expect(migration).toContain("'old_value', old_value");
    expect(migration).toContain("'new_value', new_value");
    expect(migration).toContain("public.order_cashier_quote_recipients(new_row)");
    expect(migration).toContain("backfilled_from_notifications");
    expect(migration).toContain("admin_order_edit_area_notice");
    expect(migration).toContain("create or replace function public.mark_order_events_reviewed");
    expect(migration).toContain("'Editada por Admin'");
    expect(designer).toContain("useOrderEventReviews");
    expect(production).toContain("useOrderEventReviews");
    expect(quote).toContain("useOrderEventReviews");
  });

  it("adds targeted admin edit notice notifications without replacing the review flow", () => {
    const migration = readProjectFile("supabase/migrations/20260626023000_admin_order_edit_area_notice_notifications.sql");

    expect(migration).toContain("create or replace function public.notify_admin_order_edit_area_alerts");
    expect(migration).toContain("'admin_order_edit_area_notice'");
    expect(migration).toContain("perform public.create_order_event_reviews");
    expect(migration).toContain("'Editada por admin'");
    expect(migration).toContain("perform public.notify_admin_order_edit_area_alerts");
    expect(migration).toContain("public.admin_order_edit_area_for_field(field_name, new_row.status)");
    expect(migration).toContain("'El administrador cambio el estado de pago de la orden #'");
    expect(migration).toContain("'El administrador modifico archivos de la orden #'");
    expect(migration).toContain("'deep_link', '/dashboard?order=' || new_row.id::text");
  });

  it("tracks admin edits to dates and order assets as distinct notification fields", () => {
    const reviewMigration = readProjectFile("supabase/migrations/20260626010000_global_order_event_reviews.sql");
    const noticeMigration = readProjectFile("supabase/migrations/20260626023000_admin_order_edit_area_notice_notifications.sql");

    expect(reviewMigration).toContain("old_row.delivery_date is distinct from new_row.delivery_date");
    expect(reviewMigration).toContain("'field', 'delivery_date', 'label', 'Fecha de entrega'");
    expect(reviewMigration).toContain("old_row.order_file_url is distinct from new_row.order_file_url");
    expect(reviewMigration).toContain("'field', 'order_file_url', 'label', 'Archivos adjuntos'");
    expect(reviewMigration).toContain("old_row.preview_image is distinct from new_row.preview_image");
    expect(reviewMigration).toContain("'field', 'preview_image', 'label', 'Imagen de preview'");
    expect(reviewMigration).toContain("old_row.reference_images is distinct from new_row.reference_images");
    expect(reviewMigration).toContain("'field', 'reference_images', 'label', 'Imagenes de referencia'");

    expect(noticeMigration).toContain("p_field in ('files', 'order_file_url', 'preview_image', 'reference_images')");
    expect(noticeMigration).toContain("when p_field = 'order_file_url'");
    expect(noticeMigration).toContain("when p_field = 'preview_image'");
    expect(noticeMigration).toContain("when p_field = 'reference_images'");
  });

  it("keeps seller recipients on area-specific admin edit notices", () => {
    const migration = readProjectFile("supabase/migrations/20260626162000_fix_seller_admin_edit_notifications.sql");

    expect(migration).toContain("create or replace function public.admin_order_edit_notice_recipients");
    expect(migration).toContain("base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]");
    expect(migration).toContain("recipients := base_recipients");
    expect(migration).toContain("|| public.order_cashier_quote_recipients(p_order)");
    expect(migration).toContain("|| public.admin_order_edit_production_recipients(p_order)");
    expect(migration).toContain("|| array[p_order.delivery_id]");
  });

  it("syncs admin edit notifications to assigned design without duplicate recipients", () => {
    const migration = readProjectFile("supabase/migrations/20260626180000_sync_admin_edit_notifications_to_design.sql");

    expect(migration).toContain("create or replace function public.admin_order_edit_notice_recipients");
    expect(migration).toContain("base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]");
    expect(migration).toContain("recipients := base_recipients || public.get_role_user_ids('designer')");
    expect(migration).toContain("recipients := base_recipients;");
    expect(migration).toContain("array_agg(distinct recipient_id)");
    expect(migration).toContain("recipient_id is distinct from p_actor_id");
  });

  it("syncs admin edit notifications only to assigned or participating production users", () => {
    const migration = readProjectFile("supabase/migrations/20260626183000_sync_admin_edit_notifications_to_production.sql");

    expect(migration).toContain("create or replace function public.admin_order_edit_production_recipients");
    expect(migration).toContain("from public.order_production_assignments opa");
    expect(migration).toContain("from public.order_production_files opf");
    expect(migration).toContain("on p.id = opa.assigned_to");
    expect(migration).toContain("on p.id = opf.assigned_to");
    expect(migration).toContain("p.role = pa.producer_role");
    expect(migration).toContain("pa.is_active = true");
    expect(migration).toContain("base_recipients uuid[] := array[p_order.seller_id, p_order.created_by, p_order.designer_id]");
    expect(migration).toContain("|| public.admin_order_edit_production_recipients(p_order)");
    expect(migration).toContain("array_agg(distinct recipient_id)");
    expect(migration).not.toContain("public.get_role_user_ids('digital_producer')");
    expect(migration).not.toContain("public.get_role_user_ids('dtf_producer')");
    expect(migration).not.toContain("public.get_role_user_ids('ploteo_producer')");
  });

  it("routes payment notifications to related cashier or quote users only", () => {
    const migration = readProjectFile("supabase/migrations/20260626190000_sync_payment_notifications_to_cashier_quote.sql");

    expect(migration).toContain("create or replace function public.order_cashier_quote_recipients");
    expect(migration).toContain("p.id = p_order.quote_id");
    expect(migration).toContain("p.role = 'quote'");
    expect(migration).toContain("coalesce(p.employment_status, true) = true");
    expect(migration).toContain("public.order_cashier_quote_recipients(p_order)");
    expect(migration).toContain("public.order_cashier_quote_recipients(new)");
    expect(migration).toContain("new.invoice_payment is distinct from old.invoice_payment");
    expect(migration).toContain("public.order_cashier_quote_recipients(v_updated_order)");
    expect(migration).toContain("where o.id = any(v_settled_order_ids)");
    expect(migration).toContain("array_agg(distinct recipient_id)");
    expect(migration).not.toContain("public.get_role_user_ids('quote')");
    expect(migration).not.toContain("array_remove\\(quote_recipients \\|\\|");
  });

  it("does not emit duplicate generic seller toasts for admin edits", () => {
    const migration = readProjectFile("supabase/migrations/20260626173000_deduplicate_seller_admin_edit_toasts.sql");
    const sellerPage = readProjectFile("src/pages/pages-seller.jsx");

    expect(migration).toContain("create or replace function public.handle_admin_order_edit_review");
    expect(migration).toContain("perform public.create_order_event_reviews");
    expect(migration).toContain("perform public.notify_admin_order_edit_area_alerts");
    expect(migration).not.toContain("'Orden editada por admin'");
    expect(migration).not.toContain("'La orden #' || order_label || ' fue actualizada por administracion.'");
    expect(sellerPage).toContain('"admin_edited_order"');
  });

  it("cleans up already-created generic admin edit notifications", () => {
    const migration = readProjectFile("supabase/migrations/20260626174500_cleanup_generic_admin_edit_notifications.sql");

    expect(migration).toContain("update public.notifications");
    expect(migration).toContain("metadata->>'event_kind' = 'admin_edited_order'");
    expect(migration).toContain("set deleted_at = now()");
    expect(migration).toContain("and deleted_at is null");
  });
});
