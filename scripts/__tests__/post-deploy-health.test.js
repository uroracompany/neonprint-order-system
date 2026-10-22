import { describe, expect, it } from "vitest";
import {
  classifyDeploymentEvent,
  fetchLatestProductionDeployment,
  isAllowedProductionReadRequest,
  isOptionalFontRequest,
  PRODUCTION_ENVIRONMENT,
  REPOSITORY,
  resolveLatestProductionDeployment,
  VERCEL_BOT,
  validateDeploymentUrl,
  validateProductionSmokeUrl,
} from "../post-deploy-health.mjs";

const deploymentId = 7188479253;
const statusId = 981234567;
const sha = "b031d54272bcd80962f0d6fc0f64e908837d306b";
const immutableUrl = "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app";
const statusUrl = `https://api.github.com/repos/${REPOSITORY}/deployments/${deploymentId}`;

function event(overrides = {}) {
  return {
    repository: { name: "neonprint-order-system", owner: { login: "uroracompany" } },
    deployment: {
      id: deploymentId,
      sha,
      task: "deploy",
      environment: PRODUCTION_ENVIRONMENT,
      production_environment: false,
      creator: VERCEL_BOT,
    },
    deployment_status: {
      id: statusId,
      state: "success",
      environment: PRODUCTION_ENVIRONMENT,
      creator: VERCEL_BOT,
      deployment_url: statusUrl,
      environment_url: immutableUrl,
    },
    ...overrides,
  };
}

