import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const designerSource = readFileSync("src/pages/page-designer.jsx", "utf8");

describe("designer production file detail action labels", () => {
  it("evaluates the pending file metadata and keeps the existing details modal action", () => {
    expect(designerSource).toContain('fileDetailsTarget?.type === "pending"');
    expect(designerSource).toContain("publicLabel: pendingFileLabels[fileDetailsTarget.index] || \"\"");
    expect(designerSource).toContain("areaCode: pendingFileAreas[fileDetailsTarget.index] || \"\"");
    expect(designerSource).toContain("materialNames: pendingFileMaterials[fileDetailsTarget.index] || []");
    expect(designerSource).toContain("terminationName: pendingFileTerminations[fileDetailsTarget.index] || \"\"");
    expect(designerSource).toContain('const actionLabel = isComplete ? "Editar" : "Detalles";');
    expect(designerSource).toContain('setFileDetailsTarget({ type: "pending", index: i, file })');
    expect(designerSource).toContain("ariaLabel: actionName");
  });

  it("evaluates saved specifications and retains the saved-file details callback", () => {
    expect(designerSource).toContain("fileDetailsTarget?.file?.productionFile");
    expect(designerSource).toContain("publicLabel: fileDetailsTarget.file.productionFile.public_label || \"\"");
    expect(designerSource).toContain("areaCode: fileDetailsTarget.file.productionFile.production_area_code || \"\"");
    expect(designerSource).toContain("materialNames: fileDetailsTarget.file.productionFile.material_names || []");
    expect(designerSource).toContain("terminationName: fileDetailsTarget.file.productionFile.termination_name || \"\"");
    expect(designerSource).toContain('setFileDetailsTarget({ type: "saved", file })');
    expect(designerSource.match(/const isComplete = isProductionFileDetailsComplete\(/g)).toHaveLength(2);
    expect(designerSource.match(/const actionLabel = isComplete \? "Editar" : "Detalles";/g)).toHaveLength(2);
  });
});
