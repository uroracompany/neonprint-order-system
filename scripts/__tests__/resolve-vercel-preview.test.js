import { describe, expect, it, vi } from "vitest";
import {
  resolveAndWritePreview,
  resolveVercelPreview,
  validateDeploymentSet,
  validateDeploymentStatus,
  validatePreviewUrl,
  writeGitHubOutput,
} from "../resolve-vercel-preview.mjs";

const sha = "a".repeat(40);
const env = (overrides = {}) => ({
  GITHUB_TOKEN: "read-only-token",
  GITHUB_REPOSITORY: "uroracompany/neonprint-order-system",
  PR_HEAD_SHA: sha,
  VERCEL_PREVIEW_TIMEOUT_MS: "1000",
  GITHUB_OUTPUT: "fake-output",
  ...overrides,
});
const actor = { login: "vercel[bot]", id: 35613825, type: "Bot" };
const url = "https://neonprint-order-system-pr-42-urora-companys-projects.vercel.app";
const deployment = (overrides = {}) => ({
  id: 42,
  sha,
  environment: "Preview",
  production_environment: false,
  creator: actor,
  created_at: "2026-10-18T10:00:00Z",
  ...overrides,
});
const status = (overrides = {}) => ({
  id: 400,
  environment: "Preview",
  creator: actor,
  created_at: "2026-10-18T10:01:00Z",
  state: "success",
  environment_url: url,
  ...overrides,
});
const response = (body, headers = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (name) => headers[name.toLowerCase()] || null },
  json: async () => body,
});

