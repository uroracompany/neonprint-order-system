import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer seller-token",
};

const applyOrFilter = (row, expression) => expression.split(",").some((part) => {
  const [field, operator, ...valueParts] = part.split(".");
  const value = valueParts.join(".");
  if (operator === "eq") return row[field] === value;
  if (operator === "is" && value === "null") return row[field] === null || row[field] === undefined;
  if (operator === "is" && value === "false") return row[field] === false || row[field] === null || row[field] === undefined;
  if (operator === "ilike") {
    const query = value.replace(/^%|%$/g, "").toLowerCase();
    return String(row[field] || "").toLowerCase().includes(query);
  }
  return false;
});

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  if (filter.type === "is" && filter.value === null) return row[filter.field] === null || row[filter.field] === undefined;
  if (filter.type === "is") return row[filter.field] === filter.value;
  if (filter.type === "gte") return new Date(row[filter.field]) >= new Date(filter.value);
  if (filter.type === "lt") return new Date(row[filter.field]) < new Date(filter.value);
  if (filter.type === "or") return applyOrFilter(row, filter.expression);
  return true;
}));

function makeSelectBuilder(rows) {
  const state = { filters: [], order: null, range: null };
  const resolveRows = () => {
    let filtered = applyFilters(rows, state.filters);
    const count = filtered.length;
    if (state.order) {
      filtered = [...filtered].sort((a, b) => {
        const left = a[state.order.field];
        const right = b[state.order.field];
        if (left === right) return 0;
        const result = left > right ? 1 : -1;
        return state.order.ascending ? result : -result;
      });
    }
    if (state.range) {
      filtered = filtered.slice(state.range.from, state.range.to + 1);
    }
    return { rows: filtered, count };
  };
  const builder = {
    eq(field, value) {
      state.filters.push({ type: "eq", field, value });
      return builder;
    },
    is(field, value) {
      state.filters.push({ type: "is", field, value });
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
    or(expression) {
      state.filters.push({ type: "or", expression });
      return builder;
    },
    order(field, options = {}) {
      state.order = { field, ascending: options.ascending !== false };
      return builder;
    },
    range(from, to) {
      state.range = { from, to };
      return builder;
    },
    async single() {
      const { rows: filtered } = resolveRows();
      return { data: filtered[0] || null, error: filtered[0] ? null : { message: "No rows found" } };
    },
    then(resolve, reject) {
      const { rows: data, count } = resolveRows();
      return Promise.resolve({ data, error: null, count }).then(resolve, reject);
    },
  };
  return builder;
}

function makeUpdateBuilder(rows, updates) {
  const state = { filters: [], values: updates };
  const builder = {
    eq(field, value) {
      state.filters.push({ type: "eq", field, value });
      return builder;
    },
    select() {
      return builder;
    },
    async single() {
      const row = applyFilters(rows, state.filters)[0];
      if (!row) return { data: null, error: { message: "No rows found" } };
      Object.assign(row, state.values);
      return { data: { ...row }, error: null };
    },
  };
  return builder;
}

const makeSellerOrderClient = ({
  tokenUserId = "seller-1",
  currentProfile = {
    id: "seller-1",
    name: "Ana Seller",
    email: "ana@example.com",
    role: "seller",
    employment_status: true,
  },
  profiles = [],
  orders = [],
} = {}) => {
  const profileRows = [
    ...(currentProfile ? [currentProfile] : []),
    ...profiles.filter((profile) => profile.id !== currentProfile?.id),
  ];

  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: null,
  }));

  const from = vi.fn((table) => ({
    select: vi.fn(() => makeSelectBuilder(table === "profiles" ? profileRows : orders)),
    update: vi.fn((updates) => makeUpdateBuilder(table === "profiles" ? profileRows : orders, updates)),
  }));

  return { auth: { getUser }, from, getUser, orders };
};

