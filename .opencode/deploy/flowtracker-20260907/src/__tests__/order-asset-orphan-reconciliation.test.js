/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  getOrderIdFromManagedAssetPath,
  getReferencedOrderAssetPaths,
  identifyOrphanOrderAssets,
  isOldEnoughForOrphanDeletion,
} from "../../server/order-asset-orphan-reconciliation-handler.js";
import { listR2OrderObjects } from "../../server/storage-gateway.js";

const existingId = "11111111-1111-4111-8111-111111111111";
const orphanId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-26T12:00:00.000Z");
const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");

describe("order asset orphan reconciliation", () => {
  it("recognises only the documented UUID paths for order assets", () => {
    expect(getOrderIdFromManagedAssetPath({
      bucket: "order-docs",
      objectPath: `orders/${existingId}/files/design.pdf`,
    })).toBe(existingId);
    expect(getOrderIdFromManagedAssetPath({
      bucket: "payment-invoice",
      objectPath: `${existingId}/payment.png`,
    })).toBe(existingId);
    expect(getOrderIdFromManagedAssetPath({
      bucket: "order-docs",
      objectPath: "uploads/not-an-order/file.pdf",
    })).toBeNull();
    expect(getOrderIdFromManagedAssetPath({
      bucket: "payment-invoice",
      objectPath: "not-a-uuid/payment.png",
    })).toBeNull();
  });

  it("only returns old assets whose verified parent order is absent", async () => {
    const getExistingIds = vi.fn().mockResolvedValue(new Set([existingId]));
    const result = await identifyOrphanOrderAssets({
      now,
      getExistingIds,
      candidates: [
        { provider: "r2", bucket: "order-files", objectPath: `orders/${orphanId}/files/orphan.pdf`, createdAt: "2026-08-24T12:00:00.000Z" },
        { provider: "supabase", bucket: "order-docs", objectPath: `orders/${existingId}/files/valid.pdf`, createdAt: "2026-08-24T12:00:00.000Z" },
        { provider: "r2", bucket: "order-files", objectPath: `orders/${orphanId}/files/new-upload.pdf`, createdAt: "2026-08-26T11:30:00.000Z" },
        { provider: "supabase", bucket: "order-docs", objectPath: "unrelated/path.pdf", createdAt: "2026-08-24T12:00:00.000Z" },
      ],
    });

    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0]).toMatchObject({ orderId: orphanId, objectPath: `orders/${orphanId}/files/orphan.pdf` });
    expect(result).toMatchObject({ inspected: 4, skippedUnrecognised: 1, skippedFresh: 1, skippedWithParent: 1 });
    expect(getExistingIds).toHaveBeenCalledWith(new Set([orphanId, existingId]));
  });

  it("requires a valid timestamp older than the pre-order upload grace period", () => {
    expect(isOldEnoughForOrphanDeletion({ createdAt: "2026-08-25T12:00:00.000Z", now })).toBe(true);
    expect(isOldEnoughForOrphanDeletion({ createdAt: "2026-08-25T12:00:01.000Z", now })).toBe(false);
    expect(isOldEnoughForOrphanDeletion({ createdAt: "", now })).toBe(false);
  });

  it("queues an old unreferenced upload even when its order still exists", async () => {
    const result = await identifyOrphanOrderAssets({
      candidates: [{ provider: "supabase", bucket: "order-docs", objectPath: `orders/${existingId}/files/failed-attach.pdf`, createdAt: "2026-08-24T12:00:00.000Z" }],
      getExistingIds: async () => new Set([existingId]),
      getReferencedPaths: async () => new Set(),
      now,
    });

    expect(result.orphans).toHaveLength(1);
    expect(result.orphans[0].objectPath).toContain("failed-attach.pdf");
  });

  it("protects active Supabase and R2 manifest records that are not yet materialised on the order", async () => {
    const supabasePath = `orders/${existingId}/files/active-supabase.pdf`;
    const r2Path = `orders/${existingId}/files/active-r2.pdf`;
    const from = vi.fn((table) => ({
      select: () => ({
        in: () => Promise.resolve({
          data: table === "order_files" ? [
            { order_id: existingId, provider: "supabase", bucket: "order-docs", object_key: supabasePath, status: "uploaded", deleted_at: null },
            { order_id: existingId, provider: "r2", bucket: "order-files", object_key: r2Path, status: "uploading", deleted_at: null },
            { order_id: existingId, provider: "supabase", bucket: "order-docs", object_key: `orders/${existingId}/files/failed.pdf`, status: "failed", deleted_at: null },
          ] : [],
          error: null,
        }),
      }),
    }));

    const references = await getReferencedOrderAssetPaths({
      supabaseAdmin: { from },
      candidates: [
        { orderId: existingId, provider: "supabase", bucket: "order-docs", objectPath: supabasePath },
        { orderId: existingId, provider: "r2", bucket: "order-files", objectPath: r2Path },
      ],
    });

    expect(references).toBeInstanceOf(Set);
    expect(references.has(`supabase:order-docs:${supabasePath}`)).toBe(true);
    expect(references.has(`r2:order-files:${r2Path}`)).toBe(true);
    expect(references.has(`supabase:order-docs:orders/${existingId}/files/failed.pdf`)).toBe(false);

    const failed = await identifyOrphanOrderAssets({
      candidates: [{ provider: "supabase", bucket: "order-docs", objectPath: `orders/${existingId}/files/failed.pdf`, createdAt: "2026-08-24T12:00:00.000Z" }],
      getExistingIds: async () => new Set([existingId]),
      getReferencedPaths: async () => references,
      now,
    });
    expect(failed.orphans).toHaveLength(1);
  });

  it("lists only the requested R2 order prefix and preserves its continuation cursor", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => [
        "<ListBucketResult>",
        `<Contents><Key>orders/${orphanId}/files/orphan.pdf</Key><LastModified>2026-08-24T12:00:00.000Z</LastModified></Contents>`,
        "<NextContinuationToken>next-page-token</NextContinuationToken>",
        "</ListBucketResult>",
      ].join(""),
    });
    globalThis.fetch = fetchMock;

    try {
      const page = await listR2OrderObjects({
        bucket: "order-files",
        continuationToken: "previous-page-token",
        env: {
          R2_ACCOUNT_ID: "account-id",
          R2_ACCESS_KEY_ID: "access-key",
          R2_SECRET_ACCESS_KEY: "secret-key",
          R2_BUCKET: "order-files",
        },
      });

      const requestUrl = new URL(fetchMock.mock.calls[0][0]);
      expect(requestUrl.pathname).toBe("/order-files");
      expect(requestUrl.searchParams.get("prefix")).toBe("orders/");
      expect(requestUrl.searchParams.get("continuation-token")).toBe("previous-page-token");
      expect(page).toEqual({
        objects: [{ key: `orders/${orphanId}/files/orphan.pdf`, lastModified: "2026-08-24T12:00:00.000Z" }],
        nextContinuationToken: "next-page-token",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps listing and deletion restricted to recognised paths, a server RPC and the durable outbox", () => {
    const handler = readProjectFile("server/order-asset-orphan-reconciliation-handler.js");
    const migration = readProjectFile("supabase/migrations/20260826060000_durable_order_asset_deletion_outbox.sql");
    expect(handler).toContain('prefix: "orders/"');
    expect(handler).toContain('rpc("list_order_storage_assets"');
    expect(handler).toContain('from("order_asset_deletion_outbox")');
    expect(migration).toContain("create table if not exists public.order_asset_reconciliation_cursors");
    expect(migration).toContain("create or replace function public.list_order_storage_assets");
    expect(migration).toContain("revoke all on function public.list_order_storage_assets(text, text, integer) from public, anon, authenticated;");
  });
});
