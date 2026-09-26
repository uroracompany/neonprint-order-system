import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("supabase/migrations/20260829145756_designer_remove_order_file.sql"),
  "utf8",
);
const designerPage = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");
const designerCss = readFileSync(resolve("src/css-components/page-designer.css"), "utf8");

describe("designer persisted-file removal contract", () => {
  it("keeps the removal command scoped, versioned and storage-safe", () => {
    expect(migration).toContain("create or replace function public.designer_remove_order_file(");
    expect(migration).toContain("v_order.designer_id is distinct from v_actor");
    expect(migration).toContain("v_order.status <> 'in_Design'");
    expect(migration).toContain("v_order.updated_at is distinct from p_expected_updated_at");
    expect(migration).toContain("where id = p_file_id");
    expect(migration).toContain("and order_id = p_order_id");
    expect(migration).toContain("perform public.enqueue_admin_order_asset_deletion(p_order_id, v_file.url, 'order-docs')");
    expect(migration).toContain("revoke all on function public.enqueue_admin_order_asset_deletion(uuid, text, text) from public, anon, authenticated");
    expect(migration).toContain("delete from public.order_production_files where id = v_file.id and order_id = p_order_id");
    expect(migration).toContain("revoke all on function public.designer_remove_order_file(uuid, uuid, timestamptz) from public, anon");
  });

  it("keeps both canonical and legacy Supabase references resolvable by the internal cleanup queue", () => {
    expect(migration).toContain("('supabase://' || f.bucket || '/' || f.object_key) = v_url");
    expect(migration).toContain("'^https?://[^/]+/storage/v1/object/[^/]+/[^/]+/([^?]+).*$','\\1'");
    expect(migration).toContain("v_object_path := v_parts[2]");
  });

  it("uses the RPC only for files with an owned production-file row", () => {
    expect(designerPage).toContain('"order_production_files(id, order_id, url)"');
    expect(designerPage).toContain('rpc("designer_remove_order_file", {');
    expect(designerPage).toContain("file?.productionFile?.id");
  });

  it("uses an isolated modal namespace with one scrollable body and a static footer", () => {
    expect(designerCss).toContain(".designer-order-modal__body {");
    expect(designerCss).toMatch(/\.designer-order-modal__body \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/);
    expect(designerCss).toMatch(/\.designer-order-modal__footer \{[\s\S]*?flex: 0 0 auto;/);
    expect(designerCss).not.toMatch(/\.designer-order-modal__footer \{[\s\S]*?position: sticky;/);
    expect(designerPage).not.toContain('className="pd-modal"');
    expect(designerPage).not.toContain('className="pd-btn pd-btn');
    expect(designerCss).toContain(".designer-order-modal__button {");
  });
});
