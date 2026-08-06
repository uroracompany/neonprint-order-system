import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer producer-token",
  now: "2026-07-28T12:00:00.000Z",
};

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  if (filter.type === "in") return filter.values.includes(row[filter.field]);
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
    in(field, values) {
      state.filters.push({ type: "in", field, values });
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

const makeProductionProfileClient = ({
  tokenUserId = "producer-1",
  currentProfile = {
    id: "producer-1",
    name: "Ana Digital",
    email: "ana@example.com",
    role: "digital_producer",
    employment_status: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  profiles = [
    { id: "producer-1", name: "Ana Digital", email: "ana@example.com", role: "digital_producer", employment_status: true },
    { id: "producer-2", name: "Beto Digital", email: "beto@example.com", role: "digital_producer", employment_status: true },
  ],
  orders = [],
  productionFiles = [],
  productionAssignments = [],
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: null,
  }));

  const profileRows = [
    ...(currentProfile ? [currentProfile] : []),
    ...profiles.filter((profile) => profile.id !== currentProfile?.id),
  ];

  const tableRows = {
    profiles: profileRows,
    orders,
    order_production_files: productionFiles,
    order_production_assignments: productionAssignments,
  };

  return {
    auth: { getUser },
    from: vi.fn((table) => ({
      select: vi.fn(() => makeBuilder(tableRows[table] || [])),
    })),
    getUser,
  };
};

describe("handleProductionProfile", () => {
  let handleProductionProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleProductionProfile } = await import("../../server/production-profile-handler.js"));
  });

  it("rejects requests without a token", async () => {
    currentClient = makeProductionProfileClient();

    const result = await handleProductionProfile({}, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("uses only the authenticated producer assignments and files", async () => {
    currentClient = makeProductionProfileClient({
      orders: [
        {
          id: "o1",
          status: "in_Completed",
          created_at: "2026-07-02T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico, PVC",
          client_name: "Cliente Propio",
        },
        {
          id: "o2",
          status: "in_Completed",
          created_at: "2026-07-03T00:00:00.000Z",
          order_type: "Orden 911",
          material: "Vinil",
          client_name: "Cliente Ajeno",
        },
        {
          id: "o3",
          status: "in_Production",
          created_at: "2026-06-25T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico",
          client_name: "Cliente Propio",
        },
      ],
      productionFiles: [
        {
          id: "f1",
          order_id: "o1",
          status: "completed",
          production_area_code: "digital",
          assigned_to: "producer-1",
          created_at: "2026-07-02T01:00:00.000Z",
        },
        {
          id: "f2",
          order_id: "o2",
          status: "completed",
          production_area_code: "digital",
          assigned_to: "producer-2",
          created_at: "2026-07-03T01:00:00.000Z",
        },
        {
          id: "f3",
          order_id: "o3",
          status: "in_production",
          production_area_code: "digital",
          assigned_to: null,
          created_at: "2026-07-04T01:00:00.000Z",
        },
      ],
      productionAssignments: [
        { order_id: "o1", production_area_code: "digital", assigned_to: "producer-1" },
        { order_id: "o2", production_area_code: "digital", assigned_to: "producer-2" },
        { order_id: "o3", production_area_code: "digital", assigned_to: "producer-1" },
      ],
    });

    const result = await handleProductionProfile({ producer_id: "producer-2" }, env);

    expect(result.status).toBe(200);
    expect(result.body.profile.id).toBe("producer-1");
    expect(result.body.metrics).toMatchObject({
      total_orders: 2,
      orders_completed: 1,
      orders_active: 2,
      files_processed: 2,
      completion_rate: 50,
      termination_rate: 50,
    });
    expect(result.body.ranking).toMatchObject({
      position: 2,
      total_producers: 2,
      score: 50,
    });
    expect(result.body.analytics.order_types).toMatchObject({
      total: 2,
      normal: { count: 2, percentage: 100 },
      urgent: { count: 0, percentage: 0 },
    });
    expect(result.body.analytics.production_file_status).toMatchObject({
      total: 2,
      completed: 1,
      in_production: 1,
    });
    expect(result.body.analytics.top_materials[0]).toMatchObject({
      name: "Acrilico",
      count: 2,
      percentage: 66.7,
    });
    expect(result.body.analytics.top_clients).toEqual([
      expect.objectContaining({ name: "Cliente Propio", count: 2, percentage: 100 }),
    ]);
    expect(result.body.analytics.status_summary).toMatchObject({
      in_production: 1,
      completed: 1,
      delivered: 0,
    });
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Ajeno");
  });

  it("counts an assigned production order even when the order was created before the current month", async () => {
    currentClient = makeProductionProfileClient({
      orders: [
        {
          id: "old-active",
          status: "in_Production",
          created_at: "2026-06-15T00:00:00.000Z",
          order_type: "Normal",
          material: "Banner",
          client_name: "Cliente Activo",
        },
      ],
      productionFiles: [
        {
          id: "old-file",
          order_id: "old-active",
          status: "in_production",
          production_area_code: "digital",
          assigned_to: "producer-1",
          created_at: "2026-07-10T00:00:00.000Z",
        },
      ],
      productionAssignments: [
        { order_id: "old-active", production_area_code: "digital", assigned_to: "producer-1" },
      ],
    });

    const result = await handleProductionProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      orders_active: 1,
      total_orders: 1,
      files_processed: 1,
    });
    expect(result.body.analytics.status_summary).toMatchObject({
      in_production: 1,
      delivered: 0,
    });
    expect(result.body.analytics.order_types).toMatchObject({
      total: 1,
      normal: { count: 1, percentage: 100 },
      urgent: { count: 0, percentage: 0 },
    });
    expect(result.body.analytics.order_types.rows).toEqual([
      expect.objectContaining({ name: "Normales", value: 1, percentage: 100 }),
    ]);
    expect(result.body.analytics.top_materials).toEqual([
      expect.objectContaining({ name: "Banner", count: 1, percentage: 100 }),
    ]);
    expect(result.body.analytics.top_clients).toEqual([
      expect.objectContaining({ name: "Cliente Activo", count: 1, percentage: 100 }),
    ]);
  });
});
