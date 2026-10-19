import { readFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ROOT = "https://api.github.com";
const WORKFLOW_PATH = "food-taster.yml";
const WORKFLOW_NAME = "Food Taster";
const CHECK_NAME = "Food Taster gate";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const fail = (message) => { throw new Error(message); };

const required = (env, name) => {
  const value = env[name]?.trim();
  if (!value) fail(`Required environment variable ${name} is missing.`);
  return value;
};

const parseJson = async (response, description) => {
  if (!response.ok) fail(`${description} returned HTTP ${response.status}.`);
  try { return await response.json(); } catch { fail(`${description} returned invalid JSON.`); }
};

function createGitHubClient({ env, fetchImpl, tokenName = "GITHUB_TOKEN" }) {
  const token = required(env, tokenName);
  const repository = required(env, "GITHUB_REPOSITORY");
  if (!REPOSITORY_PATTERN.test(repository)) fail("GITHUB_REPOSITORY has an invalid format.");
  const repositoryPath = repository.split("/").map(encodeURIComponent).join("/");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
  const request = async (path, options = {}) => {
    const response = await fetchImpl(`${API_ROOT}${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
      redirect: "error",
    });
    return parseJson(response, "GitHub API request");
  };
  return { repository, repositoryPath, request };
}

const normalizedRepo = (repo) => typeof repo === "string" ? repo.toLowerCase() : "";
const getPullRequest = (client, number) => client.request(`/repos/${client.repositoryPath}/pulls/${number}`);

function validatePullRequest(pull, repository, expectedSha, expectedHeadRepo) {
  if (pull.state !== "open") fail("The associated pull request is not open.");
  if (pull.base?.ref !== "main" || normalizedRepo(pull.base?.repo?.full_name) !== normalizedRepo(repository)) {
    fail("The associated pull request no longer targets this repository's main branch.");
  }
  if (!SHA_PATTERN.test(pull.head?.sha || "") || pull.head.sha.toLowerCase() !== expectedSha.toLowerCase()) {
    fail("The pull request head SHA changed during Food Taster validation.");
  }
  if (!REPOSITORY_PATTERN.test(pull.head?.repo?.full_name || "")
      || normalizedRepo(pull.head.repo.full_name) !== normalizedRepo(expectedHeadRepo)) {
    fail("The pull request head repository changed during Food Taster validation.");
  }
}

async function getWorkflowRun(client, event) {
  const runId = Number(event?.workflow_run?.id);
  if (!Number.isSafeInteger(runId) || runId < 1) fail("workflow_run event has no valid run ID.");
  const workflow = await client.request(`/repos/${client.repositoryPath}/actions/workflows/${WORKFLOW_PATH}`);
  if (workflow.name !== WORKFLOW_NAME || workflow.state !== "active" || !Number.isSafeInteger(workflow.id)) {
    fail("The expected Food Taster workflow is not active in this repository.");
  }
  const run = await client.request(`/repos/${client.repositoryPath}/actions/runs/${runId}`);
  if (run.id !== runId || run.workflow_id !== workflow.id || run.event !== "pull_request") {
    fail("The workflow run is not the expected pull_request Food Taster run.");
  }
  if (normalizedRepo(run.repository?.full_name) !== normalizedRepo(client.repository)) fail("The workflow run belongs to a different repository.");
  if (!SHA_PATTERN.test(run.head_sha || "") || !REPOSITORY_PATTERN.test(run.head_repository?.full_name || "")) {
    fail("The workflow run has invalid PR head metadata.");
  }
  if (!Array.isArray(run.pull_requests) || run.pull_requests.length !== 1) fail("The workflow run must map to exactly one pull request.");
  const association = run.pull_requests[0];
  const number = Number(association.number);
  if (!Number.isSafeInteger(number) || number < 1) fail("The pull request association has an invalid number.");
  // Actions' workflow-run API embeds a reduced pull request association whose
  // nested repository objects omit `full_name`. Check the available base ref
  // here; validate canonical base/head repository names below via the Pull
  // Request API response.
  if (association.base?.ref !== "main") {
    fail("The associated pull request does not target this repository's main branch.");
  }
  if (association.head?.sha !== run.head_sha) {
    fail("The workflow run metadata does not match the associated pull request head.");
  }
  const pull = await getPullRequest(client, number);
  validatePullRequest(pull, client.repository, run.head_sha, run.head_repository.full_name);
  return { number, headSha: run.head_sha.toLowerCase(), headRepo: pull.head.repo.full_name, runId };
}

async function writeOutput(env, key, value) {
  await appendFile(required(env, "GITHUB_OUTPUT"), `${key}=${value}\n`, "utf8");
}

function appIdentity(env) {
  const id = required(env, "FOOD_TASTER_GITHUB_APP_ID");
  if (!/^\d+$/.test(id) || Number(id) < 1) fail("FOOD_TASTER_GITHUB_APP_ID must be a positive integer.");
  return Number(id);
}

async function assertCurrentPull(client, env) {
  const number = Number(required(env, "PR_NUMBER"));
  const sha = required(env, "PR_HEAD_SHA").toLowerCase();
  const headRepo = required(env, "PR_HEAD_REPO");
  if (!Number.isSafeInteger(number) || number < 1 || !SHA_PATTERN.test(sha) || !REPOSITORY_PATTERN.test(headRepo)) {
    fail("Validated pull request number, repository or SHA is invalid.");
  }
  const pull = await getPullRequest(client, number);
  validatePullRequest(pull, client.repository, sha, headRepo);
  return { number, sha, headRepo };
}

export async function prepareFoodTaster({ env = process.env, fetchImpl = globalThis.fetch, event } = {}) {
  const client = createGitHubClient({ env, fetchImpl });
  const eventPayload = event || JSON.parse(await readFile(required(env, "GITHUB_EVENT_PATH"), "utf8"));
  const pull = await getWorkflowRun(client, eventPayload);
  validatePullRequest(await getPullRequest(client, pull.number), client.repository, pull.headSha, pull.headRepo);
  await writeOutput(env, "number", String(pull.number));
  await writeOutput(env, "head_sha", pull.headSha);
  await writeOutput(env, "head_repo", pull.headRepo);
  await writeOutput(env, "run_id", String(pull.runId));
  return pull;
}

export async function createFoodTasterCheck({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const appId = appIdentity(env);
  const reader = createGitHubClient({ env, fetchImpl, tokenName: "GITHUB_TOKEN" });
  const writer = createGitHubClient({ env, fetchImpl, tokenName: "APP_TOKEN" });
  const { number, sha } = await assertCurrentPull(reader, env);
  const runId = required(env, "TRUSTED_WORKFLOW_RUN_ID");
  if (!/^\d+$/.test(runId)) fail("TRUSTED_WORKFLOW_RUN_ID must be an integer.");
  const check = await writer.request(`/repos/${writer.repositoryPath}/check-runs`, {
    method: "POST",
    body: JSON.stringify({
      name: CHECK_NAME,
      head_sha: sha,
      status: "in_progress",
      external_id: `${runId}:pr-${number}`,
      output: { title: "Food Taster is running", summary: "Trusted quality checks, including the local browser smoke, are in progress." },
    }),
  });
  if (check.name !== CHECK_NAME || check.head_sha?.toLowerCase() !== sha || check.status !== "in_progress"
      || Number(check.app?.id) !== appId || !Number.isSafeInteger(check.id) || check.id < 1) {
    fail("GitHub returned a Check Run with an unexpected source, SHA, status or identity.");
  }
  await assertCurrentPull(reader, env);
  await writeOutput(env, "check_run_id", String(check.id));
  return { checkRunId: check.id, headSha: sha, appId };
}

export async function finalizeFoodTaster({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const appId = appIdentity(env);
  const reader = createGitHubClient({ env, fetchImpl, tokenName: "GITHUB_TOKEN" });
  const writer = createGitHubClient({ env, fetchImpl, tokenName: "APP_TOKEN" });
  const { number, sha } = await assertCurrentPull(reader, env);
  const checkRunId = Number(required(env, "CHECK_RUN_ID"));
  if (!Number.isSafeInteger(checkRunId) || checkRunId < 1) fail("CHECK_RUN_ID must be a positive integer.");
  const checkPath = `/repos/${writer.repositoryPath}/check-runs/${checkRunId}`;
  const check = await writer.request(checkPath);
  if (check.id !== checkRunId || check.name !== CHECK_NAME || check.head_sha?.toLowerCase() !== sha
      || Number(check.app?.id) !== appId || check.status !== "in_progress") {
    fail("Existing Check Run does not belong to the dedicated App/current SHA or is not in progress.");
  }
  const quality = env.QUALITY_RESULT || "missing";
  const preview = env.PREVIEW_RESULT || "missing";
  const succeeded = quality === "success" && preview === "success";
  const summary = succeeded
    ? "Trusted quality checks and the Preview smoke passed for the current PR head."
    : `Food Taster blocked: quality=${quality}; preview=${preview}.`;
  const updated = await writer.request(checkPath, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      conclusion: succeeded ? "success" : "failure",
      completed_at: new Date().toISOString(),
      output: { title: succeeded ? "Food Taster passed" : "Food Taster blocked", summary },
    }),
  });
  if (updated.conclusion !== (succeeded ? "success" : "failure") || Number(updated.app?.id) !== appId
      || updated.head_sha?.toLowerCase() !== sha) {
    fail("GitHub returned a Check Run update with an unexpected source, SHA or conclusion.");
  }
  if (!succeeded) fail(summary);
  return { conclusion: "success", checkRunId, appId, sha };
}

async function main() {
  try {
    const mode = process.argv[2];
    if (mode === "prepare") await prepareFoodTaster();
    else if (mode === "create-check") await createFoodTasterCheck();
    else if (mode === "finalize") await finalizeFoodTaster();
    else fail("Usage: node scripts/food-taster-github.mjs <prepare|create-check|finalize>");
  } catch (error) {
    console.error(`Food Taster GitHub controller failed: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
