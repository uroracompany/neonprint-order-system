/* global process */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  nextOrderAssetCleanupAttemptAt,
  processOrderAssetDeletionOutbox,
} from "../../server/order-asset-cleanup-handler.js";
import { isAuthorizedCronRequest } from "../../api/cron/order-asset-cleanup.js";
import { removeSupabasePrefix } from "../../server/storage-gateway.js";

const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const serverEnv = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

const makeClient = (jobs) => {
  const updates = [];
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: jobs, error: null }),
    from: vi.fn(() => {
      const query = {};
      query.eq = vi.fn(() => query);
      query.select = vi.fn(() => ({
        maybeSingle: vi.fn().mockImplementation(async () => {
          updates.push({ values: query.values });
          return { data: { id: "claimed-job" }, error: null };
        }),
      }));
      query.update = vi.fn((values) => {
        query.values = values;
        return query;
      });
      return query;
    }),
  };
  return { client, updates };
};

describe("durable order asset cleanup", () => {
  it("deletes claimed Supabase objects and R2 objects, then marks both complete", async () => {
    const { client, updates } = makeClient([
      { id: "supabase-job", claim_token: "claim-supabase", claim_expires_at: "2026-08-26T03:30:00.000Z", provider: "supabase", target_kind: "object", bucket: "order-docs", object_path: "orders/a/files/a.pdf", attempts: 1 },
      { id: "r2-job", claim_token: "claim-r2", claim_expires_at: "2026-08-26T03:30:00.000Z", provider: "r2", target_kind: "object", bucket: "r2-bucket", object_path: "orders/b/files/b.pdf", attempts: 1 },
    ]);
    const cleanup = {
      removeSupabaseTargets: vi.fn().mockResolvedValue({ removed: 1, errors: [] }),
      removeSupabasePrefix: vi.fn(),
      removeR2Targets: vi.fn().mockResolvedValue({ removed: 1, errors: [] }),
    };

    const result = await processOrderAssetDeletionOutbox({
      env: serverEnv,
      clientFactory: () => client,
      cleanup,
      now: () => new Date("2026-08-26T03:00:00.000Z"),
    });

    expect(result).toEqual({ status: 200, body: { claimed: 2, completed: 2, failed: 0 } });
    expect(cleanup.removeSupabaseTargets).toHaveBeenCalledWith({
      supabaseAdmin: client,
      targets: [{ bucket: "order-docs", path: "orders/a/files/a.pdf" }],
    });
    expect(cleanup.removeR2Targets).toHaveBeenCalledWith(expect.objectContaining({
      targets: [{ bucket: "r2-bucket", key: "orders/b/files/b.pdf" }],
    }));
    expect(updates).toHaveLength(2);
    expect(updates.every((entry) => entry.values.status === "completed")).toBe(true);
  });

  it("queues a retry when remote deletion fails and uses exponential backoff", async () => {
    const { client, updates } = makeClient([
      { id: "failed-job", claim_token: "claim-failed", claim_expires_at: "2026-08-26T03:30:00.000Z", provider: "r2", target_kind: "object", bucket: "r2-bucket", object_path: "orders/a/files/a.pdf", attempts: 3 },
    ]);
    const now = new Date("2026-08-26T03:00:00.000Z");
    const result = await processOrderAssetDeletionOutbox({
      env: serverEnv,
      clientFactory: () => client,
      cleanup: {
        removeSupabaseTargets: vi.fn(),
        removeSupabasePrefix: vi.fn(),
        removeR2Targets: vi.fn().mockResolvedValue({ errors: [{ message: "R2 no disponible" }] }),
      },
      now: () => now,
    });

    expect(result).toEqual({ status: 200, body: { claimed: 1, completed: 0, failed: 1 } });
    expect(updates[0].values).toMatchObject({
      status: "pending",
      locked_at: null,
      last_error: "R2 no disponible",
      next_attempt_at: "2026-08-26T03:20:00.000Z",
    });
    expect(nextOrderAssetCleanupAttemptAt(10, now)).toBe("2026-08-27T03:00:00.000Z");
  });

  it("does not delete an object when the claim lease is absent or expired", async () => {
    const { client, updates } = makeClient([
      { id: "expired-job", claim_token: "claim-expired", claim_expires_at: "2026-08-26T02:59:59.000Z", provider: "r2", target_kind: "object", bucket: "r2-bucket", object_path: "orders/a/files/a.pdf", attempts: 1 },
    ]);
    const removeR2Targets = vi.fn();
    const result = await processOrderAssetDeletionOutbox({
      env: serverEnv,
      clientFactory: () => client,
      cleanup: { removeSupabaseTargets: vi.fn(), removeSupabasePrefix: vi.fn(), removeR2Targets },
      now: () => new Date("2026-08-26T03:00:00.000Z"),
    });

    expect(result).toEqual({ status: 200, body: { claimed: 1, completed: 0, failed: 1 } });
    expect(removeR2Targets).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
  });

  it("drains every Supabase prefix batch without skipping files after a delete", async () => {
    const firstBatch = Array.from({ length: 1000 }, (_, index) => ({ name: `file-${index}.pdf` }));
    const list = vi.fn()
      .mockResolvedValueOnce({ data: firstBatch, error: null })
      .mockResolvedValueOnce({ data: [{ name: "final-file.pdf" }], error: null });
    const remove = vi.fn().mockResolvedValue({ error: null });
    const supabaseAdmin = {
      storage: { from: vi.fn(() => ({ list, remove })) },
    };

    const result = await removeSupabasePrefix({
      supabaseAdmin,
      bucket: "order-docs",
      prefix: "orders/order-id/files",
    });

    expect(result).toEqual({ removed: 1001, errors: [] });
    expect(list.mock.calls.map(([, options]) => options.offset)).toEqual([0, 0]);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("requires the exact CRON_SECRET and keeps the cleanup endpoint server-only", () => {
    expect(isAuthorizedCronRequest("Bearer correct-secret", "correct-secret")).toBe(true);
    expect(isAuthorizedCronRequest("Bearer incorrect", "correct-secret")).toBe(false);
    expect(isAuthorizedCronRequest("", "correct-secret")).toBe(false);
    expect(readProjectFile("api/cron/order-asset-cleanup.js")).toContain("process.env.CRON_SECRET");
  });

  it("uses a non-cascading outbox and snapshots targets before an order delete", () => {
    const migration = readProjectFile("supabase/migrations/20260826060000_durable_order_asset_deletion_outbox.sql");
    const leaseMigration = readProjectFile("supabase/migrations/20260829033401_production_readiness_asset_security.sql");
    expect(migration).toContain("create table if not exists public.order_asset_deletion_outbox");
    expect(migration).not.toMatch(/order_id uuid[^,]*references public\.orders/i);
    expect(migration).toContain("before delete on public.orders");
    expect(migration).toContain("from public.order_files file");
    expect(migration).toContain("for update skip locked");
    expect(leaseMigration).toContain("claim_token = gen_random_uuid()");
    expect(leaseMigration).toContain("claim_expires_at = now() + interval '30 minutes'");
    expect(migration).toContain("revoke all on function public.claim_order_asset_deletion_outbox(integer) from public, anon, authenticated;");
  });
});
