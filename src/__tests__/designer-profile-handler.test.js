import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentClient;

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => currentClient),
}));

const env = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  authHeader: "Bearer designer-token",
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
    then(resolveThen, reject) {
      return Promise.resolve({ data: applyFilters(rows, state.filters), error: null }).then(resolveThen, reject);
    },
  };
  return builder;
}

const makeDesignerProfileClient = ({
  tokenUserId = "designer-1",
  tokenError = null,
  currentProfile = {
    id: "designer-1",
    name: "Ana Designer",
    email: "ana@example.com",
    role: "designer",
    employment_status: true,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  profiles = [
    { id: "designer-1", name: "Ana Designer", email: "ana@example.com", role: "designer", employment_status: true },
    { id: "designer-2", name: "Beto Designer", email: "beto@example.com", role: "designer", employment_status: true },
  ],
  productionAreas = [
    { code: "digital", label: "Digital" },
    { code: "dtf", label: "DTF" },
    { code: "ploteo", label: "Ploteo" },
  ],
  orders = [],
  productionFiles = [],
} = {}) => {
  const getUser = vi.fn(async () => ({
    data: tokenUserId ? { user: { id: tokenUserId } } : { user: null },
    error: tokenError,
  }));

  const profileRows = [
    ...(currentProfile ? [currentProfile] : []),
    ...profiles.filter((profile) => profile.id !== currentProfile?.id),
  ];

  const tableRows = {
    profiles: profileRows,
    orders,
    order_production_files: productionFiles,
    production_areas: productionAreas,
  };

  return {
    auth: { getUser },
    from: vi.fn((table) => ({
      select: vi.fn(() => makeBuilder(tableRows[table] || [])),
    })),
    getUser,
  };
};

describe("handleDesignerProfile", () => {
  let handleDesignerProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleDesignerProfile } = await import("../../server/designer-profile-handler.js"));
  });

  it("rejects requests without a token", async () => {
    currentClient = makeDesignerProfileClient();

    const result = await handleDesignerProfile({}, { ...env, authHeader: "" });

    expect(result.status).toBe(401);
    expect(currentClient.getUser).not.toHaveBeenCalled();
  });

  it("rejects inactive users and unsupported roles", async () => {
    currentClient = makeDesignerProfileClient({
      currentProfile: {
        id: "quote-1",
        name: "Caja",
        email: "quote@example.com",
        role: "quote",
        employment_status: true,
      },
      tokenUserId: "quote-1",
    });

    const wrongRole = await handleDesignerProfile({}, env);
    expect(wrongRole.status).toBe(403);

    currentClient = makeDesignerProfileClient({
      currentProfile: {
        id: "designer-1",
        name: "Ana Designer",
        email: "ana@example.com",
        role: "designer",
        employment_status: false,
      },
    });

    const inactive = await handleDesignerProfile({}, env);
    expect(inactive.status).toBe(403);
  });

  it("ignores designer_id from the payload and returns only the authenticated designer analytics", async () => {
    currentClient = makeDesignerProfileClient({
      orders: [
        {
          id: "o1",
          designer_id: "designer-1",
          status: "in_Quote",
          created_at: "2026-07-02T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico, PVC",
          client_name: "Cliente A",
          delivery_date: "2026-07-08T00:00:00.000Z",
          preview_image: "https://cdn.example.com/o1.png",
          return_reason: null,
          returned_to_designer_at: null,
          is_archived: false,
        },
        {
          id: "o2",
          designer_id: "designer-1",
          status: "in_Design",
          created_at: "2026-07-03T00:00:00.000Z",
          order_type: "Orden 911",
          material: "Vinil",
          client_name: "Cliente B",
          delivery_date: "2026-07-01T00:00:00.000Z",
          preview_image: "",
          return_reason: "Falta ajustar arte final",
          returned_to_designer_at: "2026-07-04T00:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o3",
          designer_id: "designer-1",
          status: "in_Production",
          created_at: "2026-07-05T00:00:00.000Z",
          order_type: "Normal",
          material: "Acrilico",
          client_name: "Cliente A",
          delivery_date: "2026-07-20T00:00:00.000Z",
          preview_image: "https://cdn.example.com/o3.png",
          return_reason: null,
          returned_to_designer_at: null,
          is_archived: false,
        },
        {
          id: "o4",
          designer_id: "designer-1",
          status: "in_Quote",
          created_at: "2026-05-12T00:00:00.000Z",
          order_type: "Normal",
          material: "MDF",
          client_name: "Cliente Historico",
          delivery_date: "2026-05-20T00:00:00.000Z",
          preview_image: "https://cdn.example.com/o4.png",
          is_archived: false,
        },
        {
          id: "o7",
          designer_id: "designer-1",
          status: "pending",
          created_at: "2026-07-06T00:00:00.000Z",
          order_type: "Normal",
          material: "Foam",
          client_name: "Cliente Externo",
          delivery_date: "2026-07-30T00:00:00.000Z",
          preview_image: "",
          return_reason: "Diseno externo devuelto a vendedor",
          returned_to_designer_at: "2026-07-06T12:00:00.000Z",
          is_archived: false,
        },
        {
          id: "o5",
          designer_id: "designer-2",
          status: "in_Quote",
          created_at: "2026-07-04T00:00:00.000Z",
          order_type: "Normal",
          material: "Foam",
          client_name: "Cliente Ajeno",
          delivery_date: "2026-07-12T00:00:00.000Z",
          preview_image: "https://cdn.example.com/o5.png",
          is_archived: false,
        },
        {
          id: "o6",
          designer_id: "designer-2",
          status: "in_Completed",
          created_at: "2026-07-05T00:00:00.000Z",
          order_type: "Normal",
          material: "PVC",
          client_name: "Cliente Privado",
          delivery_date: "2026-07-15T00:00:00.000Z",
          preview_image: "https://cdn.example.com/o6.png",
          is_archived: false,
        },
      ],
      productionFiles: [
        {
          id: "f1",
          order_id: "o1",
          status: "pending",
          production_area_code: "digital",
          created_by: "designer-1",
          created_at: "2026-07-02T01:00:00.000Z",
        },
        {
          id: "f2",
          order_id: "o1",
          status: "completed",
          production_area_code: "dtf",
          created_by: "designer-1",
          created_at: "2026-07-02T02:00:00.000Z",
        },
        {
          id: "f3",
          order_id: "o2",
          status: "pending",
          production_area_code: null,
          created_by: "designer-1",
          created_at: "2026-07-03T02:00:00.000Z",
        },
        {
          id: "f6",
          order_id: "o3",
          status: "in_production",
          production_area_code: "digital",
          created_by: "admin-1",
          created_at: "2026-07-05T03:00:00.000Z",
        },
        {
          id: "f4",
          order_id: "o5",
          status: "completed",
          production_area_code: "digital",
          created_by: "designer-2",
          created_at: "2026-07-04T02:00:00.000Z",
        },
        {
          id: "f5",
          order_id: "o6",
          status: "completed",
          production_area_code: "ploteo",
          created_by: "designer-2",
          created_at: "2026-07-05T02:00:00.000Z",
        },
      ],
    });

    const result = await handleDesignerProfile({ designer_id: "designer-2" }, env);

    expect(result.status).toBe(200);
    expect(result.body.profile.id).toBe("designer-1");
    expect(result.body.metrics).toMatchObject({
      total_orders: 4,
      assigned_orders: 4,
      ready_to_quote_orders: 2,
      returned_orders: 1,
      active_orders: 4,
      files_created: 3,
      classified_files: 2,
      preview_orders: 2,
      ready_to_quote_rate: 50,
      return_rate: 25,
      classification_rate: 66.7,
      preview_coverage_rate: 50,
    });
    expect(result.body.ranking).toMatchObject({
      position: 2,
      total_designers: 2,
      metric_label: "Avance limpio a caja",
      score: 25,
    });
    expect(result.body.analytics.order_types).toMatchObject({
      total: 4,
      normal: { count: 3, percentage: 75 },
      urgent: { count: 1, percentage: 25 },
    });
    expect(result.body.analytics.production_file_status).toMatchObject({
      total: 3,
      pending: 2,
      completed: 1,
    });
    expect(result.body.analytics.top_production_areas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Digital", count: 1 }),
        expect.objectContaining({ name: "DTF", count: 1 }),
        expect.objectContaining({ name: "Sin clasificar", count: 1 }),
      ])
    );
    expect(result.body.analytics.top_materials[0]).toMatchObject({
      name: "Acrilico",
      count: 2,
      percentage: 40,
    });
    expect(result.body.analytics.top_clients[0]).toMatchObject({
      name: "Cliente A",
      count: 2,
      percentage: 50,
    });
    expect(result.body.analytics.status_summary).toMatchObject({
      active: 4,
      completed: 0,
      pending: 3,
      cancelled: 0,
      overdue: 3,
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
    expect(JSON.stringify(result.body)).not.toContain("Beto Designer");
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Ajeno");
    expect(JSON.stringify(result.body.analytics)).not.toContain("Cliente Privado");
  });

  it("returns zero metrics and stable analytics when the designer has no orders", async () => {
    currentClient = makeDesignerProfileClient({ orders: [], productionFiles: [] });

    const result = await handleDesignerProfile({}, env);

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({
      total_orders: 0,
      assigned_orders: 0,
      ready_to_quote_orders: 0,
      returned_orders: 0,
      files_created: 0,
      classified_files: 0,
      preview_orders: 0,
      ready_to_quote_rate: 0,
      return_rate: 0,
      classification_rate: 0,
      preview_coverage_rate: 0,
      goals_achieved: 0,
    });
    expect(result.body.ranking.position).toBe(1);
    expect(result.body.ranking.total_designers).toBe(2);
    expect(result.body.analytics).toMatchObject({
      order_types: {
        total: 0,
        normal: { count: 0, percentage: 0 },
        urgent: { count: 0, percentage: 0 },
      },
      top_materials: [],
      top_clients: [],
      top_production_areas: [],
      production_file_status: {
        total: 0,
        pending: 0,
        in_production: 0,
        in_termination: 0,
        completed: 0,
      },
    });
    expect(Object.keys(result.body.analytics.trends)).toEqual(["dia", "30d", "3m", "mensual"]);
  });
});

describe("designer profile Vite contract", () => {
  it("registers the local designer profile API handler", () => {
    const viteConfig = readFileSync(resolve("vite.config.js"), "utf8");

    expect(viteConfig).toContain("import { handleDesignerProfile } from './server/designer-profile-handler.js'");
    expect(viteConfig).toContain('createApiHandler("/api/designer-profile", handleDesignerProfile)');
  });
});
