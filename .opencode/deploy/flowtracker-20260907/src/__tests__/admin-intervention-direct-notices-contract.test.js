/* global process */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

const migration = read("supabase/migrations/20260828150000_admin_intervention_direct_notices.sql");
const hook = read("src/hooks/useOrderEventReviews.js");
const alert = read("src/components/orders/AdminInterventionAlert.jsx");
const modal = read("src/components/orders/AdminInterventionNoticeModal.jsx");
const css = read("src/components/orders/AdminInterventionNoticeModal.css");
const notificationsHook = read("src/hooks/useNotifications.js");

describe("direct administrative intervention notices", () => {
  it("resolves a seller reassignment to the incoming and outgoing seller only", () => {
    expect(migration).toContain("p_new.seller_id, 'assignment_received', 'action_required', true, 'seller'");
    expect(migration).toContain("p_old.seller_id, 'assignment_removed', 'important', false, 'seller'");
    expect(migration).toContain("p_new.seller_id is distinct from p_old.seller_id");
    expect(migration).toContain("p_old.seller_id is not null");
    expect(migration).not.toContain("coalesce(p_old.seller_id, p_old.created_by)");
  });

  it("does not disclose stage changes to retained historical assignees", () => {
    expect(migration).toContain("with active_context as");
    expect(migration).toContain("case when p_action = 'cancel_order' then p_old.status else p_new.status end as status");
    expect(migration).toContain("c.status = 'Pending'");
    expect(migration).toContain("c.status = 'in_Design'");
    expect(migration).toContain("c.status = 'in_Quote'");
    expect(migration).toContain("c.status in ('in_Production', 'in_Termination')");
    expect(migration).not.toContain("unnest(array[p_new.seller_id, p_new.designer_id, p_new.quote_id, p_new.delivery_id])");
  });

  it("keeps one audit event but writes recipient-specific, deduplicated notices", () => {
    expect(migration).toContain("create or replace function public.write_admin_intervention_notice");
    expect(migration).toContain("on conflict (order_event_id, user_id) do update");
    expect(migration).toContain("'event_kind', 'admin_intervention_notice'");
    expect(migration).toContain("Hola, ' || v_name");
    expect(migration).toContain("Administración te asignó como responsable");
    expect(migration).toContain("Ya no eres responsable de ella.");
  });

  it("uses a review-level acknowledgement instead of acknowledging an entire order", () => {
    expect(migration).toContain("create or replace function public.acknowledge_order_event_review(p_review_id uuid)");
    expect(migration).toContain("where id = p_review_id and user_id = v_user_id");
    expect(hook).toContain('supabase.rpc("acknowledge_order_event_review"');
    expect(hook).toContain("pendingNotices");
    expect(alert).toContain("reviews.acknowledgeReview(pending.id)");
  });

  it("keeps operational notices out of the technical review cards", () => {
    expect(hook).toContain('reviews.filter((review) => review.event_key !== "admin_intervention_notice")');
    expect(hook).toContain('review.event_key === "admin_intervention_notice" && review.metadata?.requires_ack === true');
  });

  it("notifies the person resuming a returned stage and scopes production reassignment to its file", () => {
    expect(migration).toContain("p_new.status = 'in_Design' and p_new.status is distinct from p_old.status");
    expect(migration).toContain("p_new.status = 'in_Quote' and p_new.status is distinct from p_old.status");
    expect(migration).toContain("p_new.status = 'in_Completed' and p_new.status is distinct from p_old.status");
    expect(migration).toContain("item->>'field' = 'production_file_assignment'");
    expect(migration).toContain("item->>'new_assigned_to'");
    expect(migration).toContain("item->>'old_assigned_to'");
    expect(migration).not.toContain("'route_production', 'reassign_production', 'production_file_status'");
  });

  it("does not send the old generic reactivation notification to the actor", () => {
    expect(migration).toContain("create or replace function public.admin_execute_order_command(");
    expect(migration).not.toContain("array[v_actor]");
  });

  it("routes credit and file reassignment through the central emitter", () => {
    expect(migration).toContain("create or replace function public.mark_order_as_credit(");
    expect(migration).toContain("perform public.record_admin_intervention(v_old, v_new, 'register_payment'");
    expect(migration).toContain("create or replace function public.admin_reassign_file_production_area(");
    expect(migration).toContain("'reassign_production', 'assignment_correction'");
    expect(migration).toContain("in ('file_reassignment', 'file_assigned')");
    expect(migration).toContain("p_action = 'design_assets_updated' and p_new.status = 'in_Design'");
    expect(migration).toContain("and coalesce(p.employment_status, true) and p.deleted_at is null");
  });

  it("preserves the owner of a removed production file for the direct notice", () => {
    expect(migration).toContain("create or replace function public.admin_remove_production_file(");
    expect(migration).toContain("'production_file_removed', 'workflow_correction'");
    expect(migration).toContain("'old_assigned_to', v_file.assigned_to");
    expect(migration).toContain("'field', 'production_file_assignment'");
    expect(migration).toContain("perform public.enqueue_admin_order_asset_deletion(v_file.order_id, v_file.url, 'order-docs');");
    expect(migration).not.toContain("public.order_asset_cleanup_queue");
  });

  it("only suppresses trigger notifications from the same administrative actor", () => {
    expect(migration).toContain("metadata->>'actor_id' = v_actor_id::text");
    expect(migration).toContain("metadata->>'actor_id' = v_actor::text");
    expect(migration).toContain("coalesce(metadata->>'event_kind', '') <> 'admin_intervention_notice'");
  });

  it("keeps informational notices in the inbox without a toast", () => {
    expect(notificationsHook).toContain('!notification?.metadata?.priority || notification.metadata.priority === "important"');
    expect(notificationsHook).toContain("filter(shouldShowToast).forEach");
    expect(notificationsHook).toContain("if (shouldShowToast(newNotif)) enqueueToast");
  });

  it("renders a reusable, concise and accessible operational modal", () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain("const title = notice?.label");
    expect(modal).toContain("Ver orden");
    expect(modal).toContain("const acknowledged = await onAcknowledge()");
    expect(modal).toContain("Entendido");
    expect(css).toContain("border-radius: 22px");
    expect(css).toContain("#0f1e40");
    expect(css).toContain("prefers-reduced-motion");
  });
});
