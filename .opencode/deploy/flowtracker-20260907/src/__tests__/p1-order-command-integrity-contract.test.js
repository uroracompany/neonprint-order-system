import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("P1 critical order integrity contract", () => {
  const migration = read("supabase/migrations/20260826193000_p1_order_command_integrity.sql");
  const retentionRemediation = read("supabase/migrations/20260827003000_p2_purge_claim_and_order_guard_remediation.sql");
  const deliveryNoteSchema = read("supabase/migrations/20260827023000_add_missing_orders_delivery_note.sql");
  const sellerHandler = read("server/seller-order-actions-handler.js");
  const purgeFunction = read("supabase/functions/purge-old-orders/index.ts");

  it("routes seller mutations through authenticated versioned commands", () => {
    expect(sellerHandler).toContain("buildAuthenticatedSupabase(auth, env)");
    expect(sellerHandler).toContain("seller_update_order_with_files");
    expect(sellerHandler).toContain("seller_send_order_to_quote");
    expect(sellerHandler).not.toContain("updateOwnedOrder(");
    expect(migration).toContain("revoke update on public.orders from authenticated, anon");
    expect(migration).toContain("p_expected_updated_at timestamptz");
    expect(migration).toContain("grant execute on function public.seller_update_order(uuid,timestamptz,jsonb)");
    expect(migration).toContain("public.designer_send_order_to_quote(uuid,uuid)");
    expect(migration).toContain("public.delivery_mark_order_delivered(uuid,text)");
  });

  it("makes credit and creation stateful, versioned commands", () => {
    expect(migration).toContain("v_order.status <> 'in_Quote'");
    expect(migration).toContain("v_order.payment_status <> 'Pending_Payment'");
    expect(migration).toContain("order_creation_commands");
    expect(migration).toContain("unique(actor_id,idempotency_key)");
    expect(migration).toContain("ORDER_IDEMPOTENCY_CONFLICT");
    expect(migration).toContain("insert into public.order_files");
  });

  it("purges only from a durable claim manifest", () => {
    expect(migration).toContain("claim_old_orders_for_purge");
    expect(migration).toContain("record_order_purge_storage_result");
    expect(migration).toContain("purge_claimed_order_after_storage");
    expect(purgeFunction).toContain("claim_old_orders_for_purge");
    expect(purgeFunction).toContain("claim.asset_manifest");
    expect(purgeFunction).not.toContain('.from("order_files")\n      .update({');
    expect(purgeFunction).not.toContain("storagePrefixesForOrder");
    expect(purgeFunction).not.toContain("removeStoragePrefix");
    expect(purgeFunction).not.toContain(".storage\n      .from(bucket)\n      .list(");
    expect(retentionRemediation).toContain("a.claim_token is not null and a.claim_expires_at >= now()");
    expect(retentionRemediation).toContain("where public.order_purge_audit.claim_token is null");
    expect(retentionRemediation).toContain("else 'storage_deleted'");
    expect(retentionRemediation).toContain("current_setting('app.neonprint_order_command', true) is distinct from 'on'");
    expect(retentionRemediation).toContain("not public.current_profile_is_admin()");
    expect(retentionRemediation).toContain("new.operational_status is distinct from old.operational_status");
    expect(retentionRemediation).toContain("new.delivery_note is distinct from old.delivery_note");
    expect(deliveryNoteSchema).toContain("add column if not exists delivery_note text");
  });
});
