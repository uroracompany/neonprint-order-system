import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { matchesPreviewHostname } from "./food-taster-preview-origin.mjs";

const API_BASE = "https://api.github.com";
const VERCEL_BOT = Object.freeze({ login: "vercel[bot]", id: "35613825", type: "Bot" });
const STAGING_ENVIRONMENT = "Preview – neonprint-order-system";
const PREVIEW_HOST_PREFIX = "neonprint-order-system-";
const PREVIEW_HOST_SUFFIX = "-urora-companys-projects.vercel.app";
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

export function validatePreviewUrl(rawUrl, hostPrefix, hostSuffix) {
  if (typeof rawUrl !== "string" || !rawUrl.trim() || /[\\\s]/.test(rawUrl)) {
    throw new Error("Matching Vercel Preview has an invalid or non-HTTPS URL.");
  }
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error("Matching Vercel Preview has an invalid or non-HTTPS URL."); }
  const authority = rawUrl.match(/^https:\/\/([^/?#]+)/i)?.[1] || "";
  if (url.protocol !== "https:") throw new Error("Matching Vercel Preview has an invalid or non-HTTPS URL.");
  if (url.username || url.password || url.port || authority.includes(":") || authority.includes("@")
      || url.pathname !== "/" || url.search || url.hash
      || !matchesPreviewHostname(url.hostname, hostPrefix, hostSuffix)) {
    throw new Error("Matching Vercel Preview hostname or URL is outside the verified project allowlist.");
  }
  return `https://${url.hostname.toLowerCase()}`;
}

export async function writeGitHubOutput(env, key, value, appendFileImpl) {
  if (!env.GITHUB_OUTPUT) throw new Error("GITHUB_OUTPUT is required.");
  const appendFile = appendFileImpl || (await import("node:fs/promises")).appendFile;
  await appendFile(env.GITHUB_OUTPUT, `${key}=${value}\n`, "utf8");
}

const nextPage = (linkHeader, currentUrl, expectedPath) => {
  if (!linkHeader) return null;
  const links = linkHeader.split(",").map((part) => {
    const match = part.trim().match(/^<([^>]+)>\s*;(.*)$/);
    if (!match) throw new Error("GitHub API returned malformed pagination metadata.");
    return { raw: match[1], rel: /(?:^|;)\s*rel="?([^";]+)"?/i.exec(`;${match[2]}`)?.[1]?.split(/\s+/) || [] };
  });
  const next = links.filter((link) => link.rel.includes("next"));
  if (next.length > 1) throw new Error("GitHub API returned ambiguous pagination metadata.");
  if (!next.length) return null;
  const url = new URL(next[0].raw, currentUrl);
  const current = new URL(currentUrl);
  const requiredParams = ["sha", "environment", "per_page"];
  if (url.protocol !== "https:" || url.origin !== API_BASE || url.username || url.password || url.pathname !== expectedPath
      || requiredParams.some((key) => current.searchParams.has(key) && url.searchParams.get(key) !== current.searchParams.get(key))) {
    throw new Error("GitHub API pagination points outside the expected API endpoint.");
  }
  return url.href;
};

async function getPaginated({ initialUrl, token, fetchImpl, deadline, now }) {
  const results = [];
  const visited = new Set();
  let url = initialUrl;
  while (url) {
    if (visited.has(url) || visited.size >= MAX_PAGES) throw new Error("GitHub API pagination is cyclic or exceeds the page limit.");
    visited.add(url);
    const remaining = deadline - now();
    if (remaining <= 0) return { timedOut: true, results: [] };
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error",
      signal: AbortSignal.timeout(Math.max(1, Math.min(30_000, remaining))),
    });
    if (!response.ok) throw new Error(`GitHub Deployments API returned HTTP ${response.status}.`);
    let body;
    try { body = await response.json(); } catch { throw new Error("GitHub Deployments API returned invalid JSON."); }
    if (!Array.isArray(body)) throw new Error("GitHub Deployments API response was not an array.");
    results.push(...body);
    const header = response.headers?.get?.("link") || response.headers?.get?.("Link") || null;
    url = nextPage(header, url, new URL(initialUrl).pathname);
  }
  return { timedOut: false, results };
}

const parseDate = (value, label) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new Error(`GitHub returned an invalid ${label} timestamp.`);
  return time;
};

const selectLatest = (items, label) => {
  if (!items.length) return null;
  const sorted = [...items].sort((a, b) => parseDate(b.created_at, label) - parseDate(a.created_at, label));
  if (sorted.length > 1 && parseDate(sorted[0].created_at, label) === parseDate(sorted[1].created_at, label)) {
    throw new Error(`Multiple equally recent ${label} records are ambiguous.`);
  }
  return sorted[0];
};

