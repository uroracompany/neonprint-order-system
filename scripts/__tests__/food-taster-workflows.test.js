import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPaths = [
  resolve(projectRoot, ".github/workflows/food-taster.yml"),
  resolve(projectRoot, ".github/workflows/food-taster-trusted.yml"),
];
const readText = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

describe("Food Taster workflow supply-chain and privilege boundaries", () => {
  it("wires the trusted App gate to Food Taster completion and the protected-check contract", async () => {
    const trusted = await readText(workflowPaths[1]);
    const controller = await readText(resolve(projectRoot, "scripts/food-taster-github.mjs"));
    const documentation = await readText(resolve(projectRoot, "docs/food-taster.md"));

    expect(trusted).toMatch(/^on:\s*\r?\n\s+workflow_run:\s*\r?\n\s+workflows:\s*\r?\n\s+- Food Taster\s*$/m);
    expect(trusted).toMatch(/^\s+types:\s*\r?\n\s+- completed\s*$/m);
    expect(trusted).not.toContain("pull_request_target:");
    expect(controller).toContain('const CHECK_NAME = "Food Taster gate";');
    expect(documentation).toContain("require `Food Taster gate`.");
  });

  it("pins every GitHub Action use to a full 40-character commit SHA", async () => {
    for (const path of workflowPaths) {
      const workflow = await readText(path);
      const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
      expect(references.length, `${path} should contain pinned Actions`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference, `${path}: ${reference}`).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i);
      }
    }
  });

  it("uses the dedicated App Check Run publisher and no commit status permission", async () => {
    const trusted = await readText(workflowPaths[1]);
    expect(trusted).toContain("actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510");
    expect(trusted).toContain("permission-checks: write");
    expect(trusted).toContain("food-taster-publisher");
    expect(trusted).not.toMatch(/statuses:\s*write/);
    expect(trusted).not.toContain("pull_request_target");
    expect(trusted).not.toContain("actions/download-artifact");
  });

  it("runs a trusted code-only gate on the exact PR head with least privilege", async () => {
    const trusted = await readText(workflowPaths[1]);
    const pullRequest = await readText(workflowPaths[0]);
    expect(trusted).not.toMatch(/id-token:\s*write|VERCEL_TOKEN|VERCEL_AUTOMATION|_BYPASS_SECRET/);
    expect(pullRequest).toContain("run: npm run test:e2e:smoke");
    expect(pullRequest).not.toContain("run: npm run test:e2e:preview");
    expect(pullRequest).not.toContain("deployments: read");
    expect(pullRequest).not.toContain("pull-requests: read");
    expect(pullRequest).not.toContain("FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED");
    expect(pullRequest).not.toMatch(/secrets\.|VERCEL_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
    expect(trusted).toContain("  quality:");
    expect(trusted).not.toContain("preview-smoke");
    expect(trusted).not.toContain("deployments: read");
    expect(trusted).toContain("ref: ${{ needs.validate-pull-request.outputs.head_sha }}");
    expect(trusted).toContain("repository: ${{ needs.validate-pull-request.outputs.head_repo }}");
    expect(trusted).toContain("persist-credentials: false");
    expect(trusted).toContain("permissions:\n      contents: read\n    steps:");
    expect(trusted).toContain("run: npm run security:check");
    expect(trusted).toContain("run: npm run lint");
    expect(trusted).toContain("run: npm run test -- --maxWorkers=2");
    expect(trusted).toContain("run: npm run build");
    expect(trusted).toContain("run: npm run test:e2e:smoke");
    expect(trusted).toContain("https://food-taster.invalid");
    expect(trusted).toContain("food-taster-placeholder");
    expect(trusted).not.toMatch(/FOOD_TASTER_STAGING|FOOD_TASTER_PRODUCTION|FOOD_TASTER_PREVIEW|SUPABASE_SERVICE_ROLE_KEY|VERCEL_/);
    const finalizer = trusted.split("  publish-food-taster-gate:")[1] || "";
    expect(finalizer).toContain("- quality");
    expect(finalizer).toContain("needs.quality.result == 'success' && 'success' || 'failure'");
    expect(finalizer).not.toContain("preview");
    const prohibited = ["VERCEL_AUTOMATION", "_BYPASS_SECRET"].join("");
    const bypassHeader = ["x-vercel-protection", "-bypass"].join("");
    const scanned = await Promise.all([
      ...workflowPaths,
      resolve(projectRoot, "e2e/food-taster.spec.js"),
      resolve(projectRoot, "playwright.config.js"),
      resolve(projectRoot, "docs/food-taster.md"),
    ].map((path) => readText(path)));
    expect(scanned.join("\n")).not.toContain(prohibited);
    expect(scanned.join("\n")).not.toContain(bypassHeader);
    const smoke = await readText(resolve(projectRoot, "e2e/food-taster.spec.js"));
    const config = await readText(resolve(projectRoot, "playwright.config.js"));
    expect(smoke).toContain('const smokeOrigin = "http://127.0.0.1:4173"');
    expect(smoke).toContain("requestUrl.origin !== smokeOrigin");
    expect(config).toContain("reuseExistingServer: false");
    expect(config).toContain("--host 127.0.0.1");
    expect(config).toContain('baseURL: loopbackURL');
    expect(config).toContain('command: "npm run preview -- --host 127.0.0.1 --port 4173 --strictPort"');
    expect(config).not.toMatch(/PLAYWRIGHT_BASE_URL|FOOD_TASTER_PREVIEW|supabase\.co|vercel\.app/);
  });
});
