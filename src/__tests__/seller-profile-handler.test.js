import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer seller-token",
  now: "2026-07-28T12:00:00.000Z",
};

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  if (filter.type === "gte") return new Date(row[filter.field]) >= new Date(filter.value);
  if (filter.type === "lt") return new Date(row[filter.field]) < new Date(filter.value);
  return true;
}));

function makeBuilder(rows) {
  const state = { filters: [] };
  const builder = {
    eq(field, value) {
      state.filters.push({ type: "eq", field, value });
      return builder;
    },
    gte(field, value) {
      state.filters.push({ type: "gte", field, value });
      return builder;
    },
    lt(field, value) {
      state.filters.push({ type: "lt", field, value });
      return builder;
    },
    async single() {
      const filtered = applyFilters(rows, state.filters);
      return { data: filtered[0] || null, error: filtered[0] ? null : { message: "No rows found" } };
    },
    then(resolve, reject) {
      return Promise.resolve({ data: applyFilters(rows, state.filters), error: null }).then(resolve, reject);
    },
  };
  return builder;
}

const makeSellerProfileClient = ({
  tokenUserId = "seller-1",
  tokenError = null,
  currentProfile = {
    id: "seller-1",
    name: "Ana Seller",
    email: "ana@example.com",
    role: "seller",
    employment_status: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  profiles = [
    { id: "seller-1", name: "Ana Seller", email: "ana@example.com", role: "seller", employment_status: true },
    { id: "seller-2", name: "Bruno Seller", email: "bruno@example.com", role: "seller", employment_status: true },
  ],
  orders = [],
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));

  const profileRows = [
    ...(currentProfile ? [currentProfile] : []),
    ...profiles.filter((profile) => profile.id !== currentProfile?.id),
  ];

  return {
    auth: { getUser },
    from: vi.fn((table) => ({
      select: vi.fn(() => makeBuilder(table === "profiles" ? profileRows : orders)),
    })),
    getUser,
  };
};

