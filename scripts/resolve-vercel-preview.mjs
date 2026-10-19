import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isAllowedPreviewUrl } from "./food-taster-preview-origin.mjs";

const API_BASE = "https://api.github.com";
const VERCEL_BOT = Object.freeze({ login: "vercel[bot]", id: "35613825", type: "Bot" });
const STAGING_CONTEXT = "Vercel – neonprint-order-system-food-taster";
const STAGING_PROJECT = "neonprint-order-system-food-taster";
const VERCEL_TEAM = "urora-companys-projects";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 15 * 1000;
const MAX_PAGES = 50;

const required = (env, name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
};

const trustedActor = (actor) => actor?.type === VERCEL_BOT.type
  && actor?.login === VERCEL_BOT.login
  && String(actor?.id) === VERCEL_BOT.id;

function validateConfig(env) {
  const token = required(env, "GITHUB_TOKEN");
  const repository = required(env, "GITHUB_REPOSITORY").split("/");
  if (repository.length !== 2 || repository.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new Error("GITHUB_REPOSITORY must be owner/repository.");
  }
  const sha = required(env, "PR_HEAD_SHA").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("PR_HEAD_SHA must be a full 40-character commit SHA.");
  const prNumber = required(env, "PR_NUMBER");
  if (!/^[1-9][0-9]{0,8}$/.test(prNumber)) throw new Error("PR_NUMBER must be a positive pull request number.");
  const headRepo = env.PR_HEAD_REPO?.trim();
  if (headRepo && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(headRepo)) throw new Error("PR_HEAD_REPO must be owner/repository.");
  const expectedHeadRef = env.EXPECTED_PR_HEAD_REF?.trim();
  if (expectedHeadRef && (expectedHeadRef.length > 200 || /[\r\n]/.test(expectedHeadRef))) throw new Error("EXPECTED_PR_HEAD_REF is invalid.");
  return { token, owner: repository[0], repo: repository[1], sha, prNumber, headRepo, expectedHeadRef };
}

function validatePagination(linkHeader, currentUrl, expectedPath) {
  if (!linkHeader) return null;
  const links = linkHeader.split(",").map((part) => {
    const match = part.trim().match(/^<([^>]+)>\s*;(.*)$/);
    if (!match) throw new Error("GitHub API returned malformed pagination metadata.");
    const rel = /(?:^|;)\s*rel="?([^";]+)"?/i.exec(`;${match[2]}`)?.[1]?.split(/\s+/) || [];
    return { href: match[1], rel };
  });
  const next = links.filter((link) => link.rel.includes("next"));
  if (next.length > 1) throw new Error("GitHub API returned ambiguous pagination metadata.");
  if (!next.length) return null;
  const url = new URL(next[0].href, currentUrl);
  const current = new URL(currentUrl);
  if (url.protocol !== "https:" || url.origin !== API_BASE || url.username || url.password
      || url.pathname !== expectedPath || url.hash || url.searchParams.get("per_page") !== "100") {
    throw new Error("GitHub API pagination points outside the expected API endpoint.");
  }
  for (const key of ["sha", "state"]) {
    if (current.searchParams.has(key) && url.searchParams.get(key) !== current.searchParams.get(key)) {
      throw new Error("GitHub API pagination changed the query scope.");
    }
  }
  return url.href;
}

async function getJson(url, { token, fetchImpl, deadline, now, label }) {
  const remaining = deadline - now();
  if (remaining <= 0) throw new Error("Timed out waiting for isolated staging Preview metadata.");
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    redirect: "error",
    signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))),
  });
  if (!response.ok) throw new Error(`GitHub ${label} API returned HTTP ${response.status}.`);
  try { return { body: await response.json(), link: response.headers?.get?.("link") || response.headers?.get?.("Link") || null }; }
  catch { throw new Error(`GitHub ${label} API returned invalid JSON.`); }
}

async function getPaginatedArray({ initialUrl, expectedPath, token, fetchImpl, deadline, now, label }) {
  const items = [];
  const seen = new Set();
  let next = initialUrl;
  while (next) {
    if (seen.has(next) || seen.size >= MAX_PAGES) throw new Error("GitHub API pagination is cyclic or exceeds the page limit.");
    seen.add(next);
    const { body, link } = await getJson(next, { token, fetchImpl, deadline, now, label });
    if (!Array.isArray(body)) throw new Error(`GitHub ${label} API response was not an array.`);
    items.push(...body);
    next = validatePagination(link, next, expectedPath);
  }
  return items;
}

