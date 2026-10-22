import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const designerSource = readFileSync("src/pages/page-designer.jsx", "utf8");

describe("designer production file detail action labels", () => {
  it("evaluates the pending file metadata and keeps the existing details modal action", () => {
    expect(designerSource).toContain("publicLabel: pendingFileLabels[i]");
    expect(designerSource).toContain("areaCode: pendingFileAreas[i]");
    expect(designerSource).toContain("materialNames: pendingFileMaterials[i]");
    expect(designerSource).toContain("terminationName: pendingFileTerminations[i]");
    expect(designerSource).toContain('const actionLabel = isComplete ? "Editar" : "Detalles";');
    expect(designerSource).toContain('setFileDetailsTarget({ type: "pending", index: i, file })');
    expect(designerSource).toContain("ariaLabel: actionName");
  });

  it("evaluates saved specifications and retains the saved-file details callback", () => {
    expect(designerSource).toContain("publicLabel: file.productionFile?.public_label");
    expect(designerSource).toContain("areaCode: file.productionFile?.production_area_code");
    expect(designerSource).toContain("materialNames: file.productionFile?.material_names");
    expect(designerSource).toContain("terminationName: file.productionFile?.termination_name");
    expect(designerSource).toContain('setFileDetailsTarget({ type: "saved", file })');
    expect(designerSource.match(/const isComplete = isProductionFileDetailsComplete\(/g)).toHaveLength(2);
    expect(designerSource.match(/const actionLabel = isComplete \? "Editar" : "Detalles";/g)).toHaveLength(2);
  });
});
