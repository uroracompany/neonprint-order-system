/* global process */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildR2Url,
  getR2Config,
  parseR2Url,
  shouldUseR2,
} from "../../server/storage-gateway.js";

const MB = 1024 * 1024;
const readProjectFile = (path) => readFileSync(join(process.cwd(), path), "utf8");
const readLatestMigration = (suffix) => {
  const dir = join(process.cwd(), "supabase", "migrations");
  const file = readdirSync(dir).filter((name) => name.endsWith(suffix)).sort().at(-1);
  return readFileSync(join(dir, file), "utf8");
};

const r2Env = {
  STORAGE_PROVIDER: "hybrid",
  R2_UPLOAD_THRESHOLD_MB: "25",
  R2_ACCOUNT_ID: "ad020a03ba5e769d8340331e3640c2f7",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
  R2_BUCKET: "neonprint-order-files-dev",
};

describe("Cloudflare R2 hybrid storage", () => {
  it("selects R2 only for eligible large order-docs uploads in hybrid mode", () => {
    expect(shouldUseR2({ bucket: "order-docs", sizeBytes: 24 * MB, env: r2Env })).toBe(false);
    expect(shouldUseR2({ bucket: "order-docs", sizeBytes: 25 * MB, env: r2Env })).toBe(true);
    expect(shouldUseR2({ bucket: "order-previews", sizeBytes: 50 * MB, env: r2Env })).toBe(false);
    expect(shouldUseR2({ bucket: "payment-invoice", sizeBytes: 50 * MB, env: r2Env })).toBe(false);
  });

  it("keeps Supabase mode disabled and supports full R2 mode for order-docs", () => {
    expect(shouldUseR2({
      bucket: "order-docs",
      sizeBytes: 100 * MB,
      env: { ...r2Env, STORAGE_PROVIDER: "supabase" },
    })).toBe(false);

    expect(shouldUseR2({
      bucket: "order-docs",
      sizeBytes: 1,
      env: { ...r2Env, STORAGE_PROVIDER: "r2" },
    })).toBe(true);
  });

  it("builds R2 config and stable r2 URLs without exposing signed URLs", () => {
    const config = getR2Config(r2Env);
    expect(config).toMatchObject({
      configured: true,
      accountId: "ad020a03ba5e769d8340331e3640c2f7",
      bucket: "neonprint-order-files-dev",
      endpoint: "https://ad020a03ba5e769d8340331e3640c2f7.r2.cloudflarestorage.com",
      region: "auto",
      service: "s3",
    });

    const storedUrl = buildR2Url({ bucket: config.bucket, key: "orders/order-1/design/file.pdf" });
    expect(storedUrl).toBe("r2://neonprint-order-files-dev/orders/order-1/design/file.pdf");
    expect(parseR2Url(storedUrl)).toEqual({
      bucket: "neonprint-order-files-dev",
      key: "orders/order-1/design/file.pdf",
    });
  });

  it("keeps frontend upload completion and failure paths compatible with pre-order R2 uploads", () => {
    const uploadUtil = readProjectFile("src/utils/uploadOrderAsset.js");

    expect(uploadUtil).toContain("const markR2UploadFailed = async");
    expect(uploadUtil).toContain("result.shouldRegister === false || !result.file?.id");
    expect(uploadUtil).toContain('provider: "r2"');
    expect(uploadUtil).toContain('status: "failed"');
  });

  it("removes direct designer Supabase bucket listing so r2 URLs remain visible", () => {
    const designer = readProjectFile("src/pages/page-designer.jsx");

    expect(designer).toContain("const getDesignerFilesFromOrder = (order) =>");
    expect(designer).toContain("getOrderFiles(order).map");
    expect(designer).toContain("const preview = getPreviewImage(order)");
    expect(designer).not.toContain("fetchOrderFiles");
    expect(designer).not.toContain("fetchOrderPreview");
    expect(designer).not.toContain('.from("order-docs")\n        .list');
    expect(designer).not.toContain('.from("order-previews")\n        .list');
  });

  it("adds the formal storage gateway migration with RLS, audit and production file linkage", () => {
    const migration = readLatestMigration("_activate_r2_storage_gateway.sql");

    expect(migration).toContain("create table if not exists public.order_files");
    expect(migration).toContain("constraint order_files_provider_check check (provider in ('supabase', 'r2'))");
    expect(migration).toContain("alter table public.order_files enable row level security");
    expect(migration).toContain("create table if not exists public.order_delete_audit");
    expect(migration).toContain("add column if not exists order_file_id uuid references public.order_files(id)");
    expect(migration).toContain("file_size_limit = 209715200");
  });
});
