import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn(() => currentClient) }));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer valid-admin-token",
};

function builder(rows, head = false) {
  const filters = [];
  const api = {
    eq(field, value) { filters.push((row) => row[field] === value); return api; },
    in(field, values) { filters.push((row) => values.includes(row[field])); return api; },
    gte(field, value) { filters.push((row) => new Date(row[field]) >= new Date(value)); return api; },
    lt(field, value) { filters.push((row) => new Date(row[field]) < new Date(value)); return api; },
    single: async () => ({ data: rows.find((row) => filters.every((filter) => filter(row))) || null, error: null }),
    then(resolve, reject) { return Promise.resolve({ data: head ? null : rows.filter((row) => filters.every((filter) => filter(row))), error: null, count: rows.length }).then(resolve, reject); },
  };
  return api;
}

function makeClient(role = "admin") {
  const profiles = [
    { id: "admin-1", name: "Admin", role, employment_status: true },
    { id: "seller-1", name: "Vendedor Uno", role: "seller", employment_status: true },
    { id: "designer-1", name: "Diseñador Uno", role: "designer", employment_status: true },
    { id: "producer-1", name: "Productor Uno", role: "digital_producer", employment_status: true },
  ];
  const orders = [
    { id: "order-1", seller_id: "seller-1", created_by: null, designer_id: "designer-1", status: "in_Completed", order_type: "normal", created_at: "2026-10-03T00:00:00.000Z", status_changed_at: "2026-10-04T00:00:00.000Z", is_archived_admin: false },
    { id: "order-2", seller_id: null, created_by: "seller-1", designer_id: null, status: "cancelled", order_type: "orden 911", created_at: "2026-10-04T00:00:00.000Z", status_changed_at: "2026-10-04T00:00:00.000Z", is_archived_admin: false },
    { id: "order-archived", seller_id: "seller-1", created_by: null, designer_id: null, status: "in_Completed", order_type: "normal", created_at: "2026-10-05T00:00:00.000Z", status_changed_at: "2026-10-05T00:00:00.000Z", is_archived_admin: true },
  ];
  const files = [
    { id: "file-1", order_id: "order-1", production_area_code: "digital", status: "completed", assigned_to: "producer-1", created_by: "producer-1", started_at: "2026-10-03T00:00:00.000Z", completed_at: "2026-10-04T00:00:00.000Z", created_at: "2026-10-03T00:00:00.000Z" },
    { id: "file-2", order_id: "order-1", production_area_code: "digital", status: "in_production", assigned_to: "producer-1", created_by: "producer-1", created_at: "2026-10-04T00:00:00.000Z" },
    { id: "file-archived", order_id: "order-archived", production_area_code: "digital", status: "completed", assigned_to: "producer-1", created_by: "producer-1", created_at: "2026-10-05T00:00:00.000Z" },
  ];
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "admin-1" } }, error: null })) },
    from: vi.fn((table) => ({ select: vi.fn((_fields, options = {}) => builder(table === "profiles" ? profiles : table === "orders" ? orders : table === "order_production_files" ? files : [], options.head)) })),
  };
}

const payload = {
  date_from: "2026-10-01T00:00:00.000Z",
  date_to: "2026-11-01T00:00:00.000Z",
  compare_from: "2026-09-01T00:00:00.000Z",
  compare_to: "2026-10-01T00:00:00.000Z",
};

describe("employee-team-performance handler", () => {
  let handle;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminEmployeeTeamPerformance: handle } = await import("../../server/admin-employee-team-performance-handler.js"));
  });

  it("rejects non-admin users before returning team data", async () => {
    currentClient = makeClient("seller");
    const result = await handle(payload, env);
    expect(result.status).toBe(403);
  });

  it("validates all date bounds", async () => {
    currentClient = makeClient();
    const result = await handle({ date_from: payload.date_from }, env);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe("TEAM_PERFORMANCE_INVALID_PERIOD");
  });

  it("returns separated department and production-area metrics without archived orders", async () => {
    currentClient = makeClient();
    const result = await handle(payload, env);
    expect(result.status).toBe(200);
    expect(result.body.sales.summary.total_orders).toBe(2);
    expect(result.body.sales.summary.cancelled_orders).toBe(1);
    expect(result.body.production.areas.digital.summary.total_files).toBe(2);
    expect(result.body.production.areas.digital.summary.total_orders).toBe(1);
    expect(result.body.production.areas.dtf.summary.total_files).toBe(0);
    expect(result.body.sales.ranking[0]).toMatchObject({ id: "seller-1", completed: 1 });
    expect(result.body.general.trend.points.length).toBeGreaterThan(0);
    expect(result.body.general.trend.points.some((point) => point.total === 0)).toBe(true);
  });
});
