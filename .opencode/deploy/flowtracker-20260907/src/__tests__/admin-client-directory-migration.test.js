import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260702220409_admin_client_directory.sql"),
  "utf8",
);

describe("admin client directory migration", () => {
  it("keeps client listing server-paginated and bounded", () => {
    expect(migration).toContain("create or replace function public.admin_list_clients");
    expect(migration).toContain("least(greatest(coalesce(p_page_size, 7), 1), 50)");
    expect(migration).toContain("count(*) over()::bigint as total_count");
    expect(migration).toContain("limit v_page_size");
  });

  it("supports combined high-impact filters and historical segmentation", () => {
    expect(migration).toContain("p_credit_filter");
    expect(migration).toContain("p_activity_filter");
    expect(migration).toContain("p_frequency_filter");
    expect(migration).toContain("coalesce(os.completed_orders, 0) >= 5");
    expect(migration).toContain("interval '180 days'");
  });

  it("uses invoker rights and verifies the administrator role", () => {
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("if not public.current_profile_is_admin()");
    expect(migration).toContain("revoke all on function public.admin_list_clients");
  });

  it("loads detail and recent orders on demand without currency metrics", () => {
    expect(migration).toContain("create or replace function public.admin_get_client_detail");
    expect(migration).toContain("'recent_orders'");
    expect(migration).not.toContain("total_purchased");
    expect(migration).not.toContain("pending_balance");
  });
});
