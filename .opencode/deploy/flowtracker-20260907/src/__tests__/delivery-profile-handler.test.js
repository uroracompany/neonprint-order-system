import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer delivery-token",
  now: "2026-07-28T12:00:00.000Z",
};

function makeBuilder(rows) {
  const filters = [];
  const builder = {
    eq(field, value) { filters.push((row) => row[field] === value); return builder; },
    gte(field, value) { filters.push((row) => new Date(row[field]) >= new Date(value)); return builder; },
    lt(field, value) { filters.push((row) => new Date(row[field]) < new Date(value)); return builder; },
    async single() { const row = rows.filter((item) => filters.every((filter) => filter(item)))[0]; return { data: row || null, error: row ? null : { message: "No rows found" } }; },
    then(resolve, reject) { return Promise.resolve({ data: rows.filter((row) => filters.every((filter) => filter(row))), error: null }).then(resolve, reject); },
  };
  return builder;
}

function makeClient(orders = []) {
  const profile = { id: "delivery-1", name: "Ana Entrega", role: "delivery", employment_status: true };
  return {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: "delivery-1" } }, error: null })) },
    from: vi.fn((table) => ({ select: vi.fn(() => makeBuilder(table === "profiles" ? [profile] : orders)) })),
  };
}

describe("handleDeliveryProfile", () => {
  let handleDeliveryProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleDeliveryProfile } = await import("../../server/delivery-profile-handler.js"));
  });

  it("only aggregates orders assigned to the authenticated delivery user", async () => {
    currentClient = makeClient([
      { id: "pending", delivery_id: "delivery-1", status: "in_Completed", created_at: "2026-07-02T00:00:00.000Z", delivery_date: "2026-07-20T00:00:00.000Z", client_name: "Cliente A" },
      { id: "delivered", delivery_id: "delivery-1", status: "in_Delivered", created_at: "2026-07-03T00:00:00.000Z", delivery_date: "2026-07-25T00:00:00.000Z", client_name: "Cliente B" },
      { id: "cancelled", delivery_id: "delivery-1", status: "cancelled", created_at: "2026-07-04T00:00:00.000Z", client_name: "Cliente A" },
      { id: "foreign", delivery_id: "delivery-2", status: "in_Completed", created_at: "2026-07-05T00:00:00.000Z", client_name: "Cliente Ajeno" },
      { id: "unassigned", delivery_id: null, status: "in_Completed", created_at: "2026-07-05T00:00:00.000Z", client_name: "Cliente Sin Asignar" },
    ]);

    const result = await handleDeliveryProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      assigned_orders: 3,
      pending_delivery_orders: 1,
      delivered_orders: 1,
      overdue_orders: 1,
      cancelled_orders: 1,
      clients_served: 2,
      delivery_rate: 50,
    });
    expect(JSON.stringify(result.body)).not.toContain("Cliente Ajeno");
    expect(JSON.stringify(result.body)).not.toContain("Cliente Sin Asignar");
  });

  it("returns zero metrics when the delivery user has no assigned orders", async () => {
    currentClient = makeClient([
      { id: "unassigned", delivery_id: null, status: "in_Completed", created_at: "2026-07-05T00:00:00.000Z", client_name: "Cliente Sin Asignar" },
      { id: "foreign", delivery_id: "delivery-2", status: "in_Completed", created_at: "2026-07-05T00:00:00.000Z", client_name: "Cliente Ajeno" },
    ]);

    const result = await handleDeliveryProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      assigned_orders: 0,
      pending_delivery_orders: 0,
      delivered_orders: 0,
      overdue_orders: 0,
      cancelled_orders: 0,
      clients_served: 0,
      delivery_rate: 0,
    });
    expect(result.body.analytics.top_clients).toEqual([]);
    expect(result.body.analytics.trends).toHaveLength(14);
    expect(result.body.analytics.trends.every((row) => row.count === 0)).toBe(true);
  });
});
