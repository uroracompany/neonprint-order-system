import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPaths = [
  resolve(projectRoot, ".github/workflows/food-taster.yml"),
  resolve(projectRoot, ".github/workflows/food-taster-trusted.yml"),
];
const readWorkflow = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");

describe("Food Taster workflow supply-chain and privilege boundaries", () => {
  it("pins every GitHub Action use to a full 40-character commit SHA", async () => {
    for (const path of workflowPaths) {
      const workflow = await readWorkflow(path);
      const references = [...workflow.matchAll(/^\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gm)].map((match) => match[1]);
      expect(references.length, `${path} should contain pinned Actions`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference, `${path}: ${reference}`).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-f0-9]{40}$/i);
      }
    }
  });

  it("uses the dedicated App Check Run publisher and no commit status permission", async () => {
    const trusted = await readWorkflow(workflowPaths[1]);
    expect(trusted).toContain("actions/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510");
    expect(trusted).toContain("permission-checks: write");
    expect(trusted).toContain("food-taster-publisher");
    expect(trusted).not.toMatch(/statuses:\s*write/);
    expect(trusted).not.toContain("pull_request_target");
    expect(trusted).not.toContain("actions/download-artifact");
  });

  it("never sends credentials to PR-controlled Preview code", async () => {
    const trusted = await readWorkflow(workflowPaths[1]);
    const resolverIndex = trusted.indexOf("Resolve exact READY Vercel Preview");
    const browserIndex = trusted.indexOf("Run trusted read-only browser smoke");
    const previewJob = trusted.slice(trusted.indexOf("  preview-smoke:"), trusted.indexOf("  publish-food-taster-gate:"));
    const resolverStep = trusted.slice(resolverIndex, browserIndex);
    const browserStep = trusted.slice(browserIndex, trusted.indexOf("\n\n  publish-food-taster-gate:"));
    expect(resolverIndex).toBeGreaterThan(-1);
    expect(browserIndex).toBeGreaterThan(resolverIndex);
    expect(previewJob).toMatch(/permissions:\s*\n\s+contents: read\s*\n\s+deployments: read/);
    expect(previewJob).not.toContain("id-token:");
    expect(previewJob).not.toContain("environment:");
    expect(trusted).not.toContain("id-token: write");
    expect(trusted).toContain("FOOD_TASTER_STAGING_DEPLOYMENT_VERIFIED: \"true\"");
    expect(browserStep).toContain("run: npm run test:e2e:preview");
    expect(browserStep).not.toMatch(/ACTIONS_ID_TOKEN_REQUEST|id-token|OIDC|VERCEL_TRUSTED_SOURCE_OIDC_TOKEN/);
    expect(browserStep).not.toContain("GITHUB_OUTPUT");
    expect(browserStep).not.toContain("upload-artifact");
    expect(trusted).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(trusted).not.toContain("x-vercel-protection-bypass");
    expect(resolverStep).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(previewJob).toContain("deployments: read");
    expect(browserStep).toContain("PLAYWRIGHT_BASE_URL:");
    expect(browserStep).toContain("run: npm run test:e2e:preview");
    expect(browserStep).not.toContain("GITHUB_TOKEN");
    expect(browserStep).not.toContain("VERCEL_TOKEN");

    const smoke = await readFile(resolve(projectRoot, "e2e/food-taster.spec.js"), "utf8");
    const handlerStart = smoke.indexOf("await context.route(");
    const handlerEnd = smoke.indexOf("await context.routeWebSocket(");
    const handler = smoke.slice(handlerStart, handlerEnd);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(smoke).toContain("process.env.FOOD_TASTER_STAGING_DEPLOYMENT_VERIFIED");
    expect(smoke).not.toMatch(/OIDC|VERCEL_TRUSTED_SOURCE|x-vercel-trusted-oidc-idp-token/);
    expect(smoke).not.toContain("VERCEL_AUTOMATION_BYPASS_SECRET");
    expect(smoke).not.toContain("x-vercel-protection-bypass");
    expect(handler.indexOf("if (!isAllowedRequest)")).toBeLessThan(handler.indexOf("if (!isLocalSmoke)"));
    expect(handler).toContain("requestOrigin !== preview.origin");
    expect(handler).toContain("await route.continue();");
    expect(smoke).not.toMatch(/setExtraHTTPHeaders|addInitScript|extraHTTPHeaders/);
    expect(browserStep).not.toMatch(/--.*VERCEL_AUTOMATION_BYPASS_SECRET|PLAYWRIGHT_BASE_URL:.*VERCEL_AUTOMATION_BYPASS_SECRET/);

    const previewConfig = await readFile(resolve(projectRoot, "playwright.preview.config.js"), "utf8");
    expect(previewConfig).not.toContain("VERCEL_TRUSTED_SOURCE_OIDC_TOKEN");
    expect(previewConfig).not.toContain("x-vercel-trusted-oidc-idp-token");

    const listFiles = async (directory) => {
      const files = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) files.push(...await listFiles(resolve(directory, entry.name)));
        else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name)) files.push(resolve(directory, entry.name));
      }
      return files;
    };
    const appFiles = await listFiles(resolve(projectRoot, "src"));
    const appSources = await Promise.all(appFiles.map((path) => readFile(path, "utf8")));
    expect(appSources.join("\n")).not.toContain("VERCEL_TRUSTED_SOURCE_OIDC_TOKEN");
    expect(appSources.join("\n")).not.toContain("x-vercel-trusted-oidc-idp-token");
  });

  it("runs the remote Preview smoke without starting a local web server", async () => {
    const trusted = await readWorkflow(workflowPaths[1]);
    const previewJob = trusted.slice(trusted.indexOf("  preview-smoke:"), trusted.indexOf("  publish-food-taster-gate:"));
    const previewConfig = await readFile(resolve(projectRoot, "playwright.preview.config.js"), "utf8");
    const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));

    expect(previewJob).toContain("run: npm run test:e2e:preview");
    expect(previewJob).toContain("PLAYWRIGHT_BASE_URL: ${{ steps.preview.outputs.url }}");
    expect(packageJson.scripts["test:e2e:preview"]).toContain("playwright.preview.config.js");
    expect(previewConfig).toContain("baseURL,");
    expect(previewConfig).not.toContain("webServer:");
    expect(previewConfig).not.toContain("GITHUB_TOKEN");
  });
});
