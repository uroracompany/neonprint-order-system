import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../../server/auth-middleware.js";
import { createClient } from "@supabase/supabase-js";

vi.mock("../../server/auth-middleware.js", () => ({ requireAdmin: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));

const makeBuilder = (rows) => {
  const filters = [];
  const builder = {
    eq(field, value) { filters.push((row) => row[field] === value); return builder; },
    gte(field, value) { filters.push((row) => new Date(row[field]) >= new Date(value)); return builder; },
    lt(field, value) { filters.push((row) => new Date(row[field]) < new Date(value)); return builder; },
    order(field, options = {}) { builder.sortField = field; builder.ascending = options.ascending !== false; return builder; },
    then(resolve, reject) {
      const data = rows.filter((row) => filters.every((filter) => filter(row))).sort((left, right) => {
        if (!builder.sortField) return 0;
        const result = new Date(left[builder.sortField]) - new Date(right[builder.sortField]);
        return builder.ascending ? result : -result;
      });
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
};

describe("handleAdminProfile", () => {
  let handleAdminProfile;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ handleAdminProfile } = await import("../../server/admin-profile-handler.js"));
  });

  it("rechaza a quien no sea un administrador autenticado", async () => {
    requireAdmin.mockResolvedValue({ authorized: false, status: 403, error: "Sin permisos", code: "FORBIDDEN" });

    const result = await handleAdminProfile({}, {});

    expect(result).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
  });

  it("resume solo la actividad del administrador autenticado", async () => {
    const events = [
      { id: "latest", actor_id: "admin-1", order_id: "order-1", event_type: "order_updated", old_status: "Pending", new_status: "in_Design", changes: { changed_fields: [{ field: "responsible", label: "Responsable", old_value: "0dce1de2-819a-4a8c-a82d-2d648eb0a9f4", new_value: "1dce1de2-819a-4a8c-a82d-2d648eb0a9f4" }] }, created_at: "2026-07-28T10:00:00.000Z" },
      { id: "created", actor_id: "admin-1", order_id: "order-2", event_type: "order_created", changes: { reason_detail: "Orden registrada desde Administracion" }, created_at: "2026-07-27T10:00:00.000Z" },
      { id: "foreign", actor_id: "admin-2", order_id: "order-3", event_type: "order_updated", changes: {}, created_at: "2026-07-28T11:00:00.000Z" },
    ];
    const orders = [
      { id: "order-1", created_by: "admin-1", status: "Pending", created_at: "2026-07-28T09:00:00.000Z" },
      { id: "order-2", created_by: "admin-1", status: "Pending", created_at: "2026-07-27T09:00:00.000Z" },
      { id: "foreign-order", created_by: "admin-2", status: "Pending", created_at: "2026-07-28T09:00:00.000Z" },
    ];
    requireAdmin.mockResolvedValue({
      authorized: true,
      user: { id: "admin-1" },
      profile: { id: "admin-1", role: "admin" },
    });
    createClient.mockReturnValue({ from: vi.fn((table) => ({ select: vi.fn(() => makeBuilder(table === "order_events" ? events : orders)) })) });

    const result = await handleAdminProfile({}, {
      now: "2026-07-28T12:00:00.000Z",
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    });

    expect(result.status).toBe(200);
    expect(result.body.metrics).toMatchObject({ actions_registered: 2, orders_intervened: 2, orders_created: 2, last_activity_at: "2026-07-28T10:00:00.000Z" });
    expect(result.body.analytics.action_types).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Orden actualizada", count: 1 })]));
    expect(result.body.analytics.recent_activity).toHaveLength(2);
    expect(result.body.analytics.recent_activity[0]).toMatchObject({
      details: {
        old_status: "Pending",
        new_status: "in_Design",
        changed_fields: [expect.objectContaining({ field: "responsible" })],
      },
    });
    expect(result.body.analytics.recent_activity[0].detail).not.toContain("in_Design");
    expect(JSON.stringify(result.body)).not.toContain("foreign");
  });
});
