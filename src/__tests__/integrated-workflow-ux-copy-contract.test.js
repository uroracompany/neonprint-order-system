import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(file), "utf8");

describe("contrato de UX integrada", () => {
  it("usa el copy visible de imagen de orden de trabajo sin renombrar los identificadores técnicos", () => {
    const files = [
      "src/components/orders/CreateOrderModal.jsx",
      "src/components/orders/EditOrderModal.jsx",
      "src/components/orders/AdminManageFilesModal.jsx",
      "src/components/orders/OrderDetailModal.jsx",
      "src/components/orders/SemiAdminOperationalPanel.jsx",
      "src/components/designer/DesignerProfileModule.jsx",
      "src/pages/dashboard.jsx",
      "src/pages/page-designer.jsx",
      "src/pages/page-quote.jsx",
      "src/pages/page-production.jsx",
      "src/pages/page-delivery.jsx",
    ].map(read).join("\n");

    expect(files).toContain("Imagen de orden de trabajo");
    expect(files).toContain("Subir imagen de orden de trabajo");
    expect(files).toContain("Cambiar imagen de orden de trabajo");
    expect(files).toContain("Reemplazar imagen de orden de trabajo");
    expect(files).not.toContain('buttonLabel="Subir preview"');
    expect(files).not.toContain('buttonLabel="Cambiar preview"');
    expect(files).not.toContain('alt="Preview"');
    expect(files).toContain('preview_image');
    expect(files).toContain('order-previews');
  });

  it("mantiene una carcasa de asignación accesible y evita el contexto duplicado", () => {
    const shell = read("src/components/ui/AssignmentModalShell.jsx");
    const assign = read("src/components/ui/AssignModal.jsx");

    expect(shell).toContain("requestAnimationFrame");
    expect(shell).toContain('event.key === "Escape"');
    expect(shell).toContain('event.key !== "Tab"');
    expect(shell).toContain("previousFocusRef.current?.focus");
    expect(shell).toContain("aria-modal=\"true\"");
    expect(assign).toContain("AssignmentModalShell");
    expect(assign).not.toContain('background: "#F9FAFB", border: "1px solid #E5E7EB"');
  });

  it("expone el mismo retorno Diseño a Ventas en recientes, tabla completa y tarjetas", () => {
    const designer = read("src/pages/page-designer.jsx");
    const occurrences = designer.match(/canDesignerReturnInternalOrderToSales\(order, user\?\.id\)/g) || [];

    expect(occurrences).toHaveLength(3);
    expect(designer).toContain('targetOverride="sales"');
    expect(designer).toContain("setReturningToSales(order)");
  });

  it("hace explícito el alcance de crédito y no duplica el éxito durable de autorización", () => {
    const quote = read("src/pages/page-quote.jsx");
    const authorization = quote.slice(
      quote.indexOf("const handleAuthorizeProduction"),
      quote.indexOf("// Archiva órdenes", quote.indexOf("const handleAuthorizeProduction")),
    );

    expect(quote).toContain("Crear recordatorio para ${openInvoices.length} facturas pendientes");
    expect(quote).toContain("Marcar ${selectedIds.length} facturas seleccionadas como saldadas");
    expect(quote).toContain("Ver facturas de ${group.client?.name || \"cliente sin nombre\"}");
    expect(quote).toContain("Crear recordatorio para ${openInvoices.length} facturas pendientes de ${group.client?.name || \"cliente sin nombre\"}");
    expect(quote).toContain("Marcar ${openInvoices.length} facturas pendientes de ${group.client?.name || \"cliente sin nombre\"} como saldadas");
    expect(authorization).toContain('rpc("authorize_order_for_production"');
    expect(authorization).not.toContain('title: "Producción autorizada"');
  });

  it("ejecuta la normalización operativa después de la canónica y conserva variantes de Producción", () => {
    const migration = read("supabase/migrations/20260926212712_normalize_operational_notification_presentation.sql");

    expect(migration).toContain("trg_zz_normalize_operational_notification_presentation");
    expect(migration).toContain("trg_normalize_order_success_notification");
    expect(migration).toContain("else 'production_assignment' end");
    expect(migration).toContain("jsonb_build_object('variant', 'production_reassignment')");
  });
});
