import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const viteConfig = readFileSync(resolve("vite.config.js"), "utf8");
const filesApi = readFileSync(resolve("api/files.js"), "utf8");

function readActionMap(source, declaration) {
  const match = source.match(new RegExp(`const ${declaration} = \\{([\\s\\S]*?)\\n\\};`));
  expect(match).not.toBeNull();

  return Object.fromEntries(
    [...match[1].matchAll(/"([^"]+)":\s*(\w+)/g)].map(([, action, handler]) => [action, handler]),
  );
}

describe("file actions router parity", () => {
  it("exposes the same file actions in Vite development and the Vercel endpoint", () => {
    const localActions = readActionMap(viteConfig, "FILES_ACTIONS");
    const productionActions = readActionMap(filesApi, "ACTIONS");

    expect(localActions).toEqual(productionActions);
  });

  it("routes managed asset resolution through the authorized download handler", () => {
    const localActions = readActionMap(viteConfig, "FILES_ACTIONS");
    const productionActions = readActionMap(filesApi, "ACTIONS");

    expect(viteConfig).toContain("handleResolveOrderAssetDownload");
    expect(filesApi).toContain("handleResolveOrderAssetDownload");
    expect(localActions["resolve-download"]).toBe("handleResolveOrderAssetDownload");
    expect(productionActions["resolve-download"]).toBe("handleResolveOrderAssetDownload");
  });

  it("keeps unknown actions rejected by both routers", () => {
    expect(viteConfig).toContain("if (!handler)");
    expect(filesApi).toContain("if (!handle)");
  });
});
