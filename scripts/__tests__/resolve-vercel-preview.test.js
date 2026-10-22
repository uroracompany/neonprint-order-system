import { describe, expect, it, vi } from "vitest";
import {
  parseStagingRows,
  resolveAndWritePreview,
  resolveVercelPreview,
  selectLatestStagingStatus,
  selectStagingComment,
  writeGitHubOutput,
} from "../resolve-vercel-preview.mjs";

const sha = "682acf66b5dbbe21530a4017280aead63e3d6d6b";
const url = "https://neonprint-order-system-food-taster.vercel.app";
const deploymentId = "25NCDmQu2UU8LCp5i7pFLZaKvcKm";
const inspector = `https://vercel.com/urora-companys-projects/neonprint-order-system-food-taster/${deploymentId}`;
const stagingContext = "Vercel – neonprint-order-system-food-taster";
const env = (extra = {}) => ({
  GITHUB_TOKEN: "read-only-token",
  GITHUB_REPOSITORY: "uroracompany/neonprint-order-system",
  PR_NUMBER: "9",
  PR_HEAD_SHA: sha,
  PR_HEAD_REPO: "uroracompany/neonprint-order-system",
  VERCEL_PREVIEW_TIMEOUT_MS: "30000",
  ...extra,
});
const response = (body, headers = {}) => ({ ok: true, status: 200, json: async () => body, headers: new Headers(headers) });
const pr = () => ({ state: "open", base: { ref: "main", repo: { full_name: "uroracompany/neonprint-order-system" } }, head: { sha, ref: "codex/food-taster-preview-runner", repo: { full_name: "uroracompany/neonprint-order-system" } } });
const status = (overrides = {}) => ({
  id: 56693055594,
  context: stagingContext,
  creator: { login: "vercel[bot]", id: 35613825, type: "Bot" },
  state: "success",
  target_url: inspector,
  created_at: "2026-10-19T13:44:21Z",
  updated_at: "2026-10-19T13:44:21Z",
  ...overrides,
});
const comment = (overrides = {}) => ({
  id: 6268956221,
  user: { login: "vercel[bot]", id: 35613825, type: "Bot" },
  body: `| Project | Deployment | Actions | Updated |\n| :--- | :----- | :------ | :------ |\n| [neonprint-order-system-food-taster](https://vercel.com/urora-companys-projects/neonprint-order-system-food-taster) | ![Ready](https://vercel.com/static/status/ready.svg) [Ready](${inspector}) | [Preview](${url}) | updated |`,
  ...overrides,
});

function apiFetch({ pull = pr(), statuses = [status()], comments = [comment()], pagination } = {}) {
  return vi.fn(async (rawUrl) => {
    const request = new URL(rawUrl);
    if (request.pathname.endsWith("/pulls/9")) return response(pull);
    if (request.pathname.endsWith(`/commits/${sha}/statuses`)) return response(statuses, pagination?.statuses);
    if (request.pathname.endsWith("/issues/9/comments")) return response(comments, pagination?.comments);
    throw new Error(`Unexpected API request ${request.pathname}`);
  });
}