describe("post-deploy health event validation", () => {
  it("accepts the verified Vercel Production deployment URL despite production_environment=false", () => {
    expect(classifyDeploymentEvent(event())).toEqual({
      outcome: "smoke",
      deploymentId: String(deploymentId),
      statusId: String(statusId),
      sha,
      url: immutableUrl,
      smokeUrl: "https://neonprint-order-system.vercel.app",
    });
  });

  it("ignores unrelated Preview deployments and pending Production statuses", () => {
    const preview = event({
      deployment: { ...event().deployment, environment: "Preview – neonprint-order-system-food-taster" },
      deployment_status: { ...event().deployment_status, environment: "Preview – neonprint-order-system-food-taster" },
    });
    expect(classifyDeploymentEvent(preview).outcome).toBe("ignore");
    const pending = event({ deployment_status: { ...event().deployment_status, state: "pending" } });
    expect(classifyDeploymentEvent(pending).outcome).toBe("ignore");
    expect(classifyDeploymentEvent(event({ repository: { name: "another-repo", owner: { login: "uroracompany" } } })).outcome).toBe("ignore");
  });

  it.each([
    ["wrong creator", event({ deployment: { ...event().deployment, creator: { login: "attacker", id: 1 } } })],
    ["wrong task", event({ deployment: { ...event().deployment, task: "deploy:production" } })],
    ["malformed SHA", event({ deployment: { ...event().deployment, sha: "main" } })],
    ["wrong status identity URL", event({ deployment_status: { ...event().deployment_status, deployment_url: "https://api.github.com/repos/other/repo/deployments/1" } })],
    ["untrusted Production URL", event({ deployment_status: { ...event().deployment_status, environment_url: "https://attacker.example" } })],
  ])("rejects %s", (_label, payload) => {
    expect(classifyDeploymentEvent(payload).outcome).toBe("fail");
  });

  it.each(["failure", "error"])("reports Vercel Production state %s as a failed run", (state) => {
    expect(classifyDeploymentEvent(event({ deployment_status: { ...event().deployment_status, state } }))).toMatchObject({ outcome: "deployment-failed" });
  });

  it("skips an older status when the GitHub API reports a newer Production deployment", () => {
    const oldDeployment = { id: deploymentId, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-18T10:00:00Z" };
    const newerDeployment = { id: 9000000000, sha: "f".repeat(40), task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-19T10:00:00Z" };
    expect(resolveLatestProductionDeployment([oldDeployment, newerDeployment], deploymentId, sha)).toMatchObject({
      current: false,
      latestDeploymentId: "9000000000",
      latestSha: "f".repeat(40),
    });
  });

  it("chooses the newest deployment when the API response is out of order", () => {
    const currentDeployment = { id: deploymentId, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-19T10:00:00Z" };
    const olderDeployment = { id: 7000000000, sha: "a".repeat(40), task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-18T10:00:00Z" };
    expect(resolveLatestProductionDeployment([currentDeployment, olderDeployment], deploymentId, sha).current).toBe(true);
  });

  it("allows processing when the API's latest deployment ID and SHA match the event", () => {
    const currentDeployment = { id: deploymentId, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-19T10:00:00Z" };
    expect(resolveLatestProductionDeployment([currentDeployment], deploymentId, sha).current).toBe(true);
  });

  it("requires a verified latest Vercel Production deployment", () => {
    expect(() => resolveLatestProductionDeployment([], deploymentId, sha)).toThrow(/no current Production/);
    expect(() => resolveLatestProductionDeployment([{ id: 9000000000, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: { login: "other", id: 1 }, created_at: "2026-10-19T10:00:00Z" }], deploymentId, sha)).toThrow(/not from Vercel/);
    expect(() => resolveLatestProductionDeployment([{ id: deploymentId, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT }], deploymentId, sha)).toThrow(/created_at/);
    const tie = [0, 1].map((index) => ({ id: deploymentId + index, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-19T10:00:00Z" }));
    expect(() => resolveLatestProductionDeployment(tie, deploymentId, sha)).toThrow(/ambiguous/);
  });

  it("paginates all deployment records before selecting the newest", async () => {
    const olderRecords = Array.from({ length: 100 }, (_, index) => ({
      id: 8000000000 + index,
      sha: "a".repeat(40),
      task: "deploy",
      environment: PRODUCTION_ENVIRONMENT,
      creator: VERCEL_BOT,
      created_at: "2026-10-18T10:00:00Z",
    }));
    const newest = { id: deploymentId, sha, task: "deploy", environment: PRODUCTION_ENVIRONMENT, creator: VERCEL_BOT, created_at: "2026-10-19T10:00:00Z" };
    const requestedPages = [];
    const fetchImpl = async (url, options) => {
      requestedPages.push(new URL(url).searchParams.get("page"));
      expect(new URL(url).origin + new URL(url).pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/deployments`);
      expect(options.headers.Authorization).toBe("Bearer test-read-token");
      return { ok: true, json: async () => requestedPages.length === 1 ? olderRecords : [newest] };
    };

    await expect(fetchLatestProductionDeployment({ id: deploymentId, sha }, { token: "test-read-token", fetchImpl }))
      .resolves.toMatchObject({ current: true, latestDeploymentId: String(deploymentId) });
    expect(requestedPages).toEqual(["1", "2"]);
  });

  it("fails closed when the API is unavailable or pagination exceeds the safe cap", async () => {
    const failedFetch = async () => ({ ok: false, status: 403 });
    await expect(fetchLatestProductionDeployment({ id: deploymentId, sha }, { token: "test-read-token", fetchImpl: failedFetch }))
      .rejects.toThrow(/HTTP 403/);

    let pageCount = 0;
    const fullPagesFetch = async () => {
      pageCount += 1;
      return { ok: true, json: async () => Array.from({ length: 100 }, (_, index) => ({ id: 9000000000 + pageCount * 100 + index })) };
    };
    await expect(fetchLatestProductionDeployment({ id: deploymentId, sha }, { token: "test-read-token", fetchImpl: fullPagesFetch }))
      .rejects.toThrow(/More than 2,000 deployments/);
    expect(pageCount).toBe(20);
  });
});

describe("immutable Production deployment URL policy", () => {
  it("accepts the project/team deployment host only", () => {
    expect(validateDeploymentUrl(immutableUrl)).toBe(true);
    expect(validateDeploymentUrl(`${immutableUrl}/`)).toBe(true);
  });

  it.each([
    "http://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app",
    "https://neonprint-order-system.vercel.app",
    "https://neonprint-order-system-food-taster-4gj2s25dt-urora-companys-projects.vercel.app",
    "https://neonprint-order-system-feature-branch-urora-companys-projects.vercel.app",
    "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app.attacker.example",
    "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app/path",
    "https://user:pass@neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app",
    "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app:443",
    "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app/?next=https://attacker.example",
  ])("rejects unsafe URL %s", (url) => {
    expect(validateDeploymentUrl(url)).toBe(false);
  });
});

describe("public Production smoke URL policy", () => {
  it("accepts only the canonical public Production alias", () => {
    expect(validateProductionSmokeUrl("https://neonprint-order-system.vercel.app")).toBe(true);
  });

  it.each([
    "https://neonprint-order-system-food-taster.vercel.app",
    "https://neonprint-order-system-4gj2s25dt-urora-companys-projects.vercel.app",
    "https://neonprint-order-system.vercel.app.attacker.example",
    "http://neonprint-order-system.vercel.app",
    "https://neonprint-order-system.vercel.app/",
  ])("rejects non-canonical smoke URL %s", (url) => {
    expect(validateProductionSmokeUrl(url)).toBe(false);
  });
});

describe("optional font request policy", () => {
  it("blocks only the known read-only Google Fonts stylesheet and font files", () => {
    expect(isOptionalFontRequest("https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Poppins:wght@300;400;500;600;700;800;900&display=swap", "GET")).toBe(true);
    expect(isOptionalFontRequest("https://fonts.gstatic.com/s/poppins/v23/example.woff2", "GET")).toBe(true);
    expect(isOptionalFontRequest("https://fonts.gstatic.com/s/poppins/arbitrary/example.woff2", "GET")).toBe(false);
    expect(isOptionalFontRequest("https://fonts.googleapis.com/css2?family=Poppins:wght@400", "POST")).toBe(false);
    expect(isOptionalFontRequest("https://fonts.gstatic.com/collect?id=123", "GET")).toBe(false);
    expect(isOptionalFontRequest("https://attacker.example/s/poppins/v23/a.woff2", "GET")).toBe(false);
  });
});

describe("Production browser request allowlist", () => {
  const origin = "https://neonprint-order-system.vercel.app";

  it.each(["/", "/assets/index-a1b2.js", "/favicon-32.png", "/favicon-48.png", "/favicon-180.png", "/favicon.ico"])("allows same-origin read-only shell asset %s", (path) => {
    expect(isAllowedProductionReadRequest(`${origin}${path}`, "GET", origin)).toBe(true);
  });

  it.each([
    ["POST", "/"],
    ["GET", "/api/orders"],
    ["GET", "/login?next=/orders"],
  ])("blocks unexpected production browser request %s %s", (method, path) => {
    expect(isAllowedProductionReadRequest(`${origin}${path}`, method, origin)).toBe(false);
  });
});
