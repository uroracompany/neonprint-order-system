import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const designerSource = fs.readFileSync(
  path.resolve(globalThis.process.cwd(), "src/pages/page-designer.jsx"),
  "utf8",
);
const fileCardSource = fs.readFileSync(
  path.resolve(globalThis.process.cwd(), "src/components/FileCard.jsx"),
  "utf8",
);

describe("Diseño: detalles de archivos", () => {
  it("usa FileCard y el mismo estado de atención para archivos pendientes", () => {
    expect(designerSource).toContain('import FileCard from "../components/FileCard"');
    expect(designerSource).toContain("attention: pendingDetailsIndices.includes(i)");
    expect(designerSource).toContain("setPendingDetailsIndices(prev => prev.filter((pendingIndex) => pendingIndex !== i))");
  });

  it("expone el estado pendiente como clase y atributo accesible del botón", () => {
    expect(fileCardSource).toContain('fc-file-action-attention');
    expect(fileCardSource).toContain('data-details-pending={action.attention ? "true" : undefined}');
  });
});