function apiUrl(path, query = {}) {
  const url = new URL(`${API_BASE}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url.href;
}

async function getCurrentPullRequest(config, { token, fetchImpl, deadline, now }) {
  const path = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/pulls/${config.prNumber}`;
  const { body: pr } = await getJson(apiUrl(path), { token, fetchImpl, deadline, now, label: "pull request" });
  const fullRepo = `${config.owner}/${config.repo}`.toLowerCase();
  if (pr?.state !== "open" || pr?.base?.ref !== "main" || pr?.base?.repo?.full_name?.toLowerCase() !== fullRepo
      || pr?.head?.sha?.toLowerCase() !== config.sha || typeof pr?.head?.repo?.full_name !== "string"
      || typeof pr?.head?.ref !== "string" || !pr.head.ref || /[\r\n]/.test(pr.head.ref)
      || (config.headRepo && pr.head.repo.full_name.toLowerCase() !== config.headRepo.toLowerCase())
      || (config.expectedHeadRef && pr.head.ref !== config.expectedHeadRef)) {
    throw new Error("Pull request is closed, targets another base, or no longer matches the validated head SHA/repository.");
  }
  return { headRepo: pr.head.repo.full_name, headRef: pr.head.ref, sha: pr.head.sha.toLowerCase() };
}

function validateInspectorUrl(rawUrl) {
  if (typeof rawUrl !== "string" || /[\\\s]/.test(rawUrl)) throw new Error("Vercel staging status has an invalid inspector URL.");
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Vercel staging status has an invalid inspector URL."); }
  const parts = url.pathname.split("/").filter(Boolean);
  const deploymentId = parts[2];
  if (url.protocol !== "https:" || url.hostname !== "vercel.com" || url.username || url.password || url.port
      || url.search || url.hash || parts.length !== 3 || parts[0] !== VERCEL_TEAM || parts[1] !== STAGING_PROJECT
      || !/^[A-Za-z0-9_-]{10,80}$/.test(deploymentId || "")) {
    throw new Error("Vercel status does not point to the verified isolated staging project's deployment.");
  }
  return deploymentId;
}

const parseTimestamp = (item) => {
  const timestamp = Date.parse(item?.updated_at || item?.created_at || "");
  if (!Number.isFinite(timestamp) || !Number.isSafeInteger(Number(item?.id))) throw new Error("GitHub returned malformed Vercel commit status metadata.");
  return timestamp;
};

export function selectLatestStagingStatus(statuses) {
  if (!Array.isArray(statuses)) throw new Error("GitHub commit status response was not an array.");
  const exact = statuses.filter((item) => item?.context === STAGING_CONTEXT);
  if (!exact.length) return null;
  const sorted = [...exact].sort((a, b) => parseTimestamp(b) - parseTimestamp(a) || Number(b.id) - Number(a.id));
  const newest = sorted[0];
  const sameTime = sorted.filter((item) => parseTimestamp(item) === parseTimestamp(newest));
  if (sameTime.length > 1 && sameTime.some((item) => item.state !== newest.state || item.target_url !== newest.target_url)) {
    throw new Error("Conflicting latest Vercel staging statuses are ambiguous.");
  }
  if (!newest.target_url) throw new Error("Latest Vercel staging status has no deployment target URL.");
  const deploymentId = validateInspectorUrl(newest.target_url);
  if (!["pending", "success", "error", "failure"].includes(newest.state)) throw new Error("Latest Vercel staging status has an unknown state.");
  return { state: newest.state, deploymentId, targetUrl: newest.target_url, statusId: Number(newest.id) };
}

function extractMarkdownLink(cell, label) {
  // Vercel's table decorates the Ready link with an adjacent `![Ready](icon)`.
  // Ignore image syntax so its alt text cannot make the actual link ambiguous.
  const withoutImages = cell.replace(/!\[[^\]]*\]\(https:\/\/[^\s)]+\)/g, "");
  const matches = [...withoutImages.matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)];
  const matching = matches.filter((match) => match[1] === label);
  return matching.length === 1 ? matching[0][2] : null;
}

export function parseStagingRows(body) {
  if (typeof body !== "string") return [];
  const rows = [];
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    if (cells.length < 4 || !cells[0].includes(`[${STAGING_PROJECT}]`)) continue;
    const projectLinks = [...cells[0].matchAll(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g)];
    const projectLink = projectLinks.filter((item) => item[1] === STAGING_PROJECT);
    const readyUrl = extractMarkdownLink(cells[1], "Ready");
    const previewUrl = extractMarkdownLink(cells[2], "Preview");
    if (projectLink.length !== 1 || !readyUrl || !previewUrl) throw new Error("Vercel staging comment row is malformed or incomplete.");
    const projectUrl = new URL(projectLink[0][2]);
    if (projectUrl.protocol !== "https:" || projectUrl.hostname !== "vercel.com" || projectUrl.username || projectUrl.password
        || projectUrl.port || projectUrl.search || projectUrl.hash
        || projectUrl.pathname !== `/${VERCEL_TEAM}/${STAGING_PROJECT}`) {
      throw new Error("Vercel comment links to an unexpected staging project.");
    }
    rows.push({ state: "Ready", inspectorUrl: readyUrl, previewUrl });
  }
  return rows;
}

