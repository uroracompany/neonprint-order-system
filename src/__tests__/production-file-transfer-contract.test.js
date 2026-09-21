/* global process */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260907135517_production_file_transfer_ownership.sql"),
  "utf8",
);
const receiptMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260907143036_production_transfer_receipts_and_notifications.sql"),
  "utf8",
);

describe("production file transfer database contract", () => {
  it("keeps transfer ownership, optimistic locking and same-area checks inside protected RPCs", () => {
    expect(migration).toContain("create or replace function public.transfer_production_files");
    expect(migration).toContain("for update");
    expect(migration).toContain("FILE_STALE");
    expect(migration).toContain("v_file.assigned_to is distinct from v_actor");
    expect(migration).toContain("v_file.status not in ('pending', 'in_production')");
    expect(migration).toContain("profile.role = v_actor_role");
    expect(migration).toContain("revoke insert, update, delete on public.order_production_files from public, anon, authenticated;");
  });

  it("records a grouped audit event, receipts and one success notification for each participant", () => {
    expect(migration).toContain("'production_files_transferred'");
    expect(migration).toContain("public.record_order_assignment_receipt(");
    expect(migration).toContain("'production_file_transfer_confirmation'");
    expect(migration).toContain("'production_file_transfer_assigned'");
    expect(migration).toContain("public.get_production_file_transfer_history");
  });

  it("makes access and status changes follow each file owner", () => {
    expect(migration).toContain("and opf.assigned_to = (select auth.uid())");
    expect(migration).toContain("and opf.assigned_to = v_uid");
    expect(migration).toContain("group by opf.production_area_code, pa.label, opf.assigned_to");
    expect(migration).toContain("create or replace function public.get_active_delivery_rework_context");
    expect(migration).toContain("and public.producer_can_access_order(handoff.order_id);");
  });

  it("reconciles SemiAdmin-created or reclassified active production files without overwriting a valid partial handoff", () => {
    expect(migration).toContain("create or replace function public.reconcile_active_production_file_owner()");
    expect(migration).toContain("before insert or update of production_area_code, assigned_to");
    expect(migration).toContain("v_order_status not in ('in_Production', 'in_Termination', 'in_Completed')");
    expect(migration).toContain("area.code = new.production_area_code");
    expect(migration).toContain("new.assigned_to := v_assignment_owner;");
    expect(migration).toContain("No existe un responsable activo para el área de Producción del archivo.");
  });

  it("keeps transfer receipts available only to an active production profile", () => {
    expect(receiptMigration).toContain("create or replace function public.get_pending_production_file_transfer_receipts()");
    expect(receiptMigration).toContain("create or replace function public.acknowledge_production_file_transfer_receipts(");
    expect(receiptMigration.match(/join public\.production_areas area/g)).toHaveLength(2);
    expect(receiptMigration.match(/area\.producer_role = profile\.role/g)).toHaveLength(2);
    expect(receiptMigration.match(/area\.is_active = true/g)).toHaveLength(2);
    expect(receiptMigration.match(/profile\.deleted_at is null/g)).toHaveLength(2);
    expect(receiptMigration.match(/coalesce\(profile\.employment_status, true\) = true/g)).toHaveLength(2);
    expect(receiptMigration).toContain("receipt.user_id = v_user_id");
    expect(receiptMigration).toContain("assignment_source = 'production_file_transfer'");
  });
});
