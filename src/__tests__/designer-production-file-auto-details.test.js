import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve("src/pages/page-designer.jsx"), "utf8");
const fileSelection = source.slice(
  source.indexOf("const handleFileSelect ="),
  source.indexOf("const handlePreviewSelect ="),
);
const previewSelection = source.slice(
  source.indexOf("const handlePreviewSelect ="),
  source.indexOf("const removePendingFile ="),
);

describe("Designer production-file details selection contract", () => {
  it("opens details for the first accepted production file after size validation", () => {
    expect(fileSelection).toContain("const firstNewFileIndex = pendingFiles.length;");
    expect(fileSelection).toContain("setFileDetailsTarget({ type: \"pending\", index: firstNewFileIndex, file: acceptedFiles[0] });");
    expect(fileSelection.indexOf("setFileDetailsTarget(")).toBeGreaterThan(fileSelection.indexOf("if (acceptedFiles.length > 0)"));
  });

  it("does not open production details for work-order preview selection", () => {
    expect(previewSelection).toContain("setPendingPreview(file);");
    expect(previewSelection).not.toContain("setFileDetailsTarget(");
  });
});