const exactDeployments = (items, sha) => items.filter((deployment) => (
  deployment && typeof deployment === "object"
  && typeof deployment.sha === "string"
  && deployment.sha.toLowerCase() === sha.toLowerCase()
  && deployment.environment === STAGING_ENVIRONMENT
  && deployment.production_environment === false
));

const getStatuses = async ({ owner, repo, deploymentId, token, fetchImpl, deadline, now }) => {
  if (!Number.isSafeInteger(Number(deploymentId)) || Number(deploymentId) <= 0) throw new Error("GitHub returned an invalid Preview deployment ID.");
  const prefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments/${deploymentId}/statuses`;
  return getPaginated({
    initialUrl: `${API_BASE}${prefix}?per_page=100`,
    token, fetchImpl, deadline, now,
  });
};

export function validateDeploymentSet(deployments, sha) {
  if (!Array.isArray(deployments)) throw new Error("GitHub Deployments response was not an array.");
  const exact = exactDeployments(deployments, sha);
  if (!exact.length) return null;
  const latest = selectLatest(exact, "Preview deployment");
  if (!trustedActor(latest.creator)) throw new Error("Latest staging Preview deployment is not from the verified Vercel bot.");
  if (!Number.isSafeInteger(Number(latest.id)) || Number(latest.id) <= 0) throw new Error("GitHub returned an invalid staging Preview deployment ID.");
  return latest;
}

export function validateDeploymentStatus(statuses, hostPrefix, hostSuffix) {
  if (!Array.isArray(statuses)) throw new Error("GitHub Deployment statuses response was not an array.");
  const latest = selectLatest(statuses.filter((status) => status && typeof status === "object"), "Preview deployment status");
  if (!latest) return { state: "pending" };
  if (latest.environment !== STAGING_ENVIRONMENT) throw new Error("Latest deployment status is not in the verified staging Preview environment.");
  if (!trustedActor(latest.creator)) throw new Error("Latest staging Preview deployment status is not from the verified Vercel bot.");
  if (["queued", "pending", "in_progress"].includes(latest.state)) return { state: "pending" };
  if (latest.state !== "success") throw new Error(`Matching Vercel Preview deployment ended in ${String(latest.state || "unknown")}.`);
  return { state: "success", url: validatePreviewUrl(latest.environment_url, hostPrefix, hostSuffix) };
}

export async function resolveVercelPreview({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const token = required(env, "GITHUB_TOKEN");
  const repository = required(env, "GITHUB_REPOSITORY").split("/");
  if (repository.length !== 2 || repository.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) throw new Error("GITHUB_REPOSITORY must be owner/repository.");
  const [owner, repo] = repository;
  const sha = required(env, "PR_HEAD_SHA").toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("PR_HEAD_SHA must be a full 40-character commit SHA.");
  const hostPrefix = PREVIEW_HOST_PREFIX;
  const hostSuffix = PREVIEW_HOST_SUFFIX;
  const timeoutMs = Number(env.VERCEL_PREVIEW_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new Error("VERCEL_PREVIEW_TIMEOUT_MS must be a non-negative number.");
  const deadline = now() + timeoutMs;
  const deploymentsPrefix = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/deployments`;
  const deploymentsUrl = new URL(`${API_BASE}${deploymentsPrefix}`);
  deploymentsUrl.searchParams.set("sha", sha);
  deploymentsUrl.searchParams.set("environment", STAGING_ENVIRONMENT);
  deploymentsUrl.searchParams.set("per_page", "100");

  while (true) {
    const deploymentPage = await getPaginated({
      initialUrl: deploymentsUrl.href,
      token, fetchImpl, deadline, now,
    });
    if (deploymentPage.timedOut) throw new Error("Timed out waiting for the matching Vercel Preview deployment.");
    const deployment = validateDeploymentSet(deploymentPage.results, sha);
    if (deployment) {
      const statusPage = await getStatuses({ owner, repo, deploymentId: deployment.id, token, fetchImpl, deadline, now });
      if (statusPage.timedOut) throw new Error("Timed out waiting for the matching Vercel Preview status.");
      const result = validateDeploymentStatus(statusPage.results, hostPrefix, hostSuffix);
      if (result.state === "success") return result.url;
    }
    if (now() >= deadline) throw new Error("Timed out waiting for the matching successful Vercel Preview deployment.");
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - now())));
  }
}

export async function resolveAndWritePreview({ env = process.env, appendFileImpl, ...options } = {}) {
  const url = await resolveVercelPreview({ env, ...options });
  await writeGitHubOutput(env, "url", url, appendFileImpl);
  return url;
}

async function main(env = process.env) {
  try {
    await resolveAndWritePreview({ env });
    console.log("Resolved the successful Preview for the exact pull request SHA.");
  } catch (error) {
    console.error(`Food Taster Preview resolution failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
