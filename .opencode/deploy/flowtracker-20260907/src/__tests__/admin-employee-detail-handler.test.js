import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer valid-admin-token",
  now: "2026-07-24T12:00:00.000Z",
};

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  if (filter.type === "in") return filter.values.includes(row[filter.field]);
  if (filter.type === "gte") return new Date(row[filter.field]) >= new Date(filter.value);
  if (filter.type === "lt") return new Date(row[filter.field]) < new Date(filter.value);
  if (filter.type === "or") {
    return filter.conditions.some((condition) => {
      if (condition.operator === "eq") return row[condition.field] === condition.value;
      if (condition.operator === "ilike") return String(row[condition.field] || "").toLowerCase().includes(condition.value.toLowerCase());
      return false;
    });
  }
  return true;
}));

const parseOr = (value) => String(value || "").split(",").map((part) => {
  const [field, operator, rawValue] = part.split(".");
  return {
    field,
    operator,
    value: operator === "ilike" ? String(rawValue || "").replace(/^%|%$/g, "") : rawValue,
  };
});

function makeBuilder({ rows, options = {}, legacyQuoteColumnsMissing = false }) {
  const state = {
    filters: [],
    orderField: null,
    ascending: true,
    range: null,
    error: null,
  };

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
    or(value) {
      if (legacyQuoteColumnsMissing && /quotation_id|quote_user_id/.test(value)) {
        state.error = { code: "42703", message: "column orders.quotation_id does not exist" };
      }
      state.filters.push({ type: "or", conditions: parseOr(value) });
      return builder;
    },
    order(field, orderOptions = {}) {
      state.orderField = field;
      state.ascending = orderOptions.ascending !== false;
      return builder;
    },
    range(from, to) {
      state.range = [from, to];
      return builder;
    },
    async single() {
      if (state.error) return { data: null, error: state.error };
      const filtered = applyFilters(rows, state.filters);
      return { data: filtered[0] || null, error: filtered[0] ? null : { message: "No rows found" } };
    },
    then(resolve, reject) {
      if (state.error) {
        return Promise.resolve({ data: null, error: state.error, count: null }).then(resolve, reject);
      }

      let filtered = applyFilters(rows, state.filters);
      if (state.orderField) {
        filtered = [...filtered].sort((a, b) => {
          const left = String(a[state.orderField] || "");
          const right = String(b[state.orderField] || "");
          return state.ascending ? left.localeCompare(right) : right.localeCompare(left);
        });
      }
      const count = filtered.length;
      if (state.range) {
        filtered = filtered.slice(state.range[0], state.range[1] + 1);
      }
      const data = options.head ? null : filtered;
      return Promise.resolve({ data, error: null, count }).then(resolve, reject);
    },
  };

  return builder;
}

const makeEmployeeDetailClient = ({
  currentRole = "admin",
  profile = { id: "employee-1", name: "Ana", email: "ana@example.com", role: "seller", employment_status: true, created_at: "2026-01-01T00:00:00.000Z" },
  orders = [],
  productionFiles = [],
  productionAssignments = [],
  legacyQuoteColumnsMissing = false,
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: { user: { id: "admin-1" } },
    error: null,
  }));

  const profileRows = [
    { id: "admin-1", name: "Admin", email: "admin@example.com", role: currentRole, employment_status: true },
    ...(profile ? [profile] : []),
  ];

  return {
    auth: {
      getUser,
      admin: {
        getUserById: vi.fn(),
      },
    },
    from: vi.fn((table) => ({
      select: vi.fn((columns, options = {}) => makeBuilder({
        rows: table === "profiles"
          ? profileRows
          : table === "orders"
            ? orders
            : table === "order_production_files"
              ? productionFiles
              : table === "order_production_assignments"
                ? productionAssignments
                : [],
        options,
        legacyQuoteColumnsMissing: table === "orders" && legacyQuoteColumnsMissing,
      })),
    })),
  };
};

describe("handleAdminEmployeeDetail", () => {
  let handleAdminEmployeeDetail;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminEmployeeDetail } = await import("../../server/admin-employee-detail-handler.js"));
  });

  it("rejects non-admin users", async () => {
    currentClient = makeEmployeeDetailClient({ currentRole: "seller" });

    const result = await handleAdminEmployeeDetail({ userId: "employee-1" }, env);

    expect(result.status).toBe(403);
  });

  it("returns 404 when the employee profile does not exist", async () => {
    currentClient = makeEmployeeDetailClient({ profile: null });

    const result = await handleAdminEmployeeDetail({ userId: "employee-1" }, env);

    expect(result.status).toBe(404);
  });

  it("returns exact seller metrics and a paginated order list", async () => {
    currentClient = makeEmployeeDetailClient({
      orders: [
        { id: "o1", seller_id: "employee-1", created_by: null, status: "in_Completed", payment_status: "pagado", client_name: "A", created_at: "2026-07-03T00:00:00.000Z" },
        { id: "o2", seller_id: null, created_by: "employee-1", status: "in_Delivered", payment_status: "credito", client_name: "B", created_at: "2026-07-02T00:00:00.000Z" },
        { id: "o3", seller_id: "employee-1", created_by: null, status: "cancelled", payment_status: "parcial", client_name: "C", created_at: "2026-07-01T00:00:00.000Z" },
      ],
    });

    const result = await handleAdminEmployeeDetail({ userId: "employee-1", page: 1, pageSize: 2 }, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toEqual({
      total_orders: 3,
      active_orders: 0,
      completed_orders: 1,
      delivered_orders: 1,
      cancelled_orders: 1,
    });
    expect(result.body.total).toBe(3);
    expect(result.body.orders).toHaveLength(2);
  });

  it("falls back to quote_id when legacy quote columns are absent", async () => {
    currentClient = makeEmployeeDetailClient({
      profile: { id: "employee-1", name: "Caja", email: "caja@example.com", role: "quote", employment_status: true },
      legacyQuoteColumnsMissing: true,
      orders: [
        { id: "o1", quote_id: "employee-1", status: "in_Completed", payment_status: "pagado", client_name: "A", created_at: "2026-07-01T00:00:00.000Z" },
      ],
    });

    const result = await handleAdminEmployeeDetail({ userId: "employee-1" }, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics.total_orders).toBe(1);
  });

  it("uses production files and assignments for production employee metrics", async () => {
    currentClient = makeEmployeeDetailClient({
      profile: { id: "employee-1", name: "Digital", email: "digital@example.com", role: "digital_producer", employment_status: true },
      orders: [
        { id: "o1", status: "in_Completed", payment_status: "pagado", client_name: "A", created_at: "2026-07-02T00:00:00.000Z" },
        { id: "o2", status: "in_Production", payment_status: "pagado", client_name: "B", created_at: "2026-07-01T00:00:00.000Z" },
      ],
      productionFiles: [
        { id: "f1", order_id: "o1", production_area_code: "digital", assigned_to: "employee-1", created_by: null, status: "completed", started_at: "2026-07-02T00:00:00.000Z", completed_at: "2026-07-03T00:00:00.000Z", created_at: "2026-07-02T00:00:00.000Z" },
      ],
      productionAssignments: [
        { order_id: "o2", production_area_code: "digital", assigned_to: "employee-1" },
      ],
    });

    const result = await handleAdminEmployeeDetail({ userId: "employee-1" }, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics.total_orders).toBe(2);
    expect(result.body.productionMetrics.total_files).toBe(1);
  });
});
