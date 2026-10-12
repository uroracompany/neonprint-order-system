import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
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
  if (filter.type === "in") return filter.values.includes(row[filter.field]);
  if (filter.type === "is" && filter.value === null) return row[filter.field] === null || row[filter.field] === undefined;
  if (filter.type === "is") return row[filter.field] === filter.value;
  if (filter.type === "not" && filter.operator === "is" && filter.value === null) return row[filter.field] !== null && row[filter.field] !== undefined;
  if (filter.type === "neq") return row[filter.field] !== filter.value;
  if (filter.type === "gte") return new Date(row[filter.field]) >= new Date(filter.value);
  if (filter.type === "lt") return new Date(row[filter.field]) < new Date(filter.value);
  if (filter.type === "or") return applyOrFilter(row, filter.expression);
  return true;
}));

function makeSelectBuilder(rows) {
  const state = { filters: [], order: null, range: null, limit: null };
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
    if (state.limit !== null) filtered = filtered.slice(0, state.limit);
    return { rows: filtered, count };
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
    is(field, value) {
      state.filters.push({ type: "is", field, value });
      return builder;
    },
    not(field, operator, value) {
      state.filters.push({ type: "not", field, operator, value });
      return builder;
    },
    neq(field, value) {
      state.filters.push({ type: "neq", field, value });
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
    limit(value) {
      state.limit = value;
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
  orderEvents = [],
  batchCatalogResult = {},
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
    select: vi.fn(() => makeSelectBuilder(table === "profiles" ? profileRows : table === "order_events" ? orderEvents : orders)),
    update: vi.fn((updates) => makeUpdateBuilder(table === "profiles" ? profileRows : orders, updates)),
  }));

  const rpc = vi.fn(async (name, args = {}) => {
    if (name === "semi_admin_get_orders_command_catalog") {
      return { data: batchCatalogResult, error: null };
    }
    const order = orders.find((item) => item.id === args.p_order_id);
    if (!order) return { data: null, error: { message: "No rows found" } };
    if (args.p_expected_updated_at && order.updated_at && args.p_expected_updated_at !== order.updated_at) {
      return { data: null, error: { message: "ORDER_STALE" } };
    }
    if (name === "seller_update_order") Object.assign(order, args.p_changes, { updated_at: order.updated_at || "updated" });
    if (name === "seller_cancel_order") Object.assign(order, { status: "cancelled", cancellation_reason: args.p_reason });
    if (name === "semi_admin_cancel_owned_unpaid_order") Object.assign(order, { status: "cancelled", cancellation_reason: args.p_reason });
    if (name === "seller_send_order_to_designer") Object.assign(order, { status: "in_Design", designer_id: args.p_designer_id, return_reason: null, returned_to_designer_at: null });
    if (name === "seller_send_order_to_quote") Object.assign(order, { status: "in_Quote", quote_id: args.p_quote_id, return_reason: null, returned_to_designer_at: null });
    if (name === "seller_set_order_archive") Object.assign(order, { is_archived: args.p_archived });
    return { data: { ...order }, error: null };
  });

  return { auth: { getUser }, from, rpc, getUser, orders };
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

  it("retains ownership fields in Semi-Admin list and recent-order projections", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "owned", seller_id: "semi-1", created_by: "seller-2", status: "Pending", payment_status: "Pending_Payment", created_at: "2026-09-06T10:00:00.000Z", is_archived: false },
      ],
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: true }, env);
    const orderSelects = currentClient.from.mock.results
      .filter(({ value }) => value?.select)
      .map(({ value }) => value.select.mock.calls[0]?.[0]);

    expect(result.status).toBe(200);
    expect(result.body.orders[0]).toMatchObject({ seller_id: "semi-1", created_by: "seller-2" });
    expect(result.body.recent_orders[0]).toMatchObject({ seller_id: "semi-1", created_by: "seller-2" });
    expect(orderSelects.filter((columns) => String(columns).includes("seller_id")).length).toBeGreaterThanOrEqual(2);
    expect(orderSelects.filter((columns) => String(columns).includes("created_by")).length).toBeGreaterThanOrEqual(2);
  });

  it("fetches one deduplicated batch catalog only for Semi-Admin and projects the safe row payload", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "order-1", seller_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "Pending", payment_status: "Pending_Payment", created_at: "2026-09-27T10:00:00.000Z", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false },
        { id: "order-2", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", payment_status: "Pending_Payment", created_at: "2026-09-26T10:00:00.000Z", updated_at: "2026-09-26T10:01:00.000Z", is_archived: false },
        { id: "wrong-designer", seller_id: "semi-1", designer_id: "designer-2", order_design_type: "INTERNAL_DESING", status: "in_Design", payment_status: "Pending_Payment", created_at: "2026-09-24T10:00:00.000Z", updated_at: "2026-09-24T10:01:00.000Z", is_archived: false },
        { id: "foreign-internal", seller_id: "seller-2", created_by: "seller-2", quote_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "Pending", created_at: "2026-09-25T10:00:00.000Z", updated_at: "2026-09-25T10:01:00.000Z", is_archived: false },
      ],
      batchCatalogResult: {
        "order-1": {
          order_id: "order-1",
          order_updated_at: "2026-09-27T10:01:00.000Z",
      actions: [
        { key: "send_to_designer", title: "Enviar a Diseño", context: { secret: true } },
        { key: "send_to_quote", title: "Enviar a Caja", requires_reason: true },
        { key: "route_production", title: "Enviar a Producción" },
          ],
          events: [{ private: true }],
        },
        "order-2": {
          order_id: "order-2",
          order_updated_at: "2026-09-26T10:01:00.000Z",
          actions: [{ key: "send_design_to_quote", title: "Enviar a Caja", candidates: ["private"] }],
        },
        "wrong-designer": {
          order_id: "wrong-designer",
          order_updated_at: "2026-09-24T10:01:00.000Z",
          actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }],
        },
        "foreign-internal": {
          order_id: "foreign-internal",
          order_updated_at: "2026-09-25T10:01:00.000Z",
          actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }],
        },
      },
    });

    const result = await handleSellerOrderAction({ action: "list", page: 1, pageSize: 1 }, env);
    const batchCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_orders_command_catalog");

    expect(result.status).toBe(200);
    expect(batchCalls).toHaveLength(1);
    expect(new Set(batchCalls[0][1].p_order_ids)).toEqual(new Set(["order-1", "order-2", "wrong-designer", "foreign-internal"]));
    expect(result.body.operational_catalogs["order-1"]).toEqual({
      order_id: "order-1",
      order_updated_at: "2026-09-27T10:01:00.000Z",
      actions: [
        { key: "send_to_designer", title: "Enviar a Diseño" },
      ],
    });
    expect(result.body.operational_catalogs["order-2"]).toEqual({
      order_id: "order-2",
      order_updated_at: "2026-09-26T10:01:00.000Z",
      actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }],
    });
    expect(result.body.operational_catalogs["foreign-internal"]).toBeUndefined();
    expect(result.body.operational_catalogs["wrong-designer"]).toBeUndefined();
  });

  it("reconciles a missing Design-to-Caja action from the individual catalog after a successful batch response", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "internal-design", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: "2026-09-27T10:00:00.000Z" },
        { id: "external", seller_id: "semi-1", order_design_type: "EXTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: "2026-09-26T10:00:00.000Z" },
      ],
      batchCatalogResult: {
        "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] },
      },
    });
    currentClient.rpc.mockImplementation(async (name) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: { "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] } }, error: null };
      }
      if (name === "semi_admin_get_order_command_catalog") {
        return { data: { version: updatedAt, locked: false, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja", context: { private: true } }] }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);
    const unitCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_order_command_catalog");

    expect(result.status).toBe(200);
    expect(unitCalls).toEqual([["semi_admin_get_order_command_catalog", { p_order_id: "internal-design" }]]);
    expect(result.body.operational_catalogs).toEqual({
      "internal-design": {
        order_id: "internal-design",
        order_updated_at: updatedAt,
        actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }],
      },
    });
  });

  it("projects Design-to-Sales only when the individual operational catalog authorizes it", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "authorized", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: updatedAt },
        { id: "not-authorized", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: "2026-09-26T10:00:00.000Z" },
      ],
      batchCatalogResult: {
        authorized: { order_id: "authorized", order_updated_at: updatedAt, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] },
        "not-authorized": { order_id: "not-authorized", order_updated_at: updatedAt, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] },
      },
    });
    currentClient.rpc.mockImplementation(async (name, args = {}) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: currentClient.orders.reduce((result, order) => ({ ...result, [order.id]: { order_id: order.id, order_updated_at: updatedAt, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] } }), {}), error: null };
      }
      if (name === "semi_admin_get_order_command_catalog") {
        const canReturn = args.p_order_id === "authorized";
        return { data: { version: updatedAt, locked: false, actions: [
          { key: "send_design_to_quote", title: "Enviar a Caja" },
          ...(canReturn ? [{ key: "return_design_to_sales", title: "Regresar a Ventas" }] : []),
        ] }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(result.body.operational_catalogs.authorized.actions).toEqual([
      { key: "send_design_to_quote", title: "Enviar a Caja" },
      { key: "return_design_to_sales", title: "Devolver a Ventas" },
    ]);
    expect(result.body.operational_catalogs["not-authorized"].actions).toEqual([
      { key: "send_design_to_quote", title: "Enviar a Caja" },
    ]);
  });

  it("projects Caja-to-previous-stage only with a matching audited route and payment correction", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    const orderEvents = [
      { id: "route-valid", order_id: "history-valid", event_type: "semi_admin_send_to_quote", old_status: "Pending", new_status: "in_Quote", created_at: "2026-09-27T09:00:00.000Z" },
      { id: "payment-valid", order_id: "history-valid", event_type: "semi_admin_payment_updated", old_payment_status: "pagado", new_payment_status: "Pending_Payment", changes: { correction: "paid_to_pending_in_quote" }, created_at: "2026-09-27T09:30:00.000Z" },
    ];
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "history-valid", seller_id: "semi-1", quote_id: "cashier-1", order_design_type: "EXTERNAL_DESING", status: "in_Quote", payment_status: "Pending_Payment", updated_at: updatedAt, is_archived: false, created_at: updatedAt },
        { id: "history-missing", seller_id: "semi-1", quote_id: "cashier-1", order_design_type: "EXTERNAL_DESING", status: "in_Quote", payment_status: "Pending_Payment", updated_at: updatedAt, is_archived: false, created_at: "2026-09-26T10:00:00.000Z" },
      ],
      orderEvents,
      batchCatalogResult: {},
    });
    currentClient.rpc.mockImplementation(async (name) => {
      if (name === "semi_admin_get_orders_command_catalog") return { data: {}, error: null };
      if (name === "semi_admin_get_order_command_catalog") {
        return { data: { version: updatedAt, locked: false, actions: [] }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(result.body.operational_catalogs["history-valid"].actions).toEqual([
      { key: "return_quote_to_previous_stage", title: "Regresar a Ventas", target_stage: "sales", requires_reason: true },
    ]);
    expect(result.body.operational_catalogs["history-missing"]).toBeUndefined();
  });

  it.each([
    { label: "individual catalog omits the action", catalog: { version: "2026-09-27T10:01:00.000Z", locked: false, actions: [] } },
    { label: "individual catalog is locked", catalog: { version: "2026-09-27T10:01:00.000Z", locked: true, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] } },
    { label: "individual catalog is stale", catalog: { version: "2026-09-27T10:01:01.000Z", locked: false, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] } },
  ])("fails closed when the individual catalog does not authorize reconciliation: $label", async ({ catalog }) => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "internal-design", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
      batchCatalogResult: {
        "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] },
      },
    });
    currentClient.rpc.mockImplementation(async (name) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: { "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] } }, error: null };
      }
      if (name === "semi_admin_get_order_command_catalog") return { data: catalog, error: null };
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(result.body.operational_catalogs["internal-design"]?.actions || []).toEqual([]);
  });

  it("keeps the reconciled action hidden when the order changes during the individual lookup", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "internal-design", seller_id: "semi-1", designer_id: "semi-1", order_design_type: "INTERNAL_DESING", status: "in_Design", updated_at: updatedAt, is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
      batchCatalogResult: {
        "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] },
      },
    });
    currentClient.rpc.mockImplementation(async (name) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: { "internal-design": { order_id: "internal-design", order_updated_at: updatedAt, actions: [] } }, error: null };
      }
      if (name === "semi_admin_get_order_command_catalog") {
        currentClient.orders[0].updated_at = "2026-09-27T10:02:00.000Z";
        return { data: { version: updatedAt, locked: false, actions: [{ key: "send_design_to_quote", title: "Enviar a Caja" }] }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(result.body.operational_catalogs["internal-design"]?.actions || []).toEqual([]);
  });

  it("uses the authenticated unit catalog when the batch RPC is unavailable", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "internal", created_by: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-27T10:00:00.000Z" },
        { id: "external", seller_id: "semi-1", status: "pending", order_design_type: "EXTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-26T10:00:00.000Z" },
        { id: "unrelated", seller_id: "seller-2", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-25T10:00:00.000Z" },
      ],
    });
    currentClient.rpc.mockImplementation(async (name, args = {}) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function public.semi_admin_get_orders_command_catalog(p_order_ids) in the schema cache" } };
      }
      if (name === "semi_admin_get_order_command_catalog") {
        const action = args.p_order_id === "internal" ? "send_to_designer" : "send_to_quote";
        return { data: {
          version: updatedAt,
          locked: false,
          actions: [{ key: action, title: action === "send_to_designer" ? "Enviar a Diseño" : "Enviar a Caja", context: { mustNotEscape: true } }],
          events: [{ private: true }],
        }, error: null };
      }
      return { data: null, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", page: 1, pageSize: 10 }, env);
    const unitCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_order_command_catalog");
    const relationshipSelects = currentClient.from.mock.results
      .map(({ value }) => value)
      .filter((builder) => builder?.select)
      .flatMap((builder) => builder.select.mock.calls.map(([columns]) => String(columns)))
      .filter((columns) => columns.includes("designer_id") && columns.includes("quote_id") && columns.includes("delivery_id"));

    expect(result.status).toBe(200);
    expect(unitCalls.map(([, args]) => args.p_order_id).sort()).toEqual(["external", "internal"]);
    expect(relationshipSelects.length).toBeGreaterThanOrEqual(2);
    expect(result.body.operational_catalogs).toEqual({
      internal: { order_id: "internal", order_updated_at: updatedAt, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] },
      external: { order_id: "external", order_updated_at: updatedAt, actions: [{ key: "send_to_quote", title: "Enviar a Caja" }] },
    });
  });

  it("does not expose the internal assignment action to a non-owner who is only a different-stage participant", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "foreign-internal", seller_id: "seller-2", created_by: "seller-2", quote_id: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
    });
    currentClient.rpc.mockImplementation(async (name) => name === "semi_admin_get_orders_command_catalog"
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.semi_admin_get_orders_command_catalog(uuid[]) in the schema cache" } }
      : { data: { version: "2026-09-27T10:01:00.000Z", locked: false, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] }, error: null });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledTimes(1);
    expect(result.body.operational_catalogs).toEqual({});
  });

  it("does not call the unit catalog for a listed Semi-Admin order without participant relation", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "unrelated", seller_id: "seller-2", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
    });
    currentClient.rpc.mockImplementation(async (name) => name === "semi_admin_get_orders_command_catalog"
      ? { data: null, error: { code: "PGRST202", message: "Could not find the function public.semi_admin_get_orders_command_catalog(uuid[]) in the schema cache" } }
      : { data: null, error: null });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledTimes(1);
    expect(result.body.operational_catalogs).toEqual({});
  });

  it.each([
    { code: "PGRST202", message: "Could not find the function semi_admin_get_orders_command_catalog(p_order_ids) in the schema cache" },
    { code: "42883", message: "function public.semi_admin_get_orders_command_catalog(uuid[]) does not exist" },
    { code: "42883", message: "function public.semi_admin_get_order_command_catalog(uuid) does not exist" },
    { code: "42883", message: "function public.semi_admin_get_order_command_catalog_before_cashier_routing(uuid) does not exist" },
    { code: "42883", message: "function public.semi_admin_get_order_command_catalog_base(uuid) does not exist" },
    { code: "42883", message: "function public.semi_admin_is_order_routing_responsible(uuid, uuid) does not exist" },
  ])("uses the authenticated bounded fallback for an allow-listed missing catalog function (%s)", async (batchError) => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "owned", seller_id: "semi-1", designer_id: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
    });
    currentClient.rpc.mockImplementation(async (name) => name === "semi_admin_get_orders_command_catalog"
      ? { data: null, error: batchError }
      : { data: { version: "2026-09-27T10:01:00.000Z", locked: false, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] }, error: null });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);
    const unitCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_order_command_catalog");

    expect(result.status).toBe(200);
    expect(unitCalls).toHaveLength(1);
    expect(unitCalls[0][1]).toEqual({ p_order_id: "owned" });
    expect(result.body.operational_catalogs).toEqual({
      owned: {
        order_id: "owned",
        order_updated_at: "2026-09-27T10:01:00.000Z",
        actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }],
      },
    });
  });

  it.each([
    { code: "42501", message: "permission denied for function semi_admin_get_orders_command_catalog" },
    { code: "401", message: "JWT expired" },
    { code: "429", message: "Too Many Requests" },
    { code: "500", message: "server error" },
    { code: "XX000", message: "database failure" },
    { code: "FETCH_ERROR", message: "network timeout" },
    { code: "42883", message: "function public.internal_catalog_dependency(uuid) does not exist while processing semi_admin_get_orders_command_catalog" },
    { code: "PGRST202", message: "Could not find the function public.other_order_catalog(uuid[]) in the schema cache; semi_admin_get_orders_command_catalog was requested by the caller" },
    { code: "22023", message: "function public.semi_admin_get_orders_command_catalog(uuid[]) does not exist" },
  ])("does not retry non-recoverable or unrelated batch failures (%s)", async (batchError) => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "owned", seller_id: "semi-1", designer_id: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
    });
    currentClient.rpc.mockImplementation(async (name) => name === "semi_admin_get_orders_command_catalog"
      ? { data: null, error: batchError }
      : { data: { version: "2026-09-27T10:01:00.000Z", locked: false, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] }, error: null });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);

    expect(result.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledTimes(1);
    expect(result.body.operational_catalogs).toEqual({});
  });

  it("fails closed without retry when batch catalog permission is denied", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [{ id: "owned", seller_id: "semi-1", designer_id: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: "2026-09-27T10:01:00.000Z", is_archived: false, created_at: "2026-09-27T10:00:00.000Z" }],
    });
    currentClient.rpc.mockImplementation(async (name) => name === "semi_admin_get_orders_command_catalog"
      ? { data: null, error: { code: "42501", message: "permission denied" } }
      : { data: null, error: { code: "42501", message: "permission denied for unit catalog" } });

    const result = await handleSellerOrderAction({ action: "list", includeDashboard: false }, env);
    const unitCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_order_command_catalog");

    expect(result.status).toBe(200);
    expect(unitCalls).toHaveLength(0);
    expect(result.body.operational_catalogs).toEqual({});
  });

  it("fails closed for malformed or stale unit catalogs and a changed order after lookup", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "array", created_by: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-27T10:00:00.000Z" },
        { id: "stale", seller_id: "semi-1", status: "Pending", order_design_type: "INTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-26T10:00:00.000Z" },
        { id: "changed", quote_id: "semi-1", status: "Pending", order_design_type: "EXTERNAL_DESING", updated_at: updatedAt, is_archived: false, created_at: "2026-09-25T10:00:00.000Z" },
      ],
    });
    currentClient.rpc.mockImplementation(async (name, args = {}) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function public.semi_admin_get_orders_command_catalog(uuid[]) in the schema cache" } };
      }
      if (args.p_order_id === "array") return { data: [], error: null };
      if (args.p_order_id === "stale") return { data: { version: "2026-09-27T10:01:01.000Z", locked: false, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] }, error: null };
      const order = currentClient.orders.find(({ id }) => id === "changed");
      order.updated_at = "2026-09-27T10:02:00.000Z";
      return { data: { version: updatedAt, locked: false, actions: [{ key: "send_to_quote", title: "Enviar a Caja" }] }, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", page: 1, pageSize: 10 }, env);

    expect(result.status).toBe(200);
    expect(result.body.operational_catalogs).toEqual({});
  });

  it("bounds unit fallback concurrency to four and deduplicates page/recent order IDs", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    const orders = Array.from({ length: 10 }, (_, index) => ({
      id: `o-${index}`,
      created_by: "semi-1",
      designer_id: "semi-1",
      status: "Pending",
      order_design_type: "INTERNAL_DESING",
      updated_at: updatedAt,
      is_archived: false,
      created_at: new Date(Date.UTC(2026, 8, 27, 10, 0, index)).toISOString(),
    }));
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders,
    });
    let active = 0;
    let maxActive = 0;
    currentClient.rpc.mockImplementation(async (name) => {
      if (name === "semi_admin_get_orders_command_catalog") {
        return { data: null, error: { code: "PGRST202", message: "Could not find the function public.semi_admin_get_orders_command_catalog(uuid[]) in the schema cache" } };
      }
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      return { data: { version: updatedAt, locked: false, actions: [{ key: "send_to_designer", title: "Enviar a Diseño" }] }, error: null };
    });

    const result = await handleSellerOrderAction({ action: "list", page: 1, pageSize: 10 }, env);
    const unitCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_order_command_catalog");

    expect(result.status).toBe(200);
    expect(unitCalls).toHaveLength(10);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(Object.keys(result.body.operational_catalogs)).toHaveLength(10);
  });

  it("caps 105 deduplicated page/recent order IDs at 100 while prioritizing the five recent orders", async () => {
    const updatedAt = "2026-09-27T10:01:00.000Z";
    const orders = Array.from({ length: 205 }, (_, index) => ({
      id: `o-${index}`,
      created_by: "semi-1",
      designer_id: "semi-1",
      status: "Pending",
      order_design_type: "INTERNAL_DESING",
      updated_at: updatedAt,
      is_archived: false,
      created_at: new Date(Date.UTC(2026, 8, 27, 10, 0, 205 - index)).toISOString(),
    }));
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders,
    });

    const result = await handleSellerOrderAction({ action: "list", page: 2, pageSize: 100 }, env);
    const batchCalls = currentClient.rpc.mock.calls.filter(([name]) => name === "semi_admin_get_orders_command_catalog");
    const requestedIds = batchCalls[0]?.[1]?.p_order_ids || [];

    expect(result.status).toBe(200);
    expect(result.body.orders).toHaveLength(100);
    expect(result.body.recent_orders).toHaveLength(5);
    expect(batchCalls).toHaveLength(1);
    expect(requestedIds).toHaveLength(100);
    expect(requestedIds.slice(0, 5)).toEqual(["o-0", "o-1", "o-2", "o-3", "o-4"]);
    expect(requestedIds).toContain("o-194");
    expect(requestedIds).not.toContain("o-195");
    expect(requestedIds).not.toContain("o-199");
    expect(new Set(requestedIds).size).toBe(100);
    expect(currentClient.rpc).not.toHaveBeenCalledWith("semi_admin_get_order_command_catalog", expect.anything());
  });

  it("does not request the Semi-Admin batch catalog for a Sales user", async () => {
    currentClient = makeSellerOrderClient({
      orders: [{ id: "sales-order", seller_id: "seller-1", status: "Pending", created_at: "2026-09-27T10:00:00.000Z", is_archived: false }],
    });

    const result = await handleSellerOrderAction({ action: "list" }, env);

    expect(result.status).toBe(200);
    expect(currentClient.rpc).not.toHaveBeenCalledWith("semi_admin_get_orders_command_catalog", expect.anything());
    expect(result.body).not.toHaveProperty("operational_catalogs");
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

  it("filters overdue seller orders before exact count, chronology, and pagination", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "recent-overdue", seller_id: "seller-1", status: "in_Production", payment_status: "pendiente", delivery_date: "2026-07-27", created_at: "2026-07-28T11:00:00.000Z", is_archived: false },
        { id: "older-overdue", seller_id: "seller-1", status: "pending", payment_status: "pendiente", delivery_date: "2026-07-20", created_at: "2026-07-28T09:00:00.000Z", is_archived: false },
        { id: "due-today", seller_id: "seller-1", status: "pending", payment_status: "pendiente", delivery_date: "2026-07-28", created_at: "2026-07-28T12:00:00.000Z", is_archived: false },
        { id: "delivered", seller_id: "seller-1", status: "in_Delivered", payment_status: "pagado", delivery_date: "2026-07-20", created_at: "2026-07-28T13:00:00.000Z", is_archived: false },
        { id: "cancelled", seller_id: "seller-1", status: "cancelled", payment_status: "pendiente", delivery_date: "2026-07-20", created_at: "2026-07-28T14:00:00.000Z", is_archived: false },
        { id: "no-date", seller_id: "seller-1", status: "pending", payment_status: "pendiente", delivery_date: null, created_at: "2026-07-28T15:00:00.000Z", is_archived: false },
      ],
    });

    const firstPage = await handleSellerOrderAction({
      action: "list",
      overdue: true,
      page: 1,
      pageSize: 1,
      includeDashboard: false,
    }, { ...env, now: "2026-07-28T16:00:00.000Z" });
    const secondPage = await handleSellerOrderAction({
      action: "list",
      overdue: true,
      page: 2,
      pageSize: 1,
      includeDashboard: false,
    }, { ...env, now: "2026-07-28T16:00:00.000Z" });

    expect(firstPage.status).toBe(200);
    expect(firstPage.body.orders.map((order) => order.id)).toEqual(["recent-overdue"]);
    expect(firstPage.body.total).toBe(2);
    expect(firstPage.body.totalPages).toBe(2);
    expect(secondPage.body.orders.map((order) => order.id)).toEqual(["older-overdue"]);
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

  it("includes orders created by the seller even when seller_id is missing", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "o1", seller_id: null, created_by: "seller-1", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T10:00:00.000Z", is_archived: false },
        { id: "o2", seller_id: "seller-2", created_by: "seller-1", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T11:00:00.000Z", is_archived: false },
        { id: "o3", seller_id: null, created_by: "seller-2", status: "pending", payment_status: "pendiente", created_at: "2026-07-28T12:00:00.000Z", is_archived: false },
      ],
    });

    const result = await handleSellerOrderAction({ action: "list", page: 1, pageSize: 10 }, env);

    expect(result.status).toBe(200);
    expect(result.body.orders.map((order) => order.id)).toEqual(["o2", "o1"]);
    expect(result.body.orders.some((order) => order.id === "o3")).toBe(false);
  });

  it("updates editable fields on an owned order without allowing protected fields", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        {
          id: "o1",
          seller_id: "seller-1",
          created_by: null,
          status: "pending",
          payment_status: "pendiente",
          client_name: "Cliente viejo",
          description: "Descripcion vieja",
          updated_at: "2026-07-28T10:00:00.000Z",
          is_archived: false,
        },
      ],
    });

    const result = await handleSellerOrderAction({
      action: "update",
      order_id: "o1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
      changes: {
        client_name: "Cliente nuevo",
        description: "Descripcion nueva",
        status: "cancelled",
        payment_status: "pagado",
        seller_id: "seller-2",
      },
    }, env);

    expect(result.status).toBe(200);
    expect(result.body.order.client_name).toBe("Cliente nuevo");
    expect(result.body.order.description).toBe("Descripcion nueva");
    expect(result.body.order.status).toBe("pending");
    expect(result.body.order.payment_status).toBe("pendiente");
    expect(result.body.order.seller_id).toBe("seller-1");
  });

  it("blocks seller edits for quote, archived, stale, and foreign orders", async () => {
    currentClient = makeSellerOrderClient({
      orders: [
        { id: "quote", seller_id: "seller-1", status: "in_Quote", updated_at: "2026-07-28T10:00:00.000Z", is_archived: false },
        { id: "archived", seller_id: "seller-1", status: "pending", updated_at: "2026-07-28T10:00:00.000Z", is_archived: true },
        { id: "stale", seller_id: "seller-1", status: "pending", updated_at: "2026-07-28T10:00:00.000Z", is_archived: false },
        { id: "foreign", seller_id: "seller-2", status: "pending", updated_at: "2026-07-28T10:00:00.000Z", is_archived: false },
      ],
    });

    const quote = await handleSellerOrderAction({ action: "update", order_id: "quote", changes: { description: "Nueva" } }, env);
    const archived = await handleSellerOrderAction({ action: "update", order_id: "archived", changes: { description: "Nueva" } }, env);
    const stale = await handleSellerOrderAction({
      action: "update",
      order_id: "stale",
      expected_updated_at: "2026-07-28T09:00:00.000Z",
      changes: { description: "Nueva" },
    }, env);
    const foreign = await handleSellerOrderAction({ action: "update", order_id: "foreign", changes: { description: "Nueva" } }, env);

    expect(quote.status).toBe(409);
    expect(archived.status).toBe(409);
    expect(stale.status).toBe(409);
    expect(foreign.status).toBe(403);
  });

  it("returns 409 when the command detects a write-time stale version", async () => {
    currentClient = makeSellerOrderClient({
      orders: [{ id: "o1", seller_id: "seller-1", status: "pending", updated_at: "2026-07-28T10:00:00.000Z", is_archived: false }],
    });
    currentClient.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "ORDER_STALE" } }));

    const result = await handleSellerOrderAction({
      action: "update",
      order_id: "o1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
      changes: { description: "No debe sobrescribir" },
    }, env);

    expect(result.status).toBe(409);
    expect(currentClient.orders[0].description).toBeUndefined();
    expect(currentClient.from).not.toHaveBeenCalledWith("order_production_files");
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

  it("allows Semi-Administración to cancel only its owned unpaid pre-production orders", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      orders: [
        { id: "pending", seller_id: "semi-1", status: "Pending", payment_status: "Pending_Payment", updated_at: "2026-09-06T10:00:00.000Z" },
        { id: "design", created_by: "semi-1", status: "in_Design", payment_status: "Pending_Payment", updated_at: "2026-09-06T10:00:00.000Z" },
        { id: "quote", seller_id: "semi-1", status: "in_Quote", payment_status: "Pending_Payment", updated_at: "2026-09-06T10:00:00.000Z" },
        { id: "foreign", seller_id: "seller-2", status: "Pending", payment_status: "Pending_Payment", updated_at: "2026-09-06T10:00:00.000Z" },
        { id: "production", seller_id: "semi-1", status: "in_Production", payment_status: "Pending_Payment", updated_at: "2026-09-06T10:00:00.000Z" },
        { id: "paid", seller_id: "semi-1", status: "Pending", payment_status: "pagado", updated_at: "2026-09-06T10:00:00.000Z" },
      ],
    });

    for (const id of ["pending", "design", "quote"]) {
      const result = await handleSellerOrderAction({ action: "cancel", order_id: id, reason: "Cliente desistió" }, env);
      expect(result.status).toBe(200);
      expect(result.body.order.status).toBe("cancelled");
    }

    const foreign = await handleSellerOrderAction({ action: "cancel", order_id: "foreign", reason: "No autorizado" }, env);
    const production = await handleSellerOrderAction({ action: "cancel", order_id: "production", reason: "Ya inició" }, env);
    const paid = await handleSellerOrderAction({ action: "cancel", order_id: "paid", reason: "Pagada" }, env);
    const missingReason = await handleSellerOrderAction({ action: "cancel", order_id: "pending", reason: "" }, env);

    expect(foreign.status).toBe(403);
    expect(production.status).toBe(409);
    expect(paid.status).toBe(409);
    expect(missingReason.status).toBe(400);
    expect(currentClient.rpc).toHaveBeenCalledWith("semi_admin_cancel_owned_unpaid_order", expect.objectContaining({
      p_order_id: "pending",
      p_expected_updated_at: "2026-09-06T10:00:00.000Z",
    }));
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
    const inactive = await handleSellerOrderAction({ action: "send_to_designer", order_id: "o1", designer_id: "inactive-designer" }, env);

    expect(designer.status).toBe(200);
    expect(designer.body.order.status).toBe("in_Design");
    expect(designer.body.order.designer_id).toBe("designer-1");
    expect(inactive.status).toBe(400);
  });

  it("fails closed for missing, deleted, or inactive Semi-Admin designer targets before invoking the gateway", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      profiles: [
        { id: "designer-1", role: "designer", employment_status: true, deleted_at: null },
        { id: "deleted-designer", role: "designer", employment_status: true, deleted_at: "2026-09-01T00:00:00.000Z" },
        { id: "inactive-designer", role: "designer", employment_status: false, deleted_at: null },
      ],
      orders: [{
        id: "semi-order",
        seller_id: "semi-1",
        created_by: "semi-1",
        status: "Pending",
        order_design_type: "INTERNAL_DESING",
        updated_at: "2026-09-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    for (const designerId of ["missing-designer", "deleted-designer", "inactive-designer"]) {
      const rejected = await handleSellerOrderAction({
        action: "send_to_designer",
        order_id: "semi-order",
        designer_id: designerId,
      }, env);
      expect([400, 404]).toContain(rejected.status);
      expect(currentClient.rpc).not.toHaveBeenCalled();
    }
  });

  it("routes EXTERNAL_DESING order from Pending to in_Quote via send_to_quote", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);

    expect(result.status).toBe(200);
    expect(result.body.order.status).toBe("in_Quote");
    expect(result.body.order.quote_id).toBe("quote-1");
    expect(result.body.order.return_reason).toBeNull();
    expect(result.body.order.returned_to_designer_at).toBeNull();
  });

  it("allows Semi-Admin external routing only to an active non-deleted Caja profile", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      profiles: [
        { id: "cashier-1", role: "quote", employment_status: null, deleted_at: null },
        { id: "semi-2", role: "semi_admin", employment_status: true, deleted_at: null },
        { id: "deleted-cashier", role: "quote", employment_status: true, deleted_at: "2026-09-01T00:00:00.000Z" },
      ],
      orders: [{
        id: "semi-external",
        seller_id: "semi-1",
        created_by: "semi-1",
        status: "Pending",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-09-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const valid = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "semi-external",
      quote_user_id: "cashier-1",
      expected_updated_at: "2026-09-28T10:00:00.000Z",
    }, env);
    expect(valid.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledWith("semi_admin_execute_order_command", expect.objectContaining({
      p_action: "send_to_quote",
      p_payload: { target_user_id: "cashier-1" },
    }));

    for (const quoteUserId of ["semi-2", "deleted-cashier"]) {
      currentClient.rpc.mockClear();
      const rejected = await handleSellerOrderAction({
        action: "send_to_quote",
        order_id: "semi-external",
        quote_user_id: quoteUserId,
        expected_updated_at: "2026-09-28T10:00:00.000Z",
      }, env);
      expect(rejected.status).toBe(400);
      expect(currentClient.rpc).not.toHaveBeenCalled();
    }
  });

  it("allows only the related Semi-Admin seller/creator to send an external order to Caja", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-creator",
      currentProfile: { id: "semi-creator", name: "Semi Creator", email: "creator@example.com", role: "semi_admin", employment_status: true },
      profiles: [{ id: "cashier-1", role: "quote", employment_status: true, deleted_at: null }],
      orders: [{
        id: "created-external",
        seller_id: "seller-1",
        created_by: "semi-creator",
        status: "Pending",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-09-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const related = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "created-external",
      quote_user_id: "cashier-1",
      expected_updated_at: "2026-09-28T10:00:00.000Z",
    }, env);
    expect(related.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledWith("semi_admin_execute_order_command", expect.objectContaining({
      p_order_id: "created-external",
      p_action: "send_to_quote",
    }));

    currentClient = makeSellerOrderClient({
      tokenUserId: "unrelated-semi",
      currentProfile: { id: "unrelated-semi", name: "Unrelated Semi", email: "other@example.com", role: "semi_admin", employment_status: true },
      profiles: [{ id: "cashier-1", role: "quote", employment_status: true, deleted_at: null }],
      orders: [{
        id: "created-external",
        seller_id: "seller-1",
        created_by: "semi-creator",
        status: "Pending",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-09-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const unrelated = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "created-external",
      quote_user_id: "cashier-1",
      expected_updated_at: "2026-09-28T10:00:00.000Z",
    }, env);
    expect(unrelated.status).toBe(403);
    expect(currentClient.rpc).not.toHaveBeenCalled();
  });

  it("preflights Caja role and availability before Semi-Admin quote-stage reassignment", async () => {
    currentClient = makeSellerOrderClient({
      tokenUserId: "semi-1",
      currentProfile: { id: "semi-1", name: "Semi", email: "semi@example.com", role: "semi_admin", employment_status: true },
      profiles: [
        { id: "cashier-1", role: "quote", employment_status: true, deleted_at: null },
        { id: "semi-2", role: "semi_admin", employment_status: true, deleted_at: null },
        { id: "inactive-cashier", role: "quote", employment_status: false, deleted_at: null },
      ],
      orders: [{
        id: "semi-in-quote",
        seller_id: "semi-1",
        created_by: "semi-1",
        status: "in_Quote",
        updated_at: "2026-09-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const valid = await handleSellerOrderAction({
      action: "stage_responsibility",
      order_id: "semi-in-quote",
      stage: "quote",
      assignee_id: "cashier-1",
      expected_updated_at: "2026-09-28T10:00:00.000Z",
    }, env);
    expect(valid.status).toBe(200);
    expect(currentClient.rpc).toHaveBeenCalledWith("semi_admin_execute_order_command", expect.objectContaining({
      p_action: "stage_responsibility",
      p_payload: expect.objectContaining({ stage: "quote", assignee_id: "cashier-1" }),
    }));

    for (const assigneeId of ["semi-2", "inactive-cashier"]) {
      currentClient.rpc.mockClear();
      const rejected = await handleSellerOrderAction({
        action: "stage_responsibility",
        order_id: "semi-in-quote",
        stage: "quote",
        assignee_id: assigneeId,
        expected_updated_at: "2026-09-28T10:00:00.000Z",
      }, env);
      expect(rejected.status).toBe(400);
      expect(currentClient.rpc).not.toHaveBeenCalled();
    }
  });

  it("rejects send_to_quote for INTERNAL_DESING orders", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "INTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("Solo órdenes de Diseño Externo");
  });

  it("rejects send_to_quote when order is not in Pending status", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "in_Design",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("debe estar en Ventas");
  });

  it("rejects send_to_quote with stale expected_updated_at (optimistic locking)", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T09:00:00.000Z",
    }, env);

    expect(result.status).toBe(409);
    expect(result.body.error).toContain("cambio mientras");
  });

  it("rejects send_to_quote when quote user is inactive or wrong role", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: false },
        { id: "designer-1", role: "designer", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const inactive = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);
    expect(inactive.status).toBe(400);

    const wrongRole = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "designer-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);
    expect(wrongRole.status).toBe(400);
  });

  it("rejects send_to_quote when order is archived", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: true,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quote_user_id: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);

    expect(result.status).toBe(400);
    expect(result.body.error).toContain("no puede enviarse a Caja en este estado");
  });

  it("accepts quoteUserId camelCase alias for quote_user_id", async () => {
    currentClient = makeSellerOrderClient({
      profiles: [
        { id: "quote-1", role: "quote", employment_status: true },
      ],
      orders: [{
        id: "o1",
        seller_id: "seller-1",
        status: "pending",
        payment_status: "pendiente",
        order_design_type: "EXTERNAL_DESING",
        updated_at: "2026-07-28T10:00:00.000Z",
        is_archived: false,
      }],
    });

    const result = await handleSellerOrderAction({
      action: "send_to_quote",
      order_id: "o1",
      quoteUserId: "quote-1",
      expected_updated_at: "2026-07-28T10:00:00.000Z",
    }, env);

    expect(result.status).toBe(200);
    expect(result.body.order.status).toBe("in_Quote");
    expect(result.body.order.quote_id).toBe("quote-1");
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
