import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer quote-token",
  now: "2026-07-28T12:00:00.000Z",
};

const parseOrFilter = (value) => String(value || "")
  .split(",")
  .map((part) => {
    const [field, operator, ...rest] = part.split(".");
    return { type: operator, field, value: rest.join(".") };
  })
  .filter((condition) => condition.field && condition.type === "eq");

const applyFilters = (rows, filters) => rows.filter((row) => filters.every((filter) => {
  if (filter.type === "eq") return row[filter.field] === filter.value;
  if (filter.type === "or") {
    return filter.conditions.some((condition) => {
      if (condition.type === "eq") return row[condition.field] === condition.value;
      return false;
    });
  }
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
    or(value) {
      state.filters.push({ type: "or", conditions: parseOrFilter(value) });
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

const makeQuoteProfileClient = ({
  tokenUserId = "quote-1",
  tokenError = null,
  currentProfile = {
    id: "quote-1",
    name: "Ana Quote",
    email: "ana@example.com",
    role: "quote",
    employment_status: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  profiles = [
    { id: "quote-1", name: "Ana Quote", email: "ana@example.com", role: "quote", employment_status: true },
    { id: "quote-2", name: "Bruno Quote", email: "bruno@example.com", role: "quote", employment_status: true },
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

describe("handleQuoteProfile", () => {
  let handleQuoteProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleQuoteProfile } = await import("../../server/quote-profile-handler.js"));
  });

  it("rejects requests without a token", async () => {
    currentClient = makeQuoteProfileClient();

    const result = await handleQuoteProfile({}, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("rejects inactive users and unsupported roles", async () => {
    currentClient = makeQuoteProfileClient({
      currentProfile: {
        id: "seller-1",
        name: "Ventas",
        email: "seller@example.com",
        role: "seller",
        employment_status: true,
      },
      tokenUserId: "seller-1",
    });

    const wrongRole = await handleQuoteProfile({}, env);
    expect(wrongRole.status).toBe(403);

    currentClient = makeQuoteProfileClient({
      currentProfile: {
        id: "quote-1",
        name: "Ana Quote",
        email: "ana@example.com",
        role: "quote",
        employment_status: false,
      },
    });

    const inactive = await handleQuoteProfile({}, env);
    expect(inactive.status).toBe(403);
  });

  it("ignores quote IDs from the payload and returns only authenticated quote analytics", async () => {
    currentClient = makeQuoteProfileClient({
      orders: [
        {
          id: "o1",
          quote_id: "quote-1",
          quotation_id: null,
          quote_user_id: null,
          status: "in_Completed",
          created_at: "2026-07-02T00:00:00.000Z",
          is_archived_quote: false,
          payment_status: "pagado",
          price: 100,
          order_type: "Normal",
          client_name: "Cliente A",
          client_id: "client-a",
        },
        {
          id: "o2",
          quote_id: null,
          quotation_id: "quote-1",
          quote_user_id: null,
          status: "pending",
          created_at: "2026-07-03T00:00:00.000Z",
          is_archived_quote: false,
          payment_status: "parcial",
          price: 200,
          order_type: "Orden 911",
          client_name: "Cliente A",
          client_id: "client-a",
        },
        {
          id: "o3",
          quote_id: null,
          quotation_id: null,
          quote_user_id: "quote-1",
          status: "cancelled",
          created_at: "2026-07-04T00:00:00.000Z",
          is_archived_quote: true,
          payment_status: "pending_payment",
          price: 300,
          order_type: "Normal",
          client_name: "Cliente B",
          client_id: "client-b",
        },
        {
          id: "o4",
          quote_id: "quote-2",
          quotation_id: null,
          quote_user_id: null,
          status: "in_Completed",
          created_at: "2026-07-05T00:00:00.000Z",
          is_archived_quote: false,
          payment_status: "pagado",
          price: 400,
          order_type: "Normal",
          client_name: "Cliente Ajeno",
          client_id: "client-x",
        },
        {
          id: "o5",
          quote_id: "quote-2",
          quotation_id: null,
          quote_user_id: null,
          status: "in_Completed",
          created_at: "2026-07-06T00:00:00.000Z",
          is_archived_quote: false,
          payment_status: "pagado",
          price: 500,
          order_type: "Normal",
          client_name: "Cliente Privado",
          client_id: "client-y",
        },
      ],
    });

    const result = await handleQuoteProfile({ quote_id: "quote-2", userId: "quote-2" }, env);

    expect(result.status).toBe(200);
    expect(result.body.profile.id).toBe("quote-1");
    expect(result.body.metrics).toMatchObject({
      total_orders: 3,
      completed_orders: 1,
      active_orders: 1,
      cancelled_orders: 1,
      paid_orders: 1,
      partial_paid_orders: 1,
      pending_payment_orders: 1,
      clients_served: 2,
      archived_orders: 1,
      completion_rate: 33.3,
      cancellation_rate: 33.3,
      payment_rate: 33.3,
    });
    expect(result.body.ranking).toMatchObject({
      position: 2,
      total_quoters: 2,
      metric_label: "Mejor % Confirmacion de Pago",
      score: 33.3,
    });
    expect(result.body.analytics.payment_summary).toEqual({
      pagado: 1,
      pendiente: 1,
      parcial: 1,
      credito_pendiente: 0,
    });
    expect(result.body.analytics.payment_types).toMatchObject({
      total: 3,
      rows: expect.arrayContaining([
        expect.objectContaining({ name: "Pagado", value: 1, percentage: 33.3 }),
        expect.objectContaining({ name: "Parcial", value: 1, percentage: 33.3 }),
        expect.objectContaining({ name: "Pendiente", value: 1, percentage: 33.3 }),
      ]),
    });
    expect(result.body.analytics.top_clients[0]).toMatchObject({
      name: "Cliente A",
      count: 2,
      percentage: 66.7,
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Ajeno");
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Privado");
  });

  it("returns zero metrics and stable analytics when the quote user has no orders", async () => {
    currentClient = makeQuoteProfileClient({ orders: [] });

    const result = await handleQuoteProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      total_orders: 0,
      completed_orders: 0,
      active_orders: 0,
      cancelled_orders: 0,
      paid_orders: 0,
      partial_paid_orders: 0,
      pending_payment_orders: 0,
      completion_rate: 0,
      cancellation_rate: 0,
      payment_rate: 0,
      clients_served: 0,
      archived_orders: 0,
    });
    expect(result.body.ranking.position).toBe(1);
    expect(result.body.ranking.total_quoters).toBe(2);
    expect(result.body.analytics).toMatchObject({
      payment_types: { total: 0, rows: [] },
      payment_summary: {
        pagado: 0,
        pendiente: 0,
        parcial: 0,
        credito_pendiente: 0,
      },
      top_clients: [],
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
  });
});
