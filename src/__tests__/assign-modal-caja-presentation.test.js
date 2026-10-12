import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("sistema visual compartido para los modales de asignación", () => {
  const assignModal = read("src/components/ui/AssignModal.jsx");
  const shell = read("src/components/ui/AssignmentModalShell.jsx");
  const shellCss = read("src/components/ui/AssignmentModalShell.css");
  const assignCss = read("src/components/ui/AssignModal.css");
  const productionModal = read("src/components/orders/ProductionAssignmentModal.jsx");

  it("muestra el ID y la instrucción de Diseño en violeta semibold sin afectar Caja", () => {
    expect(shellCss).toContain(".ams-dialog--designer .ams-order-id { color:#4A4EAADF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--designer .ams-order-client { color:#111827; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--designer .ams-body>p { color:#7C3AED; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-order-id { color:#1E40AF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-body>p { color:#1E40AF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-order-client { color:#111827; font-weight:600; }");
  });

  it("mantiene el ID azul, cliente negro y énfasis de Caja sin cambiar los demás roles", () => {
    expect(shell).toContain("className=\"ams-order-summary\"");
    expect(shell).toContain("className=\"ams-order-id\"");
    expect(shell).toContain("className=\"ams-order-client\"");
    expect(shellCss).toContain(".ams-dialog--quote .ams-header h3");
    expect(shellCss).toContain(".ams-dialog--quote .ams-order-id { color:#1E40AF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-order-client { color:#111827; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-body>p { color:#1E40AF; font-weight:600; }");
  });

  it("usa el marco y el footer del mismo shell que el modal de Producción", () => {
    expect(assignModal).toContain("dialogClassName=\"ams-assign-modal\"");
    expect(assignModal).toContain("footer={(");
    expect(assignModal).toContain("className=\"ams-assign-actions\"");
    expect(productionModal).toContain("AssignmentModalShell");
    expect(productionModal).toContain("footer={<div className=\"pq-dialog-actions\"");
    expect(assignCss).toContain(".ams-assign-modal .ams-body");
    expect(assignCss).toContain(".ams-assign-modal .ams-footer");
    expect(assignCss).toContain("background: #f8fafc;");
    expect(assignCss).toContain(".ams-assign-button--primary");
    expect(assignCss).toContain("@media (max-width: 520px)");
  });

  it("conserva las acciones del selector y usa icono Send en Caja y en los otros roles", () => {
    expect(assignModal).toContain("<Icons.Send aria-hidden=\"true\" />");
    expect(assignModal).toContain("Asignar Orden");
    expect(assignModal).toContain("Cancelar");
    expect(assignModal).toContain("<Icons.ChevronDown aria-hidden=\"true\" focusable=\"false\" />");
    expect(assignCss).toContain(".ams-assign-select-wrap > svg");
    expect(assignCss).toContain("pointer-events: none;");
  });

  it("preserva el estado de carga, selección, validación y contenido específico por rol", () => {
    expect(assignModal).toContain("disabled={loading || (!selectedUserId && !allowUnassigned)}");
    expect(assignModal).toContain("{loading ? \"Asignando...\" : \"Asignar Orden\"}");
    expect(assignModal).toContain("setSelectedUserId(e.target.value)");
    expect(assignModal).toContain("hasLockedDelivery");
    expect(assignModal).toContain("allowSelfAssignment");
    expect(assignModal).toContain("allowUnassigned");
    expect(assignCss).toContain(".ams-assign-button:disabled");
  });
});
