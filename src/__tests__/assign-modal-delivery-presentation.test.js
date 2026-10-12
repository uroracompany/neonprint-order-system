import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { describe, expect, it } from "vitest";

const read = (file) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("presentación del modal de asignación de Entrega", () => {
  const assignModal = read("src/components/ui/AssignModal.jsx");
  const shellCss = read("src/components/ui/AssignmentModalShell.css");
  const assignCss = read("src/components/ui/AssignModal.css");

  it("resalta el ID y la instrucción en verde accesible, con cliente negro", () => {
    expect(shellCss).toContain(".ams-dialog--delivery .ams-order-id { color:#047857; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--delivery .ams-order-client { color:#111827; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--delivery .ams-body>p { color:#047857; font-weight:600; }");
  });

  it("usa el icono de camioneta solo para Entrega y conserva Send para los demás roles", () => {
    expect(assignModal).toContain('role === "delivery"');
    expect(assignModal).toContain('<Icons.Truck aria-hidden="true" />');
    expect(assignModal).toContain('<Icons.Send aria-hidden="true" />');
    expect(assignModal).toContain('loading ? "Asignando..." : "Asignar Orden"');
    expect(assignCss).toContain(".ams-assign-button--primary");
  });

  it("no cambia la paleta de Caja ni Diseño", () => {
    expect(shellCss).toContain(".ams-dialog--quote .ams-order-id { color:#1E40AF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--quote .ams-body>p { color:#1E40AF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--designer .ams-order-id { color:#4A4EAADF; font-weight:600; }");
    expect(shellCss).toContain(".ams-dialog--designer .ams-body>p { color:#7C3AED; font-weight:600; }");
  });
});
