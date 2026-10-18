import { describe, expect, it } from "vitest";
import { readProjectFile } from "../test-utils/read-project-file.js";

const migration = readProjectFile("supabase/migrations/20260907170000_flowtracker_realtime_sync.sql");
const trackingPage = readProjectFile("src/pages/page-tracking.jsx");

describe("FlowTracker realtime contract", () => {
  it("broadcasts token-scoped order and file changes with a minimal public payload", () => {
    expect(migration).toContain("realtime.send");
    expect(migration).toContain("'flowtrack:' || v_tracking_token::text");
    expect(migration).toContain("'flowtrack_changed'");
    expect(migration).toContain("    false\n  )");
    expect(migration).toContain("trg_broadcast_flowtrack_order_change");
    expect(migration).toContain("trg_broadcast_flowtrack_file_change");
    expect(migration).toContain("update of status, payment_status");
    expect(migration).toContain("update of status, production_area_code, public_label");
    expect(migration).toContain("'order_id', v_order_id");
    expect(migration).not.toContain("to_jsonb(new)");
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*url/i);
    expect(migration).not.toMatch(/jsonb_build_object\([^)]*assignee/i);
  });

  it("returns sanitized production progress and wires it into the public page", () => {
    expect(migration).toContain("'production_files', coalesce(files.items, '[]'::jsonb)");
    expect(migration).toContain("'production_area_label'");
    expect(migration).toContain("'status', indexed_files.status");
    expect(trackingPage).toContain("useFlowTrackerRealtime");
    expect(trackingPage).toContain("productionFiles={order.production_files}");
  });
});