describe("trusted isolated Vercel Preview resolver", () => {
  it("correlates exact PR head, isolated status and Vercel Ready row, then revalidates", async () => {
    const fetchImpl = apiFetch();
    await expect(resolveVercelPreview({ env: env(), fetchImpl })).resolves.toEqual({ url, deploymentId, statusId: 56693055594, headRef: "codex/food-taster-preview-runner" });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    for (const [request, options] of fetchImpl.mock.calls) {
      expect(new URL(request).origin).toBe("https://api.github.com");
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
      expect(options.headers.Authorization).toBe("Bearer read-only-token");
    }
  });

  it("accepts Vercel's shortened staging alias only with the exact Vercel status and Ready deployment row", async () => {
    const shortenedUrl = "https://neonprint-order-system-food-git-ca8a4d-urora-companys-projects.vercel.app";
    const comments = [comment({ body: comment().body.replace(url, shortenedUrl) })];
    await expect(resolveVercelPreview({ env: env(), fetchImpl: apiFetch({ comments }) })).resolves.toMatchObject({
      url: shortenedUrl,
      deploymentId,
      statusId: 56693055594,
      headRef: "codex/food-taster-preview-runner",
    });
  });

  it("selects only the exact isolated Vercel context, ignoring the production project", () => {
    const production = status({ id: 999, context: "Vercel – neonprint-order-system", target_url: "https://vercel.com/urora-companys-projects/neonprint-order-system/prod1234567890" });
    expect(selectLatestStagingStatus([production, status()])).toMatchObject({ state: "success", deploymentId });
  });

  it.each(["pending", "failure", "error", "cancelled", "unknown"])("does not accept latest state %s", (state) => {
    if (state === "cancelled" || state === "unknown") {
      expect(() => selectLatestStagingStatus([status({ state })])).toThrow();
    } else expect(selectLatestStagingStatus([status({ state })])?.state).toBe(state);
  });

  it("does not fall back to an older success when the latest staging status failed", () => {
    const older = status({ id: 10, updated_at: "2026-10-19T13:00:00Z" });
    const latest = status({ id: 11, state: "failure", updated_at: "2026-10-19T14:00:00Z" });
    expect(selectLatestStagingStatus([older, latest]).state).toBe("failure");
  });

  it.each([
    ["missing actor", status({ creator: undefined })],
    ["human actor", status({ creator: { login: "owner", id: 1, type: "User" } })],
    ["wrong bot ID", status({ creator: { login: "vercel[bot]", id: 1, type: "Bot" } })],
    ["wrong actor type", status({ creator: { login: "vercel[bot]", id: 35613825, type: "User" } })],
  ])("rejects Vercel-context statuses with %s", (_label, candidate) => {
    expect(() => selectLatestStagingStatus([candidate])).toThrow("not authored by the verified Vercel bot");
  });

  it("rejects ambiguous latest status records", () => {
    expect(() => selectLatestStagingStatus([
      status({ id: 10, state: "success" }),
      status({ id: 11, state: "failure" }),
    ])).toThrow("ambiguous");
  });

  it("parses only a well-formed staging deployment row and exact deployment ID", () => {
    expect(parseStagingRows(comment().body)).toEqual([{ state: "Ready", inspectorUrl: inspector, previewUrl: url }]);
    expect(selectStagingComment([comment()], deploymentId, "codex/food-taster-preview-runner")).toMatchObject({ previewUrl: url, commentId: 6268956221 });
    expect(() => selectStagingComment([comment()], "anotherdeployment123", "codex/food-taster-preview-runner")).toThrow("does not match");
    expect(() => selectStagingComment([comment()], deploymentId, "feature/payment-form-refresh")).toThrow("does not match");
  });

  it.each([
    ["untrusted author", comment({ user: { login: "vercel[bot]", id: 1, type: "Bot" } })],
    ["human author", comment({ user: { login: "owner", id: 1, type: "User" } })],
    ["mismatched project", comment({ body: comment().body.replace("neonprint-order-system-food-taster", "neonprint-order-system") })],
  ])("ignores %s as deployment evidence", (_label, candidate) => {
    expect(selectStagingComment([candidate], deploymentId, "codex/food-taster-preview-runner")).toBeNull();
  });

  it.each([
    ["missing Ready link", comment({ body: comment().body.replace(`[Ready](${inspector})`, "[Building](https://vercel.com/urora-companys-projects/neonprint-order-system-food-taster/anotherdeployment123") })],
    ["production project URL", comment({ body: comment().body.replace(url, "https://neonprint-order-system.vercel.app") })],
  ])("rejects %s as staging deployment evidence", (_label, candidate) => {
    expect(() => selectStagingComment([candidate], deploymentId, "codex/food-taster-preview-runner")).toThrow();
  });

  it("fails closed when PR changed, closed, targets other base, or comes from unexpected repo", async () => {
    for (const pull of [
      { ...pr(), state: "closed" },
      { ...pr(), base: { ...pr().base, ref: "develop" } },
      { ...pr(), head: { ...pr().head, sha: "f".repeat(40) } },
      { ...pr(), head: { ...pr().head, repo: { full_name: "attacker/fork" } } },
      { ...pr(), head: { ...pr().head, ref: "feature/unexpected-branch" } },
    ]) await expect(resolveVercelPreview({ env: env({ EXPECTED_PR_HEAD_REF: "codex/food-taster-preview-runner" }), fetchImpl: apiFetch({ pull }) })).rejects.toThrow("Pull request");
  });

  it("rejects an untrusted or wrong-project inspector URL", () => {
    for (const candidate of [
      "https://evil.example/urora-companys-projects/neonprint-order-system-food-taster/deployment123456",
      "https://vercel.com/urora-companys-projects/neonprint-order-system/deployment123456",
      "https://vercel.com/urora-companys-projects/neonprint-order-system-food-taster/deployment123456?next=x",
    ]) expect(() => selectLatestStagingStatus([status({ target_url: candidate })])).toThrow();
  });

  it("rejects external or path-changing pagination", async () => {
    const fetchImpl = apiFetch({ pagination: { statuses: { link: '<https://evil.example/statuses?page=2>; rel="next"' } } });
    await expect(resolveVercelPreview({ env: env(), fetchImpl })).rejects.toThrow("outside the expected API endpoint");
  });

  it("requires validated environment and full SHA before network access", async () => {
    const fetchImpl = vi.fn();
    await expect(resolveVercelPreview({ env: env({ GITHUB_TOKEN: "" }), fetchImpl })).rejects.toThrow("GITHUB_TOKEN is missing");
    await expect(resolveVercelPreview({ env: env({ PR_HEAD_SHA: "short" }), fetchImpl })).rejects.toThrow("full 40-character");
    await expect(resolveVercelPreview({ env: env({ PR_NUMBER: "0" }), fetchImpl })).rejects.toThrow("positive pull request number");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("times out if the isolated Vercel status remains pending", async () => {
    let time = 0;
    const fetchImpl = apiFetch({ statuses: [status({ state: "pending" })], comments: [] });
    await expect(resolveVercelPreview({ env: env({ VERCEL_PREVIEW_TIMEOUT_MS: "10" }), fetchImpl, now: () => time, sleep: async (ms) => { time += ms; } })).rejects.toThrow("Timed out");
  });

  it("writes only validated outputs and rejects newline injection", async () => {
    const appendFile = vi.fn();
    const outputEnv = env({ GITHUB_OUTPUT: "fake-output" });
    await writeGitHubOutput(outputEnv, "url", url, appendFile);
    expect(appendFile).toHaveBeenCalledWith("fake-output", `url=${url}\n`, "utf8");
    await expect(writeGitHubOutput(outputEnv, "url", "x\nattacker", appendFile)).rejects.toThrow("newlines");
    const appendUnused = vi.fn();
    await expect(resolveAndWritePreview({ env: env({ PR_HEAD_SHA: "bad" }), fetchImpl: vi.fn(), appendFileImpl: appendUnused })).rejects.toThrow();
    expect(appendUnused).not.toHaveBeenCalled();
  });
});
