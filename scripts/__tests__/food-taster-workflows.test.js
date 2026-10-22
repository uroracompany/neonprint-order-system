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

  it("uses read-only GitHub deployment metadata and gives no credential to Playwright", async () => {
    const trusted = await readFile(workflowPaths[1], "utf8");
    const resolverIndex = trusted.indexOf("Resolve exact READY Vercel Preview");
    const browserIndex = trusted.indexOf("Run trusted read-only browser smoke");
    const previewJob = trusted.slice(trusted.indexOf("  preview-smoke:"), trusted.indexOf("  publish-food-taster-gate:"));
    const resolverStep = trusted.slice(resolverIndex, browserIndex);
    const browserStep = trusted.slice(browserIndex, trusted.indexOf("publish-food-taster-gate:"));
    expect(resolverIndex).toBeGreaterThan(-1);
    expect(browserIndex).toBeGreaterThan(resolverIndex);
    expect(previewJob).toMatch(/permissions:\s*\n\s+contents: read\s*\n\s+deployments: read/);
    expect(previewJob).not.toContain("environment:");
    expect(trusted).not.toContain("id-token:");
    expect(trusted).not.toContain("FOOD_TASTER_TRUSTED_SOURCE_OIDC_VERIFIED");
    expect(trusted).not.toContain("VERCEL_TRUSTED_SOURCE_AUDIENCE");
    expect(trusted).not.toContain("secrets.VERCEL_");
    expect(resolverStep).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(previewJob).toContain("deployments: read");
    expect(browserStep).toContain("PLAYWRIGHT_BASE_URL:");
    expect(browserStep).not.toContain("GITHUB_TOKEN");
    expect(browserStep).not.toContain("VERCEL_TOKEN");
    expect(browserStep).not.toContain("OIDC");
    const prohibited = ["VERCEL_AUTOMATION", "_BYPASS_SECRET"].join("");
    const bypassHeader = ["x-vercel-protection", "-bypass"].join("");
    const scanned = await Promise.all([
      ...workflowPaths,
      resolve(projectRoot, "scripts/food-taster-preview-origin.mjs"),
      resolve(projectRoot, "e2e/food-taster.spec.js"),
      resolve(projectRoot, "docs/food-taster.md"),
    ].map((path) => readFile(path, "utf8")));
    expect(scanned.join("\n")).not.toContain(prohibited);
    expect(scanned.join("\n")).not.toContain(bypassHeader);
  });
});