describe("handleSellerProfile", () => {
  let handleSellerProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleSellerProfile } = await import("../../server/seller-profile-handler.js"));
  });

  it("rejects requests without a token", async () => {
    currentClient = makeSellerProfileClient();

    const result = await handleSellerProfile({}, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("rejects inactive users and unsupported roles", async () => {
    currentClient = makeSellerProfileClient({
      currentProfile: {
        id: "quote-1",
        name: "Caja",
        email: "quote@example.com",
        role: "quote",
        employment_status: true,
      },
      tokenUserId: "quote-1",
    });

    const wrongRole = await handleSellerProfile({}, env);
    expect(wrongRole.status).toBe(403);

    currentClient = makeSellerProfileClient({
      currentProfile: {
        id: "seller-1",
        name: "Ana Seller",
        email: "ana@example.com",
        role: "seller",
        employment_status: false,
      },
    });

    const inactive = await handleSellerProfile({}, env);
    expect(inactive.status).toBe(403);
  });

  it("ignores seller_id from the payload and returns only the authenticated seller ranking", async () => {
    currentClient = makeSellerProfileClient({
      profiles: [
        { id: "seller-1", name: "Ana Seller", email: "ana@example.com", role: "seller", employment_status: true },
        { id: "seller-2", name: "Bruno Seller", email: "bruno@example.com", role: "seller", employment_status: true },
        { id: "designer-1", name: "Diana Designer", email: "diana@example.com", role: "designer", employment_status: true },
        { id: "designer-2", name: "Marco Designer", email: "marco@example.com", role: "designer", employment_status: true },
      ],
      orders: [
        {
          id: "o1",
          seller_id: "seller-1",
          created_by: null,
          status: "in_Completed",
          created_at: "2026-07-02T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico, PVC",
          designer_id: "designer-1",
          client_name: "Cliente A",
          delivery_date: "2026-07-08T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o2",
          seller_id: "seller-1",
          created_by: null,
          status: "cancelled",
          created_at: "2026-07-03T00:00:00.000Z",
          order_type: "Orden 911",
          material: "Vinil",
          designer_id: "designer-1",
          client_name: "Cliente B",
          delivery_date: "2026-07-10T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o5",
          seller_id: "seller-1",
          created_by: null,
          status: "pending",
          created_at: "2026-07-07T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico",
          designer_id: "designer-2",
          client_name: "Cliente A",
          delivery_date: "2026-07-01T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o6",
          seller_id: "seller-1",
          created_by: null,
          status: "pending",
          created_at: "2026-05-12T00:00:00.000Z",
          order_type: "Normal",
          material: "MDF",
          designer_id: "designer-2",
          client_name: "Cliente Historico",
          delivery_date: "2026-05-20T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o3",
          seller_id: "seller-2",
          created_by: null,
          status: "in_Completed",
          created_at: "2026-07-04T00:00:00.000Z",
          order_type: "Orden 911",
          material: "PVC",
          designer_id: "designer-1",
          client_name: "Cliente de Bruno",
          delivery_date: "2026-07-12T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o4",
          seller_id: "seller-2",
          created_by: null,
          status: "in_Delivered",
          created_at: "2026-07-05T00:00:00.000Z",
          order_type: "Normal",
          material: "Foam",
          designer_id: "designer-2",
          client_name: "Cliente Ajeno",
          delivery_date: "2026-07-15T00:00:00.000Z",
          is_archived: false,
        },
      ],
    });

    const result = await handleSellerProfile({ seller_id: "seller-2" }, env);

    expect(result.status).toBe(200);
    expect(result.body.profile.id).toBe("seller-1");
    expect(result.body.metrics).toMatchObject({
      total_orders: 3,
      completed_orders: 1,
      cancelled_orders: 1,
      active_orders: 1,
    });
    expect(result.body.ranking).toMatchObject({
      position: 2,
      total_sellers: 2,
      metric_label: "Mejor % Finalizacion",
      score: 33.3,
    });
    expect(result.body.analytics.order_types).toMatchObject({
      total: 3,
      normal: { count: 2, percentage: 66.7 },
      urgent: { count: 1, percentage: 33.3 },
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
    expect(result.body.analytics.trends.dia.some((item) => item.count > 0)).toBe(true);
    expect(result.body.analytics.trends["30d"].some((item) => item.count > 0)).toBe(true);
    expect(result.body.analytics.trends["3m"].some((item) => item.count > 0)).toBe(true);
    expect(result.body.analytics.trends.mensual.some((item) => item.count > 0)).toBe(true);
    expect(result.body.analytics.top_designer).toMatchObject({
      name: "Diana Designer",
      count: 2,
      percentage: 66.7,
    });
    expect(result.body.analytics.top_materials[0]).toMatchObject({
      name: "Acrilico",
      count: 2,
      percentage: 50,
    });
    expect(result.body.analytics.top_clients[0]).toMatchObject({
      name: "Cliente A",
      count: 2,
      percentage: 66.7,
    });
    expect(result.body.analytics.status_summary).toMatchObject({
      active: 1,
      completed: 1,
      pending: 1,
      cancelled: 1,
      overdue: 1,
    });
    expect(JSON.stringify(result.body)).not.toContain("Bruno Seller");
    expect(JSON.stringify(result.body)).not.toContain("seller-2");
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente de Bruno");
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Ajeno");
  });

  it("returns zero metrics and a stable private ranking when the seller has no orders", async () => {
    currentClient = makeSellerProfileClient({ orders: [] });

    const result = await handleSellerProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      total_orders: 0,
      completed_orders: 0,
      active_orders: 0,
      cancelled_orders: 0,
      delivered_orders: 0,
      completion_rate: 0,
      cancellation_rate: 0,
      goals_achieved: 0,
    });
    expect(result.body.ranking.position).toBe(1);
    expect(result.body.ranking.total_sellers).toBe(2);
    expect(result.body.analytics).toMatchObject({
      order_types: {
        total: 0,
        normal: { count: 0, percentage: 0 },
        urgent: { count: 0, percentage: 0 },
      },
      top_designer: { name: "Sin asignaciones", count: 0, percentage: 0 },
      top_materials: [],
      top_clients: [],
      status_summary: {
        active: 0,
        completed: 0,
        pending: 0,
        cancelled: 0,
        overdue: 0,
      },
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
  });
});