describe("GitHub-backed Vercel Preview resolver", () => {
  it("resolves a Vercel-created Preview deployment for the exact full PR SHA", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response([
        deployment({ sha: "b".repeat(40) }),
        deployment({ environment: "Production", production_environment: true }),
        deployment(),
      ]))
      .mockResolvedValueOnce(response([status()]));

    await expect(resolveVercelPreview({ env: env(), fetchImpl })).resolves.toBe(url);
    const [deploymentsRequest, deploymentOptions] = fetchImpl.mock.calls[0];
    const parsed = new URL(deploymentsRequest);
    expect(parsed.origin).toBe("https://api.github.com");
    expect(parsed.pathname).toBe("/repos/uroracompany/neonprint-order-system/deployments");
    expect(parsed.searchParams.get("sha")).toBe(sha);
    expect(parsed.searchParams.get("environment")).toBe("Preview");
    expect(parsed.searchParams.get("per_page")).toBe("100");
    expect(deploymentOptions.headers.Authorization).toBe("Bearer read-only-token");
    expect(deploymentOptions.redirect).toBe("error");
    expect(fetchImpl.mock.calls[1][0]).toContain("/deployments/42/statuses");
  });

  it("follows only api.github.com pagination for deployments and statuses", async () => {
    const deploymentsNext = `https://api.github.com/repos/uroracompany/neonprint-order-system/deployments?sha=${sha}&environment=Preview&per_page=100&page=2`;
    const statusesNext = "https://api.github.com/repos/uroracompany/neonprint-order-system/deployments/42/statuses?per_page=100&page=2";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response([deployment({ id: 41, created_at: "2026-10-18T09:00:00Z" })], { link: `<${deploymentsNext}>; rel="next"` }))
      .mockResolvedValueOnce(response([deployment()]))
      .mockResolvedValueOnce(response([status({ id: 399, created_at: "2026-10-18T10:00:00Z" })], { link: `<${statusesNext}>; rel="next"` }))
      .mockResolvedValueOnce(response([status()]));
    await expect(resolveVercelPreview({ env: env(), fetchImpl })).resolves.toBe(url);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("selects the latest deployment and refuses to fall back to an older success", () => {
    const old = deployment({ id: 1, created_at: "2026-10-18T09:00:00Z" });
    const latest = deployment({ id: 2, created_at: "2026-10-18T10:00:00Z", creator: { login: "attacker", id: 1, type: "User" } });
    expect(() => validateDeploymentSet([old, latest], sha, "neonprint-order-system-", "-urora-companys-projects.vercel.app"))
      .toThrow("not from the verified Vercel bot");
  });

  it.each([
    ["wrong SHA", deployment({ sha: "f".repeat(40) })],
    ["production environment", deployment({ environment: "Production", production_environment: true })],
    ["production marker mismatch", deployment({ production_environment: true })],
  ])("does not accept a %s deployment", (label, candidate) => {
    expect(label).toBeTruthy();
    expect(validateDeploymentSet([candidate], sha, "neonprint-order-system-", "-urora-companys-projects.vercel.app")).toBeNull();
  });

  it("fails closed when the latest exact Preview deployment has the wrong bot identity", () => {
    const untrusted = deployment({ creator: { login: "vercel[bot]", id: 1, type: "Bot" } });
    expect(() => validateDeploymentSet([untrusted], sha)).toThrow("not from the verified Vercel bot");
  });

  it("rejects ambiguous equally recent deployments", () => {
    expect(() => validateDeploymentSet([deployment({ id: 1 }), deployment({ id: 2 })], sha, "neonprint-order-system-", "-urora-companys-projects.vercel.app"))
      .toThrow("equally recent");
  });

  it.each(["error", "failure", "inactive", "unknown"]) ("fails closed for final status %s", (state) => {
    expect(() => validateDeploymentStatus([status({ state })], "neonprint-order-system-", "-urora-companys-projects.vercel.app"))
      .toThrow(`ended in ${state}`);
  });

  it("waits for pending status and polls again", async () => {
    let time = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response([deployment()]))
      .mockResolvedValueOnce(response([status({ state: "in_progress" })]))
      .mockResolvedValueOnce(response([deployment()]))
      .mockResolvedValueOnce(response([status()]));
    await expect(resolveVercelPreview({
      env: env({ VERCEL_PREVIEW_TIMEOUT_MS: "30000" }),
      fetchImpl,
      now: () => time,
      sleep: async (ms) => { time += ms; },
    })).resolves.toBe(url);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("rejects an untrusted latest status instead of using an older Vercel success", () => {
    expect(() => validateDeploymentStatus([
      status({ id: 1, created_at: "2026-10-18T10:00:00Z" }),
      status({ id: 2, created_at: "2026-10-18T10:02:00Z", creator: { login: "attacker", id: 2, type: "User" } }),
    ], "neonprint-order-system-", "-urora-companys-projects.vercel.app"))
      .toThrow("not from the verified Vercel bot");
  });

  it("rejects failures, malformed responses, and external pagination", async () => {
    await expect(resolveVercelPreview({ env: env(), fetchImpl: async () => ({ ok: false, status: 403 }) })).rejects.toThrow("HTTP 403");
    await expect(resolveVercelPreview({ env: env(), fetchImpl: async () => response({ deployments: [] }) })).rejects.toThrow("was not an array");
    await expect(resolveVercelPreview({
      env: env(),
      fetchImpl: async () => response([], { link: '<https://evil.example/deployments?page=2>; rel="next"' }),
    })).rejects.toThrow("outside the expected API endpoint");
  });

  it("times out when no matching deployment appears", async () => {
    let time = 0;
    await expect(resolveVercelPreview({
      env: env({ VERCEL_PREVIEW_TIMEOUT_MS: "10" }),
      fetchImpl: async () => response([]),
      now: () => time,
      sleep: async (duration) => { time += duration; },
    })).rejects.toThrow("Timed out");
  });

  it("requires a full SHA and GitHub token before networking", async () => {
    const fetchImpl = vi.fn();
    await expect(resolveVercelPreview({ env: env({ GITHUB_TOKEN: "" }), fetchImpl })).rejects.toThrow("GITHUB_TOKEN is missing");
    await expect(resolveVercelPreview({ env: env({ PR_HEAD_SHA: "short" }), fetchImpl })).rejects.toThrow("full 40-character");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("validates hostname and rejects URL credentials, paths, query, port and non-HTTPS", () => {
    expect(validatePreviewUrl(url, "neonprint-order-system-", "-urora-companys-projects.vercel.app")).toBe(url);
    for (const unsafe of [
      url.replace("https:", "http:"),
      "https://attacker.example",
      `${url}.attacker.example`,
      url.replace("https://", "https://user:pass@"),
      `${url}:443`, `${url}/path`, `${url}/?x=1`, `${url}/#fragment`,
    ]) expect(() => validatePreviewUrl(unsafe, "neonprint-order-system-", "-urora-companys-projects.vercel.app")).toThrow();
  });

  it("writes the validated URL only through the GitHub output interface", async () => {
    const appendFile = vi.fn();
    await writeGitHubOutput(env(), "url", url, appendFile);
    expect(appendFile).toHaveBeenCalledWith("fake-output", `url=${url}\n`, "utf8");
    const notCalled = vi.fn();
    await expect(resolveAndWritePreview({ env: env({ PR_HEAD_SHA: "bad" }), fetchImpl: vi.fn(), appendFileImpl: notCalled })).rejects.toThrow();
    expect(notCalled).not.toHaveBeenCalled();
  });
});