describe("handleSellerOrderAction", () => {
  let handleSellerOrderAction;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleSellerOrderAction } = await import("../../server/seller-order-actions-handler.js"));
  });

  it("rejects requests without a token", async () => {
    currentClient = makeSellerOrderClient();

    const result = await handleSellerOrderAction({ action: "detail", order_id: "o1" }, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("rejects paginated list requests without a token", async () => {
    currentClient = makeSellerOrderClient();

    const result = await handleSellerOrderAction({ action: "list" }, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("returns only authenticated seller orders with server pagination, summary, and recent orders", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: "seller-1", client_id: "client-1", client_name: "Cliente 1", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T10:00:00.000Z", is_archived: false },
        { id: "o2", seller_id: "seller-1", client_id: "client-2", client_name: "Cliente 2", status: "in_Design", payment_status: "pagado", created_at: "2026-07-27T10:00:00.000Z", is_archived: false, return_reason: "Ajustar arte", order_design_type: "INTERNAL_DESIGN" },
        { id: "o3", seller_id: "seller-1", client_id: "client-1", client_name: "Cliente 3", status: "in_Quote", payment_status: "parcial", created_at: "2026-07-26T10:00:00.000Z", is_archived: false, invoice_number: "FAC-911", description: "Orden urgente", material: "Vinil" },
        { id: "o4", seller_id: "seller-1", client_id: "client-3", client_name: "Cliente 4", status: "in_Completed", payment_status: "pagado", created_at: "2026-07-25T10:00:00.000Z", is_archived: false },
        { id: "o5", seller_id: "seller-1", client_id: "client-4", client_name: "Cliente 5", status: "in_Production", payment_status: "pendiente", created_at: "2026-07-24T10:00:00.000Z", is_archived: true },
        { id: "o6", seller_id: "seller-1", client_id: null, client_name: "Cliente 6", status: "in_Termination", payment_status: "pendiente", created_at: "2026-07-23T10:00:00.000Z", is_archived: false },
        { id: "o7", seller_id: "seller-2", client_id: "client-7", client_name: "Cliente ajeno", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T11:00:00.000Z", is_archived: false },
      ],
    });

    const result = await handleSellerOrderAction(
      { action: "list", page: 1, pageSize: 2, seller_id: "seller-2" },
      { ...env, now: "2026-07-28T12:00:00.000Z" }
    );

    expect(result.status).toBe(200);
    expect(result.body.orders.map((order) => order.id)).toEqual(["o1", "o2"]);
    expect(result.body.total).toBe(5);
    expect(result.body.totalPages).toBe(3);
    expect(result.body.recent_orders.map((order) => order.id)).toEqual(["o1", "o2", "o3", "o4", "o5"]);
    expect(result.body.recent_orders.some((order) => order.client_name === "Cliente ajeno")).toBe(false);
    expect(result.body.summary).toEqual({
      todayOrders: 1,
      pending: 1,
      inDesign: 1,
      inQuote: 1,
      inProduction: 1,
      inTermination: 1,
      completed: 1,
      returned: 1,
      active: 4,
      unarchived: 5,
    });
  });

  it("applies combined server-side filters for seller order lists", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: "seller-1", client_id: "client-1", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T10:00:00.000Z", is_archived: false, invoice_number: "FAC-100" },
        { id: "o2", seller_id: "seller-1", client_id: "client-1", status: "in_Quote", payment_status: "parcial", created_at: "2026-07-26T10:00:00.000Z", is_archived: false, invoice_number: "FAC-911", description: "Orden urgente", material: "Vinil" },
        { id: "o3", seller_id: "seller-1", client_id: "client-2", status: "in_Quote", payment_status: "parcial", created_at: "2026-07-26T10:00:00.000Z", is_archived: false, invoice_number: "FAC-911" },
        { id: "o4", seller_id: "seller-1", client_id: "client-1", status: "in_Quote", payment_status: "pagado", created_at: "2026-07-26T10:00:00.000Z", is_archived: false, invoice_number: "FAC-911" },
        { id: "o5", seller_id: "seller-2", client_id: "client-1", status: "in_Quote", payment_status: "parcial", created_at: "2026-07-26T10:00:00.000Z", is_archived: false, invoice_number: "FAC-911" },
      ],
    });

    const result = await handleSellerOrderAction({
      action: "list",
      status: "in_Quote",
      paymentStatus: "parcial",
      clientId: "client-1",
      archive: "active",
      dateFilter: "7days",
      search: "FAC-911",
    }, { ...env, now: "2026-07-28T12:00:00.000Z" });

    expect(result.status).toBe(200);
    expect(result.body.orders.map((order) => order.id)).toEqual(["o2"]);
    expect(result.body.total).toBe(1);
  });

  it("rejects access to orders owned by another seller", async () => {
    currentClient = makeSellerOrderClient({
      orders: [{ id: "o2", seller_id: "seller-2", created_by: null, status: "pending" }],
    });

    const result = await handleSellerOrderAction({ action: "detail", order_id: "o2" }, env);

    expect(result.status).toBe(403);
  });

  it("ignores seller_id sent by the client and returns only the authenticated seller order", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: "seller-1", created_by: null, status: "pending", client_name: "Propio" },
        { id: "o2", seller_id: "seller-2", created_by: null, status: "pending", client_name: "Ajeno" },
      ],
    });

    const result = await handleSellerOrderAction(
      { action: "detail", order_id: "o1", seller_id: "seller-2" },
      env
    );

    expect(result.status).toBe(200);
    expect(result.body.order.client_name).toBe("Propio");
  });

  it("cancels an owned unpaid order and rejects paid or partial orders", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: "seller-1", status: "pending", payment_status: "pendiente" },
        { id: "o2", seller_id: "seller-1", status: "pending", payment_status: "pagado" },
        { id: "o3", seller_id: "seller-1", status: "pending", payment_status: "parcial" },
      ],
    });

    const cancelled = await handleSellerOrderAction({ action: "cancel", order_id: "o1", reason: "Cliente cancela" }, env);
    const paid = await handleSellerOrderAction({ action: "cancel", order_id: "o2", reason: "Cliente cancela" }, env);
    const partial = await handleSellerOrderAction({ action: "cancel", order_id: "o3", reason: "Cliente cancela" }, env);

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe("cancelled");
    expect(cancelled.body.order.cancellation_reason).toBe("Cliente cancela");
    expect(paid.status).toBe(409);
    expect(partial.status).toBe(409);
  });

  it("assigns only active profiles with the expected role", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "designer-1", role: "designer", employment_status: true },
        { id: "quote-1", role: "quote", employment_status: true },
        { id: "inactive-designer", role: "designer", employment_status: false },
      ],
      orders: [{ id: "o1", seller_id: "seller-1", status: "pending", payment_status: "pendiente" }],
    });

    const designer = await handleSellerOrderAction({ action: "send_to_designer", order_id: "o1", designer_id: "designer-1" }, env);
    const quote = await handleSellerOrderAction({ action: "send_to_quote", order_id: "o1", quote_user_id: "quote-1" }, env);
    const inactive = await handleSellerOrderAction({ action: "send_to_designer", order_id: "o1", designer_id: "inactive-designer" }, env);

    expect(designer.status).toBe(200);
    expect(designer.body.order.status).toBe("in_Design");
    expect(designer.body.order.designer_id).toBe("designer-1");
    expect(quote.status).toBe(200);
    expect(quote.body.order.status).toBe("in_Quote");
    expect(quote.body.order.quote_id).toBe("quote-1");
    expect(inactive.status).toBe(400);
  });

  it("archives only seller-archivable owned orders", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: "seller-1", status: "in_Completed", payment_status: "pagado", is_archived: false },
        { id: "o2", seller_id: "seller-1", status: "pending", payment_status: "pendiente", is_archived: false },
        { id: "o3", seller_id: "seller-1", status: "in_Completed", payment_status: "parcial", is_archived: false },
      ],
    });

    const archived = await handleSellerOrderAction({ action: "archive", order_id: "o1" }, env);
    const pending = await handleSellerOrderAction({ action: "archive", order_id: "o2" }, env);
    const partial = await handleSellerOrderAction({ action: "archive", order_id: "o3" }, env);

    expect(archived.status).toBe(200);
    expect(archived.body.order.is_archived).toBe(true);
    expect(pending.status).toBe(409);
    expect(partial.status).toBe(409);
  });
});
