/* global process */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260907150001_production_file_completion_current_owner.sql"),
  "utf8",
);

const canCompletePreflight = ({ actorId, assignedTo, sameActiveArea = true, activeProfile = true }) => (
  activeProfile && sameActiveArea && actorId === assignedTo
);

describe("production last-pending-file current owner contract", () => {
  it("replaces only the preflight with the current per-file owner predicate", () => {
    expect(migration).toContain("create or replace function public.will_complete_production_order(p_file_id uuid)");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("v_uid uuid := auth.uid()");
    expect(migration).toContain("p.deleted_at is null");
    expect(migration).toContain("coalesce(p.employment_status, true) = true");
    expect(migration).toContain("pa.producer_role = v_profile_role");
    expect(migration).toContain("pa.is_active = true");
    expect(migration).toContain("and opf.production_area_code = area_code");
    expect(migration).toContain("and opf.assigned_to = v_uid");
    expect(migration).not.toContain("current_user_assigned_to_production_area");
    expect(migration).toContain("revoke all on function public.will_complete_production_order(uuid) from public, anon, authenticated;");
    expect(migration).toContain("grant execute on function public.will_complete_production_order(uuid) to authenticated;");
  });

  it("makes the last transfer recipient the sole authorized completer for A to B to A to C", () => {
    let assignedTo = "A";

    assignedTo = "B";
    expect(canCompletePreflight({ actorId: "B", assignedTo })).toBe(true);
    expect(canCompletePreflight({ actorId: "A", assignedTo })).toBe(false);

    assignedTo = "A";
    expect(canCompletePreflight({ actorId: "A", assignedTo })).toBe(true);
    expect(canCompletePreflight({ actorId: "B", assignedTo })).toBe(false);

    assignedTo = "C";
    expect(canCompletePreflight({ actorId: "C", assignedTo })).toBe(true);
    expect(canCompletePreflight({ actorId: "A", assignedTo })).toBe(false);
    expect(canCompletePreflight({ actorId: "B", assignedTo })).toBe(false);
  });

  it("retains active-profile and same-area checks, and keeps partial transfers per file", () => {
    expect(canCompletePreflight({ actorId: "B", assignedTo: "B", activeProfile: false })).toBe(false);
    expect(canCompletePreflight({ actorId: "B", assignedTo: "B", sameActiveArea: false })).toBe(false);

    const partialTransfer = {
      fileTransferredToB: "B",
      fileRetainedByA: "A",
    };
    expect(canCompletePreflight({ actorId: "B", assignedTo: partialTransfer.fileTransferredToB })).toBe(true);
    expect(canCompletePreflight({ actorId: "B", assignedTo: partialTransfer.fileRetainedByA })).toBe(false);
    expect(canCompletePreflight({ actorId: "A", assignedTo: partialTransfer.fileRetainedByA })).toBe(true);
  });

  it("keeps the last-pending check global to every other unfinished file in the order", () => {
    expect(migration).toContain("where opf.order_id = file_row.order_id");
    expect(migration).toContain("and opf.id <> file_row.id");
    expect(migration).toContain("and opf.status <> 'completed'");
    expect(migration).toContain("return coalesce(pending_other_count, 0) = 0;");
  });
});
