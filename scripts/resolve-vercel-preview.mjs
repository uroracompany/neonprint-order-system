import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.github.com";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const VERCEL_HOST_SUFFIX = "-urora-companys-projects.vercel.app";
const MAX_POLLS = 40;
const POLL_INTERVAL_MS = 15_000;
const fail = (message) => { throw new Error(message); };

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) fail(`Required environment variable ${name} is missing.`);
  return value;
}

function parseHttpsOrigin(value, label) {
  let url;
  try { url = new URL(value); } catch { fail(`${label} must be a valid URL.`); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.port !== "" || (url.pathname !== "/" && url.pathname !== "")) {
    fail(`${label} must be an HTTPS origin on the standard port, without credentials, path, query or fragment.`);
  }
  return url.origin;
}

export function validatePreviewConfiguration(env = process.env) {
  const repository = required(env, "GITHUB_REPOSITORY");
  if (!REPOSITORY_PATTERN.test(repository)) fail("GITHUB_REPOSITORY has an invalid format.");
  const sha = required(env, "PR_HEAD_SHA");
  if (!SHA_PATTERN.test(sha)) fail("PR_HEAD_SHA must be a full commit SHA.");
  const prNumber = Number(required(env, "PR_NUMBER"));
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) fail("PR_NUMBER must be a positive integer.");

  const stagingOrigin = parseHttpsOrigin(required(env, "FOOD_TASTER_STAGING_SUPABASE_URL"), "Staging Supabase URL");
  const productionOrigin = parseHttpsOrigin(required(env, "FOOD_TASTER_PRODUCTION_SUPABASE_URL"), "Production Supabase URL");
  if (!new URL(stagingOrigin).hostname.endsWith(".supabase.co")
      || !new URL(productionOrigin).hostname.endsWith(".supabase.co")) {
    fail("Food Taster Supabase URLs must use the canonical *.supabase.co host.");
  }
  if (stagingOrigin === productionOrigin) fail("Staging Supabase must be separate from Production Supabase.");
  const anonKey = required(env, "FOOD_TASTER_STAGING_SUPABASE_ANON_KEY");
  if (anonKey.length < 16 || /\s/.test(anonKey)) fail("Staging Supabase anon key is malformed.");
  const vercelProjectId = required(env, "FOOD_TASTER_VERCEL_PROJECT_ID");
  return { repository, sha: sha.toLowerCase(), prNumber, stagingOrigin, productionOrigin, anonKey, vercelProjectId };
}

