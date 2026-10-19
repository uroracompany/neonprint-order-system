import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodTasterCheck, finalizeFoodTaster, prepareFoodTaster } from "../food-taster-github.mjs";

const repository = "uroracompany/neonprint-order-system";
const fork = "contributor/neonprint-order-system";
const sha = "a".repeat(40);
const changedSha = "b".repeat(40);
const appId = 12345;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryDirectories = [];
const workflow = { id: 17, name: "Food Taster", state: "active" };
const readText = async (path) => (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const run = (overrides = {}) => ({
  id: 42, workflow_id: workflow.id, event: "pull_request", head_sha: sha,
  repository: { full_name: repository }, head_repository: { full_name: fork },
  // The Actions workflow-run API returns reduced nested repo objects here;
  // canonical full_name values are verified from GET /pulls/{number} instead.
  pull_requests: [{ number: 9, base: { ref: "main", repo: { name: "neonprint-order-system" } }, head: { sha, repo: { name: "neonprint-order-system" } } }],
  ...overrides,
});
const pull = (headSha = sha, overrides = {}) => ({
  number: 9, state: "open", base: { ref: "main", repo: { full_name: repository } },
  head: { sha: headSha, repo: { full_name: fork } }, ...overrides,
});
const check = (overrides = {}) => ({ id: 77, name: "Food Taster gate", head_sha: sha, status: "in_progress", app: { id: appId }, ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const baseEnv = (overrides = {}) => ({
  GITHUB_TOKEN: "read-token", APP_TOKEN: "app-token", GITHUB_REPOSITORY: repository,
  GITHUB_OUTPUT: "unused", FOOD_TASTER_GITHUB_APP_ID: String(appId),
  TRUSTED_WORKFLOW_RUN_ID: "81", CHECK_RUN_ID: "77", PR_NUMBER: "9",
  PR_HEAD_SHA: sha, PR_HEAD_REPO: fork, QUALITY_RESULT: "success", PREVIEW_RESULT: "success", ...overrides,
});
const event = { workflow_run: { id: 42 } };

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function apiFetch({ pullResponses = [pull(), pull()], runResponse = run(), checkResponse = check(), checkCreateResponse = check(), appOverride = appId } = {}) {
  let pullIndex = 0;
  return vi.fn(async (rawUrl, options = {}) => {
    const url = new URL(rawUrl);
    expect(url.hostname).toBe("api.github.com");
    expect(options.redirect).toBe("error");
    const token = options.headers.Authorization;
    if (url.pathname.endsWith("/actions/workflows/food-taster.yml")) {
      expect(token).toBe("Bearer read-token");
      return response(workflow);
    }
    if (url.pathname.endsWith("/actions/runs/42")) {
      expect(token).toBe("Bearer read-token");
      return response(runResponse);
    }
    if (url.pathname.endsWith("/pulls/9")) {
      expect(token).toBe("Bearer read-token");
      const item = pullResponses[Math.min(pullIndex, pullResponses.length - 1)];
      pullIndex += 1;
      return response(item);
    }
    if (url.pathname.endsWith("/check-runs") && options.method === "POST") {
      expect(token).toBe("Bearer app-token");
      expect(options.headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
      return response({ ...checkCreateResponse, app: { id: appOverride } }, 201);
    }
    if (url.pathname.endsWith("/check-runs/77") && !options.method) {
      expect(token).toBe("Bearer app-token");
      return response(checkResponse);
    }
    if (url.pathname.endsWith("/check-runs/77") && options.method === "PATCH") {
      expect(token).toBe("Bearer app-token");
      return response({ ...checkResponse, ...JSON.parse(options.body) });
    }
    throw new Error(`Unexpected GitHub endpoint: ${url.pathname}`);
  });
}

describe("Food Taster GitHub App Check Run controller", () => {
  it("validates workflow, run, PR association and current SHA without publishing a status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "food-taster-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "github-output");
    const fetchImpl = apiFetch();
    await expect(prepareFoodTaster({ env: baseEnv({ GITHUB_OUTPUT: output }), fetchImpl, event }))
      .resolves.toEqual({ number: 9, headSha: sha, headRepo: fork, runId: 42 });
    const text = await readFile(output, "utf8");
    expect(text).toContain(`head_sha=${sha}`);
    expect(text).toContain("run_id=42");
    expect(fetchImpl.mock.calls.some(([url]) => new URL(url).pathname.includes("/statuses/"))).toBe(false);
  });

  it.each([
    ["non-main base", { base: { ref: "release", repo: { name: "neonprint-order-system" } } }],
    ["different associated SHA", { head: { sha: changedSha, repo: { name: "neonprint-order-system" } } }],
  ])("rejects workflow_run metadata with %s", async (_label, associationOverride) => {
    const directory = await mkdtemp(join(tmpdir(), "food-taster-"));
    temporaryDirectories.push(directory);
    const fetchImpl = apiFetch({ runResponse: run({
      pull_requests: [{ number: 9, base: { ref: "main", repo: { name: "neonprint-order-system" } }, head: { sha, repo: { name: "neonprint-order-system" } }, ...associationOverride }],
    }) });
    await expect(prepareFoodTaster({ env: baseEnv({ GITHUB_OUTPUT: join(directory, "github-output") }), fetchImpl, event }))
      .rejects.toThrow();
    expect(fetchImpl.mock.calls.some(([url]) => new URL(url).pathname.endsWith("/pulls/9"))).toBe(false);
  });

  it.each([
    ["different base repository", { base: { ref: "main", repo: { full_name: "another/repository" } } }],
    ["different head repository", { head: { sha, repo: { full_name: "another/repository" } } }],
  ])("rejects canonical PR data with %s", async (_label, pullOverride) => {
    const directory = await mkdtemp(join(tmpdir(), "food-taster-"));
    temporaryDirectories.push(directory);
    await expect(prepareFoodTaster({
      env: baseEnv({ GITHUB_OUTPUT: join(directory, "github-output") }),
      fetchImpl: apiFetch({ pullResponses: [pull(pullOverride.head?.sha || sha, pullOverride)] }),
      event,
    })).rejects.toThrow();
  });

  it("creates the exact App-owned Check Run on the current SHA", async () => {
    const directory = await mkdtemp(join(tmpdir(), "food-taster-"));
    temporaryDirectories.push(directory);
    const output = join(directory, "github-output");
    const fetchImpl = apiFetch();
    await expect(createFoodTasterCheck({ env: baseEnv({ GITHUB_OUTPUT: output }), fetchImpl }))
      .resolves.toMatchObject({ checkRunId: 77, headSha: sha, appId });
    const createCall = fetchImpl.mock.calls.find(([, options]) => options.method === "POST");
    expect(JSON.parse(createCall[1].body)).toMatchObject({ name: "Food Taster gate", head_sha: sha, status: "in_progress" });
    expect(await readFile(output, "utf8")).toContain("check_run_id=77");
  });

  it.each([
    ["another App", { appOverride: appId + 1 }],
    ["another SHA", { checkCreateResponse: check({ head_sha: changedSha }) }],
    ["wrong check name", { checkCreateResponse: check({ name: "Other gate" }) }],
  ])("rejects a created Check Run from %s", async (_label, overrides) => {
    const { appOverride, ...fetchOverrides } = overrides;
    await expect(createFoodTasterCheck({ env: baseEnv(), fetchImpl: apiFetch({ ...fetchOverrides, appOverride }) })).rejects.toThrow();
  });

  it("publishes success only for the dedicated App and current PR SHA after quality and Preview pass", async () => {
    const fetchImpl = apiFetch();
    await expect(finalizeFoodTaster({ env: baseEnv(), fetchImpl }))
      .resolves.toMatchObject({ conclusion: "success", checkRunId: 77, appId, sha });
    const patchCall = fetchImpl.mock.calls.find(([, options]) => options.method === "PATCH");
    expect(JSON.parse(patchCall[1].body)).toMatchObject({
      status: "completed",
      conclusion: "success",
      output: { summary: "Trusted quality checks and the Preview smoke passed for the current PR head." },
    });
  });

  it.each([
    ["another App", { checkResponse: check({ app: { id: appId + 1 } }) }],
    ["another SHA", { checkResponse: check({ head_sha: changedSha }) }],
    ["wrong check name", { checkResponse: check({ name: "Other gate" }) }],
    ["already completed check", { checkResponse: check({ status: "completed" }) }],
    ["changed PR", { pullResponses: [pull(changedSha)] }],
  ])("does not approve a spoofed or stale %s", async (_label, fetchOptions) => {
    const fetchImpl = apiFetch(fetchOptions);
    await expect(finalizeFoodTaster({ env: baseEnv(), fetchImpl })).rejects.toThrow();
    expect(fetchImpl.mock.calls.some(([, options]) => options.method === "PATCH")).toBe(false);
  });

  it.each([
    [{ QUALITY_RESULT: "failure" }, "quality=failure; preview=success"],
    [{ QUALITY_RESULT: "cancelled" }, "quality=cancelled; preview=success"],
    [{ QUALITY_RESULT: "skipped" }, "quality=skipped; preview=success"],
    [{ QUALITY_RESULT: undefined }, "quality=missing; preview=success"],
    [{ PREVIEW_RESULT: "failure" }, "quality=success; preview=failure"],
    [{ PREVIEW_RESULT: "cancelled" }, "quality=success; preview=cancelled"],
    [{ PREVIEW_RESULT: "skipped" }, "quality=success; preview=skipped"],
    [{ PREVIEW_RESULT: undefined }, "quality=success; preview=missing"],
  ])("completes a failed or missing result with failure: %s", async (overrides, expectedSummary) => {
    const fetchImpl = apiFetch();
    await expect(finalizeFoodTaster({ env: baseEnv(overrides), fetchImpl })).rejects.toThrow(`Food Taster blocked: ${expectedSummary}.`);
    const patchCall = fetchImpl.mock.calls.find(([, options]) => options.method === "PATCH");
    expect(JSON.parse(patchCall[1].body)).toMatchObject({
      status: "completed",
      conclusion: "failure",
      output: { summary: `Food Taster blocked: ${expectedSummary}.` },
    });
  });

  it("keeps PR-controlled execution unprivileged and the trusted gate code-only", async () => {
    const pullWorkflow = await readText(resolve(projectRoot, ".github", "workflows", "food-taster.yml"));
    const trustedWorkflow = await readText(resolve(projectRoot, ".github", "workflows", "food-taster-trusted.yml"));
    expect(pullWorkflow).toContain("pull_request:");
    expect(pullWorkflow).not.toMatch(/secrets\.|food-taster-preview|checks:\s*write|statuses:\s*write|workflow_run/);
    expect(trustedWorkflow).toContain("workflow_run:");
    expect(trustedWorkflow).not.toContain("pull_request_target");
    expect(trustedWorkflow).not.toContain("actions/download-artifact");
    expect(trustedWorkflow.match(/ref: \$\{\{ github\.sha \}\}/g)?.length).toBeGreaterThan(0);
    const qualityJob = trustedWorkflow.match(/\n  quality:\n([\s\S]*?)\n  publish-food-taster-gate:/)?.[1];
    expect(qualityJob).toBeTruthy();
    expect(qualityJob).not.toMatch(/secrets\.|environment:|checks:\s*write|statuses:\s*write|cache: npm/);
    expect(qualityJob).toContain("repository: ${{ needs.validate-pull-request.outputs.head_repo }}");
    expect(qualityJob).toContain("ref: ${{ needs.validate-pull-request.outputs.head_sha }}");
    expect(qualityJob).toContain("persist-credentials: false");
    expect(qualityJob).toContain("permissions:\n      contents: read\n    steps:");
    expect(qualityJob).toContain("run: npm run security:check");
    expect(qualityJob).toContain("run: npm run lint");
    expect(qualityJob).toContain("run: npm run test -- --maxWorkers=2");
    expect(qualityJob).toContain("run: npm run build");
    expect(qualityJob).toContain("https://food-taster.invalid");
    expect(qualityJob).toContain("food-taster-placeholder");
    const previewJob = trustedWorkflow.match(/\n  preview-smoke:\n([\s\S]*?)\n  publish-food-taster-gate:/)?.[1];
    expect(previewJob).toBeTruthy();
    expect(previewJob).toMatch(/permissions:\n      contents: read\n      deployments: read\n    steps:/);
    expect(previewJob).not.toMatch(/^    environment:|^      id-token:/m);
    expect(previewJob).not.toMatch(/VERCEL_(?:TOKEN|PROJECT_ID|TEAM_ID)|SUPABASE_|FOOD_TASTER_(?:STAGING|PRODUCTION|PREVIEW)/);

    const resolverStep = previewJob.match(/- name: Resolve exact READY Vercel Preview\n([\s\S]*?)(?=\n      - name:)/)?.[1];
    const playwrightStep = previewJob.match(/- name: Run trusted read-only browser smoke\n([\s\S]*?)(?=\n  publish-food-taster-gate:|$)/)?.[1];
    expect(resolverStep).toBeTruthy();
    expect(resolverStep).toContain("GITHUB_TOKEN: ${{ github.token }}");
    expect(playwrightStep).toBeTruthy();
    expect(playwrightStep).toContain("PLAYWRIGHT_BASE_URL: ${{ steps.preview.outputs.url }}");
    expect(playwrightStep).not.toMatch(/GITHUB_TOKEN|VERCEL_TOKEN|SUPABASE|id-token|OIDC/);
    expect((previewJob.match(/GITHUB_TOKEN:/g) || [])).toHaveLength(1);
    const finalizer = trustedWorkflow.match(/\n  publish-food-taster-gate:\n([\s\S]*)$/)?.[1];
    expect(finalizer).toBeTruthy();
    expect(finalizer).toContain("- quality");
    expect(finalizer).toContain("- preview-smoke");
    expect(finalizer).toContain("QUALITY_RESULT: ${{ needs.quality.result }}");
    expect(finalizer).toContain("PREVIEW_RESULT: ${{ needs.preview-smoke.result }}");
    expect(trustedWorkflow).not.toMatch(/statuses:\s*write/);
  });
});
