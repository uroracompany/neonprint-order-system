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
};

const makeSupabaseClient = ({ deletedAt = null } = {}) => {
  const client = {
    id: "77b11e8b-7ce2-4c44-9286-f31b161cfdf2",
    name: "Cliente histórico",
    phone: "809-555-0101",
    email: "cliente@example.com",
    deleted_at: deletedAt,
  };
  const update = vi.fn((payload) => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: { ...client, ...payload }, error: null })),
      })),
    })),
  }));

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: "admin-1" } }, error: null })),
    },
    from: vi.fn((table) => {
      if (table === "profiles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: { id: "admin-1", role: "admin", employment_status: true, deleted_at: null },
                error: null,
              })),
            })),
          })),
        };
      }
      if (table === "clients") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(async () => ({ data: client, error: null })) })),
          })),
          update,
        };
      }
      if (table === "user_lifecycle_audit") return { insert: vi.fn(async () => ({ error: null })) };
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return { supabase, update };
};

describe("handleAdminRetireClient", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("realiza una baja lógica sin tocar órdenes históricas", async () => {
    const { supabase, update } = makeSupabaseClient();
    currentClient = supabase;
    const { handleAdminRetireClient } = await import("../../server/admin-retirement-handler.js");

    const response = await handleAdminRetireClient({ clientId: "77b11e8b-7ce2-4c44-9286-f31b161cfdf2" }, env);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(String), deleted_by: "admin-1" }));
    expect(supabase.from).not.toHaveBeenCalledWith("orders");
  });

  it("conserva el 409 para un intento directo de baja duplicado", async () => {
    const { supabase, update } = makeSupabaseClient({ deletedAt: "2026-08-31T12:00:00Z" });
    currentClient = supabase;
    const { handleAdminRetireClient } = await import("../../server/admin-retirement-handler.js");

    const response = await handleAdminRetireClient({ clientId: "77b11e8b-7ce2-4c44-9286-f31b161cfdf2" }, env);

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("El cliente ya esta dado de baja.");
    expect(update).not.toHaveBeenCalled();
  });
});
