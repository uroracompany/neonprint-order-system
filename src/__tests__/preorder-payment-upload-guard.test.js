import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  storageFrom: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  fromTables: [],
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  }),
}));

import { handleInitiateFileUpload } from "../../server/storage-gateway.js";

const ORDER_ID = "f6f9c4a2-61bd-4e55-8cd0-1d3d0b93e60f";
const baseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  authHeader: "Bearer test-token",
};

const makeQuery = (tableName) => {
  let insertAttempted = false;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    insert: vi.fn(() => {
      insertAttempted = true;
      return query;
    }),
    single: vi.fn(async () => {
      if (tableName === "profiles") {
        return {
          data: { id: "seller-1", role: "seller", employment_status: true, deleted_at: null },
          error: null,
        };
      }
      if (tableName === "orders") return { data: null, error: new Error("not found") };
      if (tableName === "order_asset_preupload_reservations" && insertAttempted) {
        return { data: { id: "reservation-1" }, error: null };
      }
      return { data: null, error: new Error("unexpected single query") };
    }),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  };
  return query;
};

describe("pre-order payment upload guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fromTables.length = 0;
    mocks.getUser.mockResolvedValue({ data: { user: { id: "seller-1" } }, error: null });
    mocks.from.mockImplementation((tableName) => {
      mocks.fromTables.push(tableName);
      return makeQuery(tableName);
    });
    mocks.storageFrom.mockReturnValue({ createSignedUploadUrl: mocks.createSignedUploadUrl });
    mocks.createSignedUploadUrl.mockResolvedValue({ data: { token: "signed-upload-token" }, error: null });
  });

  it("rejects a pre-order payment receipt without reserving it or creating a signed upload", async () => {
    const result = await handleInitiateFileUpload({
      orderId: ORDER_ID,
      bucket: "payment-invoice",
      path: `orders/${ORDER_ID}/payment-1790000000000-receipt.png`,
      fileName: "receipt.png",
      contentType: "image/png",
      sizeBytes: 1024,
      idempotencyKey: ORDER_ID,
    }, baseEnv);

    expect(result.status).toBe(403);
    expect(result.body.error).toMatch(/orden existente y un responsable de Caja asignado/i);
    expect(mocks.fromTables).not.toContain("order_asset_preupload_reservations");
    expect(mocks.storageFrom).not.toHaveBeenCalled();
    expect(mocks.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("preserves the established pre-order reservation and signed upload flow for design assets", async () => {
    const result = await handleInitiateFileUpload({
      orderId: ORDER_ID,
      bucket: "order-docs",
      path: `orders/${ORDER_ID}/design/artwork.pdf`,
      fileName: "artwork.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      idempotencyKey: ORDER_ID,
    }, baseEnv);

    expect(result.status).toBe(200);
    expect(result.body.preorder.category).toBe("design");
    expect(mocks.fromTables).toContain("order_asset_preupload_reservations");
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledOnce();
  });
});