function validatePreviewURL(value) {
  let url;
  try { url = new URL(value); } catch { fail("Vercel Preview URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.port !== ""
      || !url.hostname.startsWith("neonprint-order-system-")
      || !url.hostname.endsWith(VERCEL_HOST_SUFFIX)) {
    fail("Vercel deployment is not an HTTPS NeonPrint Preview URL on the standard port from the expected Vercel team.");
  }
  return url.origin;
}

async function responseJson(response, label) {
  if (!response.ok) fail(`${label} returned HTTP ${response.status}.`);
  try { return await response.json(); } catch { fail(`${label} returned invalid JSON.`); }
}

function createGitHubClient({ token, repository, fetchImpl }) {
  const path = repository.split("/").map(encodeURIComponent).join("/");
  return async (endpoint) => {
    const response = await fetchImpl(`${API_ROOT}/repos/${path}${endpoint}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
    });
    return responseJson(response, "GitHub deployment lookup");
  };
}

async function verifyCurrentPullRequest(request, repository, prNumber, sha) {
  const pull = await request(`/pulls/${prNumber}`);
  if (pull.state !== "open" || pull.base?.ref !== "main"
      || pull.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()
      || pull.head?.sha?.toLowerCase() !== sha) {
    fail("The PR must remain open, target this repository's main branch, and match the checked SHA.");
  }
}

async function latestPreviewStatus(request, deploymentId) {
  const statuses = await request(`/deployments/${deploymentId}/statuses?per_page=100`);
  if (!Array.isArray(statuses) || statuses.length === 0) return null;
  return statuses[0];
}

async function verifyPreviewAssets({ previewOrigin, stagingOrigin, productionOrigin, anonKey, fetchImpl }) {
  const pageResponse = await fetchImpl(previewOrigin, { redirect: "error" });
  if (!pageResponse.ok) fail(`Vercel Preview returned HTTP ${pageResponse.status}.`);
  const html = await pageResponse.text();
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map((match) => match[1]);
  if (scripts.length === 0 || scripts.length > 50) fail("Vercel Preview did not return a bounded set of JavaScript assets.");
  let sawStagingUrl = false;
  let sawStagingAnonKey = false;
  for (const source of scripts) {
    const assetURL = new URL(source, `${previewOrigin}/`);
    if (assetURL.origin !== previewOrigin || assetURL.protocol !== "https:") {
      fail("Vercel Preview HTML references a JavaScript asset outside the exact Preview origin.");
    }
    const response = await fetchImpl(assetURL.href, { redirect: "error" });
    if (!response.ok) fail("Vercel Preview JavaScript asset could not be retrieved.");
    const bundle = await response.text();
    if (bundle.includes(productionOrigin)) fail("Vercel Preview client bundle contains the Production Supabase origin.");
    if (bundle.includes(stagingOrigin)) sawStagingUrl = true;
    if (bundle.includes(anonKey)) sawStagingAnonKey = true;
  }
  if (!sawStagingUrl || !sawStagingAnonKey) {
    fail("Vercel Preview client bundle is not configured with the expected staging Supabase URL and anon key.");
  }
}

export async function resolveVercelPreview({ env = process.env, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), maxPolls = MAX_POLLS } = {}) {
  if (env.FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED !== "true") {
    fail("Preview isolation has not been manually confirmed; set FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED=true only after verifying Vercel Preview scopes and removing Production credentials.");
  }
  const config = validatePreviewConfiguration(env);
  const token = required(env, "GITHUB_TOKEN");
  const request = createGitHubClient({ token, repository: config.repository, fetchImpl });
  await verifyCurrentPullRequest(request, config.repository, config.prNumber, config.sha);

  for (let poll = 0; poll < maxPolls; poll += 1) {
    const deployments = await request(`/deployments?sha=${encodeURIComponent(config.sha)}&environment=Preview&per_page=100`);
    if (!Array.isArray(deployments)) fail("GitHub deployment lookup did not return a list.");
    const candidates = deployments
      .filter((deployment) => deployment.sha?.toLowerCase() === config.sha && deployment.environment?.toLowerCase() === "preview");
    const matching = candidates
      .filter((deployment) => deployment.payload?.projectId === config.vercelProjectId)
      .sort((left, right) => Date.parse(right.created_at || "") - Date.parse(left.created_at || ""));
    if (candidates.length > 0 && matching.length === 0) {
      fail("Vercel Preview deployment metadata is missing or does not match FOOD_TASTER_VERCEL_PROJECT_ID.");
    }
    if (matching.length > 0) {
      const deployment = matching[0];
      if (!Number.isSafeInteger(deployment.id) || deployment.id < 1) fail("Vercel Preview deployment has an invalid ID.");
      const status = await latestPreviewStatus(request, deployment.id);
      if (status?.state === "success") {
        const previewOrigin = validatePreviewURL(status.environment_url || "");
        await verifyCurrentPullRequest(request, config.repository, config.prNumber, config.sha);
        await verifyPreviewAssets({ ...config, previewOrigin, fetchImpl });
        return { previewOrigin, sha: config.sha, prNumber: config.prNumber };
      }
      if (["failure", "error", "inactive"].includes(status?.state)) {
        fail(`The latest Vercel Preview deployment ended in ${status.state}.`);
      }
    }
    if (poll + 1 < maxPolls) await sleep(POLL_INTERVAL_MS);
  }
  fail("No successful Vercel Preview deployment for the exact PR SHA became available before timeout.");
}

async function writeOutput(env, name, value) {
  if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `${name}=${value}\n`, "utf8");
  else console.log(`${name}=${value}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await resolveVercelPreview();
    await writeOutput(process.env, "preview_url", result.previewOrigin);
    console.log(`Verified Vercel Preview for PR #${result.prNumber} at ${result.sha.slice(0, 7)} against isolated staging configuration.`);
  } catch (error) {
    console.error(`Food Taster Preview validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
