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

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  return true;
}));

function makeSelectBuilder(rows) {
  const state = { filters: [] };
  const builder = {
    eq(field, value) {
      state.filters.push({ type: "eq", field, value });
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