export function selectStagingComment(comments, deploymentId, headRef) {
  if (!Array.isArray(comments)) throw new Error("GitHub pull request comments response was not an array.");
  const botComments = comments.filter((comment) => trustedActor(comment?.user));
  const projectRows = [];
  for (const comment of botComments) {
    const rows = parseStagingRows(comment.body);
    if (rows.length > 1) throw new Error("Vercel comment contains multiple isolated staging deployment rows.");
    for (const row of rows) {
      const rowId = validateInspectorUrl(row.inspectorUrl);
      projectRows.push({ ...row, deploymentId: rowId, commentId: Number(comment.id) });
    }
  }
  if (projectRows.length > 1) throw new Error("Multiple Vercel comments claim isolated staging deployments for this PR.");
  if (!projectRows.length) return null;
  const [row] = projectRows;
  if (row.deploymentId !== deploymentId) throw new Error("Latest Vercel staging comment does not match the exact-SHA deployment status.");
  if (row.state !== "Ready") throw new Error("Isolated staging deployment is not Ready.");
  if (!isAllowedPreviewUrl(row.previewUrl, headRef)) throw new Error("Vercel staging Preview URL does not match the exact PR branch alias.");
  return row;
}

async function readSnapshot(config, deps) {
  const { token, owner, repo, sha, prNumber } = config;
  const pr = await getCurrentPullRequest(config, deps);
  const statusPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}/statuses`;
  const commentsPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${prNumber}/comments`;
  const [statuses, comments] = await Promise.all([
    getPaginatedArray({ initialUrl: apiUrl(statusPath, { per_page: "100" }), expectedPath: statusPath, token, ...deps, label: "commit statuses" }),
    getPaginatedArray({ initialUrl: apiUrl(commentsPath, { per_page: "100" }), expectedPath: commentsPath, token, ...deps, label: "pull request comments" }),
  ]);
  const status = selectLatestStagingStatus(statuses);
  if (!status) return { pr, status: null, deployment: null };
  if (status.state === "pending") return { pr, status, deployment: null };
  if (status.state !== "success") throw new Error(`Isolated Vercel staging Preview ended in ${status.state}.`);
  const deployment = selectStagingComment(comments, status.deploymentId, pr.headRef);
  return { pr, status, deployment };
}

export async function writeGitHubOutput(env, key, value, appendFileImpl) {
  if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
  const appendFile = appendFileImpl || (await import("node:fs/promises")).appendFile;
  if (/[\r\n]/.test(String(value))) throw new Error("GitHub output values cannot contain newlines.");
  await appendFile(env.GITHUB_OUTPUT, `${key}=${value}\n`, "utf8");
}

export async function resolveVercelPreview({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const config = validateConfig(env);
  const timeoutMs = Number(env.VERCEL_PREVIEW_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("VERCEL_PREVIEW_TIMEOUT_MS must be a non-negative number.");
  const deadline = now() + timeoutMs;
  const deps = { token: config.token, fetchImpl, deadline, now };
  while (true) {
    const snapshot = await readSnapshot(config, deps);
    if (snapshot.status?.state === "success" && snapshot.deployment) {
      const finalSnapshot = await readSnapshot(config, deps);
      if (finalSnapshot.status?.state === "success" && finalSnapshot.pr.headRef === snapshot.pr.headRef
          && finalSnapshot.pr.headRepo.toLowerCase() === snapshot.pr.headRepo.toLowerCase()
          && finalSnapshot.status.statusId === snapshot.status.statusId
          && finalSnapshot.status.deploymentId === snapshot.status.deploymentId
          && finalSnapshot.deployment?.commentId === snapshot.deployment.commentId
          && finalSnapshot.deployment?.previewUrl === snapshot.deployment.previewUrl) {
        return { url: finalSnapshot.deployment.previewUrl, deploymentId: finalSnapshot.status.deploymentId, statusId: finalSnapshot.status.statusId, headRef: finalSnapshot.pr.headRef };
      }
      throw new Error("Staging deployment metadata changed during resolution; refusing to use a moving Preview alias.");
    }
    if (now() >= deadline) throw new Error("Timed out waiting for the exact Ready isolated Vercel staging Preview.");
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - now())));
  }
}

export async function resolveAndWritePreview({ env = process.env, appendFileImpl, ...options } = {}) {
  const result = await resolveVercelPreview({ env, ...options });
  await writeGitHubOutput(env, "url", result.url, appendFileImpl);
  await writeGitHubOutput(env, "deployment_id", result.deploymentId, appendFileImpl);
  await writeGitHubOutput(env, "status_id", result.statusId, appendFileImpl);
  await writeGitHubOutput(env, "head_ref", result.headRef, appendFileImpl);
  return result;
}

async function main(env = process.env) {
  try {
    const result = await resolveAndWritePreview({ env });
    console.log(`Resolved the isolated staging Preview for the exact PR SHA (deployment ${result.deploymentId}).`);
  } catch (error) {
    console.error(`Food Taster Preview resolution failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
