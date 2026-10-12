import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const modalSource = fs.readFileSync(path.join(root, "src/components/orders/EditOrderModal.jsx"), "utf8");
const sellerSource = fs.readFileSync(path.join(root, "src/pages/pages-seller.jsx"), "utf8");
const migrationSource = fs.readFileSync(
  path.join(root, "supabase/migrations/20261006090000_allow_invoice_number_edit_by_owner.sql"),
  "utf8",
);

describe("invoice number edit contract", () => {
  it("renders the hydrated field only in the full edit form and passes actor context", () => {
    expect(modalSource).toContain('label="Número de Facturación"');
    expect(modalSource).toContain('value={form.invoice_number}');
    expect(modalSource).toContain("!assetsOnly");
    expect(sellerSource).toContain('isSemiAdmin={isSemiAdmin}');
    expect(sellerSource).toContain('actorId={authUser?.id || ""}');
  });

  it("keeps responsibility and production authorization guards in SQL", () => {
    expect(migrationSource).toContain("v_role = 'semi_admin'");
    expect(migrationSource).toContain("'in_Design'");
    expect(migrationSource).toContain("v_invoice_mode = 'cashier'");
    expect(migrationSource).toContain("v_role = 'admin' and v_command = 'on'");
    expect(migrationSource).toContain("Los datos financieros no pueden modificarse después de autorizar Producción.");
    expect(migrationSource).toContain("notify pgrst, 'reload schema'");
  });
});
