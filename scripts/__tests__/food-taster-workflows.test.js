import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPaths = [
  resolve(projectRoot, ".github/workflows/food-taster.yml"),
  resolve(projectRoot, ".github/workflows/food-taster-trusted.yml"),
];

describe("Food Taster workflow supply-chain and privilege boundaries", () => {
  it("pins every GitHub Action use to a full 40-character commit SHA", async () => {
    for (const path of workflowPaths) {
      const workflow = await readFile(path, "utf8");
      const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
      expect(references.length, `${path} should contain pinned Actions`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference, `${path}: ${reference}`).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i);
      }
    }
  });

  it("uses the dedicated App Check Run publisher and no commit status permission", async () => {
    const trusted = await readFile(workflowPaths[1], "utf8");
    expect(trusted).toContain("actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510");
    expect(trusted).toContain("permission-checks: write");
    expect(trusted).toContain("food-taster-publisher");
    expect(trusted).not.toMatch(/statuses:\s*write/);
    expect(trusted).not.toContain("pull_request_target");
    expect(trusted).not.toContain("actions/download-artifact");
  });

  it("keeps browser smoke unprivileged and restricted to the local build", async () => {
    const trusted = await readFile(workflowPaths[1], "utf8");
    const pullRequest = await readFile(workflowPaths[0], "utf8");
    expect(trusted).not.toMatch(/id-token:\s*write|VERCEL_TOKEN|VERCEL_AUTOMATION|_BYPASS_SECRET/);
    expect(pullRequest).toContain("run: npm run test:e2e:smoke");
    expect(trusted).toContain("run: npm run test:e2e:smoke");
    expect(trusted).not.toContain("preview-smoke:");
    const prohibited = ["VERCEL_AUTOMATION", "_BYPASS_SECRET"].join("");
    const bypassHeader = ["x-vercel-protection", "-bypass"].join("");
    const scanned = await Promise.all([
      ...workflowPaths,
      resolve(projectRoot, "e2e/food-taster.spec.js"),
      resolve(projectRoot, "playwright.config.js"),
      resolve(projectRoot, "docs/food-taster.md"),
    ].map((path) => readFile(path, "utf8")));
    expect(scanned.join("\n")).not.toContain(prohibited);
    expect(scanned.join("\n")).not.toContain(bypassHeader);
    const smoke = await readFile(resolve(projectRoot, "e2e/food-taster.spec.js"), "utf8");
    const config = await readFile(resolve(projectRoot, "playwright.config.js"), "utf8");
    expect(smoke).toContain('const smokeOrigin = "http://127.0.0.1:4173"');
    expect(smoke).toContain("requestUrl.origin !== smokeOrigin");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("--host 127.0.0.1");
  });
});
