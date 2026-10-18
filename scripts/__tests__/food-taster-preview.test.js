import { describe, expect, it, vi } from "vitest";
import { resolveVercelPreview, validatePreviewConfiguration } from "../resolve-vercel-preview.mjs";
import { validatePreviewBaseURL } from "../../playwright.config.js";

const repository = "uroracompany/neonprint-order-system";
const sha = "19f2a20518e231b6d3faf22f99e3ca468cf41ab5";
const previewOrigin = "https://neonprint-order-system-pr1-abc123-urora-companys-projects.vercel.app";
const stagingOrigin = "https://stagingref.supabase.co";
const productionOrigin = "https://productionref.supabase.co";
const vercelProjectId = "prj_neonprintstaging";
const anonKey = "public-staging-anon-key-012345";

function makeEnv(overrides = {}) {
  return {
    GITHUB_TOKEN: "read-only-token",
    GITHUB_REPOSITORY: repository,
    PR_NUMBER: "1",
    PR_HEAD_SHA: sha,
    FOOD_TASTER_STAGING_SUPABASE_URL: stagingOrigin,
    FOOD_TASTER_STAGING_SUPABASE_ANON_KEY: anonKey,
    FOOD_TASTER_PRODUCTION_SUPABASE_URL: productionOrigin,
    FOOD_TASTER_VERCEL_PROJECT_ID: vercelProjectId,
    FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED: "true",
    ...overrides,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function successFetch({ status = "success", url = previewOrigin, bundle = `${stagingOrigin} ${anonKey}`, projectId = vercelProjectId, includeWrongProject = false } = {}) {
  return vi.fn(async (input, options = {}) => {
    const requestURL = new URL(input);
    if (requestURL.hostname === "api.github.com" && requestURL.pathname.endsWith("/pulls/1")) {
      return json({
        state: "open",
        base: { ref: "main", repo: { full_name: repository } },
        head: { sha, repo: { full_name: repository } },
      });
    }
    if (requestURL.hostname === "api.github.com" && requestURL.pathname.endsWith("/deployments")) {
      const expectedProject = { id: 77, sha, environment: "Preview", payload: projectId ? { projectId } : {}, created_at: "2026-10-17T12:00:00Z" };
      const wrongProject = { id: 78, sha, environment: "Preview", payload: { projectId: "prj_other" }, created_at: "2026-10-17T12:01:00Z" };
      return json(includeWrongProject ? [wrongProject, expectedProject] : [expectedProject]);
    }
    if (requestURL.hostname === "api.github.com" && requestURL.pathname.endsWith("/deployments/77/statuses")) {
      return json([{ state: status, environment_url: url }]);
    }
    if (requestURL.origin === previewOrigin && requestURL.pathname === "/") {
      return new Response('<html><script type="module" src="/assets/app.js"></script></html>', { status: 200 });
    }
    if (requestURL.origin === previewOrigin && requestURL.pathname === "/assets/app.js") {
      return new Response(bundle, { status: 200 });
    }
    throw new Error(`Unexpected network request ${options.method || "GET"} ${requestURL.origin}${requestURL.pathname}`);
  });
}

describe("Food Taster exact Vercel Preview validation", () => {
  it.each([undefined, "false", "TRUE", " true "])("fails before any network call when manual isolation attestation is %s", async (attestation) => {
    const fetchImpl = vi.fn();
    const env = makeEnv();
    if (attestation === undefined) delete env.FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED;
    else env.FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED = attestation;

    await expect(resolveVercelPreview({ env, fetchImpl, maxPolls: 1 }))
      .rejects.toThrow(/Preview isolation has not been manually confirmed/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires staging and production Supabase origins to be distinct canonical HTTPS origins", () => {
    expect(validatePreviewConfiguration(makeEnv()).stagingOrigin).toBe(stagingOrigin);
    expect(() => validatePreviewConfiguration(makeEnv({
      FOOD_TASTER_STAGING_SUPABASE_URL: productionOrigin,
    }))).toThrow(/separate from Production/);
    expect(() => validatePreviewConfiguration(makeEnv({
      FOOD_TASTER_STAGING_SUPABASE_URL: "https://stagingref.supabase.co/path",
    }))).toThrow(/without credentials/);
    expect(() => validatePreviewConfiguration(makeEnv({
      FOOD_TASTER_STAGING_SUPABASE_URL: "https://stagingref.supabase.co:8443",
    }))).toThrow(/standard port/);
    expect(() => validatePreviewConfiguration(makeEnv({
      FOOD_TASTER_STAGING_SUPABASE_ANON_KEY: "short",
    }))).toThrow(/anon key is malformed/);
  });

  it("resolves the successful Vercel deployment for the current open PR SHA and verifies staging assets", async () => {
    const fetchImpl = successFetch();
    const result = await resolveVercelPreview({ env: makeEnv(), fetchImpl, maxPolls: 1 });
    expect(result).toEqual({ previewOrigin, sha, prNumber: 1 });
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes(`/pulls/1`))).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes(`sha=${sha}`))).toBe(true);
  });

  it("selects only the deployment with the exact Vercel project ID", async () => {
    const fetchImpl = successFetch({ includeWrongProject: true });
    const result = await resolveVercelPreview({ env: makeEnv(), fetchImpl, maxPolls: 1 });
    expect(result.previewOrigin).toBe(previewOrigin);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/deployments/77/statuses"))).toBe(true);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/deployments/78/statuses"))).toBe(false);
  });

  it.each([
    ["missing projectId", null],
    ["wrong projectId", "prj_different"],
  ])("rejects deployment metadata with %s without checking a status or visiting Preview", async (_label, projectId) => {
    const fetchImpl = successFetch({ projectId });
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl, maxPolls: 1 }))
      .rejects.toThrow(/metadata is missing or does not match FOOD_TASTER_VERCEL_PROJECT_ID/);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/statuses"))).toBe(false);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).startsWith(previewOrigin))).toBe(false);
  });

  it("fails closed when there is no exact-sha Vercel deployment", async () => {
    const fetchImpl = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/pulls/1")) {
        return json({ state: "open", base: { ref: "main", repo: { full_name: repository } }, head: { sha, repo: { full_name: repository } } });
      }
      if (url.pathname.endsWith("/deployments")) return json([{ id: 77, sha: "0".repeat(40), environment: "Preview" }]);
      throw new Error(`Unexpected request ${url.pathname}`);
    });
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl, maxPolls: 1, sleep: async () => {} }))
      .rejects.toThrow(/No successful Vercel Preview deployment/);
  });

  it("rejects a failed latest deployment and a URL outside this Vercel project", async () => {
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl: successFetch({ status: "failure" }), maxPolls: 1 }))
      .rejects.toThrow(/ended in failure/);
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl: successFetch({ url: "https://neonprint-order-system.vercel.app" }), maxPolls: 1 }))
      .rejects.toThrow(/expected Vercel team/);
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl: successFetch({ url: `${previewOrigin}:8443` }), maxPolls: 1 }))
      .rejects.toThrow(/standard port/);
    expect(validatePreviewBaseURL(previewOrigin).origin).toBe(previewOrigin);
    expect(() => validatePreviewBaseURL(`${previewOrigin}:8443`)).toThrow(/standard port/);
  });

  it("rejects Preview bundles that are production-configured or missing the expected staging client config", async () => {
    await expect(resolveVercelPreview({
      env: makeEnv(), fetchImpl: successFetch({ bundle: `${productionOrigin} ${stagingOrigin} ${anonKey}` }), maxPolls: 1,
    })).rejects.toThrow(/contains the Production Supabase origin/);
    await expect(resolveVercelPreview({
      env: makeEnv(), fetchImpl: successFetch({ bundle: "no Supabase config" }), maxPolls: 1,
    })).rejects.toThrow(/not configured with the expected staging/);
  });

  it("rejects a pull request that changes SHA or leaves main", async () => {
    const fetchImpl = vi.fn(async () => json({
      state: "open",
      base: { ref: "main", repo: { full_name: repository } },
      head: { sha: "0".repeat(40), repo: { full_name: repository } },
    }));
    await expect(resolveVercelPreview({ env: makeEnv(), fetchImpl, maxPolls: 1 })).rejects.toThrow(/match the checked SHA/);
  });
});
