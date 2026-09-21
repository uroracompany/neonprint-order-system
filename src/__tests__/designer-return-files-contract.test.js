import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");
const page = read("src/pages/page-designer.jsx");
const quoteReturnCommand = read("supabase/migrations/20260827030500_quote_return_order_command_context.sql");
const semiAdminCommand = read("supabase/migrations/20260907110000_semi_admin_cash_audit_sync.sql");

const selectBlock = page.slice(
  page.indexOf("const DESIGNER_ORDER_SELECT"),
  page.indexOf("const isReturnedOrder"),
);
const rehydrationBlock = page.slice(
  page.indexOf("const getDesignerFilesFromOrder"),
  page.indexOf("const CARD_ACCENTS"),
);
const semiAdminReturnBlock = semiAdminCommand.slice(
  semiAdminCommand.indexOf("if p_action = 'return_quote_to_design' then"),
  semiAdminCommand.indexOf("if p_payload->>'stage' = 'quote' then"),
);

describe("designer return-to-design file hydration contract", () => {
  it("keeps the complete operational-file projection without selecting payment data", () => {
    expect(selectBlock).toContain('"order_file_url"');
    expect(selectBlock).toContain('"preview_image"');
    expect(selectBlock).toContain('"reference_images"');
    expect(selectBlock).toContain("order_files(id, provider, bucket, object_key, original_filename, content_type, category, status, deleted_at, uploaded_by)");
    expect(selectBlock).toContain("order_production_files(id, order_id, url, filename, public_label, production_area_code, material_names, termination_name)");
    expect(selectBlock).not.toContain("invoice_payment");
  });

  it("rehydrates legacy, production and active manifest files once in source order", () => {
    expect(rehydrationBlock).toContain("const seenUrls = new Set()");
    expect(rehydrationBlock).toContain("getOrderFiles(order).forEach");
    expect(rehydrationBlock).toContain("order?.order_production_files || []");
    expect(rehydrationBlock).toContain("sortDesignerFilesByStableKey(order?.order_production_files || [])");
    expect(rehydrationBlock).toContain("file?.order_id === order?.id && file?.url");
    expect(rehydrationBlock).toContain("file.filename || file.public_label || getFileNameFromUrl(file.url)");
    expect(rehydrationBlock).toContain("order?.order_files || []");
    expect(rehydrationBlock).toContain("sortDesignerFilesByStableKey(order?.order_files || [])");
    expect(rehydrationBlock).toContain('["design", "production"].includes(file.category)');
    expect(rehydrationBlock).toContain("getOrderFileAssetRef(file)");
    expect(rehydrationBlock).toContain("file.original_filename || getFileNameFromUrl(assetRef)");
  });

  it("uses a deterministic relational ordering and the deduplicated collection for every visible file count", () => {
    expect(page).toContain("const getDesignerFileStableKey = (file) =>");
    expect(page).toContain("const sortDesignerFilesByStableKey = (files) =>");
    expect(page).toContain("getDesignerFileStableKey(left).localeCompare(getDesignerFileStableKey(right))");
    expect(page).not.toContain("getOrderFiles(order).length + (orderFiles?.[order.id]?.length || 0)");

    const countExpressions = page.match(/\(orderFiles\?\.\[order\.id\] \|\| getDesignerFilesFromOrder\(order\)\)\.length/g) || [];
    expect(countExpressions).toHaveLength(3);
  });

  it("rejects inactive, deleted and financial manifest rows from the designer file list", () => {
    expect(rehydrationBlock).toContain('file?.status === "uploaded"');
    expect(rehydrationBlock).toContain("!file.deleted_at");
    expect(rehydrationBlock).toContain('file.bucket !== "payment-invoice"');
    expect(rehydrationBlock).not.toContain('category === "payment"');
  });

  it("leaves Caja returns as order-state transitions without asset mutation and keeps external returns in Venta", () => {
    expect(quoteReturnCommand).toContain("if v_order.order_design_type = 'EXTERNAL_DESING' then");
    expect(quoteReturnCommand).toContain("v_target_status := 'Pending'");
    expect(quoteReturnCommand).not.toMatch(/(?:delete|update|insert\s+into)\s+public\.order_(?:files|production_files)/i);
    expect(semiAdminReturnBlock).toContain("update public.orders set status = 'in_Design'");
    expect(semiAdminReturnBlock).not.toMatch(/(?:delete|update|insert\s+into)\s+public\.order_(?:files|production_files)/i);
  });
});
