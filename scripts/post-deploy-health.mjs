import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPOSITORY = "uroracompany/neonprint-order-system";
export const PRODUCTION_ENVIRONMENT = "Production – neonprint-order-system";
export const VERCEL_BOT = { login: "vercel[bot]", id: 35613825 };

const DEPLOYMENT_HOST = /^neonprint-order-system-[a-z0-9]{9}-urora-companys-projects\.vercel\.app$/;
const SHA = /^[0-9a-f]{40}$/i;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const isBot = (value) => isObject(value)
  && value.login === VERCEL_BOT.login
  && Number(value.id) === VERCEL_BOT.id;

export function validateDeploymentUrl(value) {
  if (typeof value !== "string" || value.length > 300) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (value === url.origin || value === `${url.origin}/`)
    && url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.port === ""
    && url.pathname === "/"
    && url.search === ""
    && url.hash === ""
    && DEPLOYMENT_HOST.test(url.hostname);
}

export function isOptionalFontRequest(value, method) {
  if (method !== "GET" && method !== "HEAD") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
  if (url.hostname === "fonts.googleapis.com") {
    const families = url.searchParams.getAll("family");
    const keys = [...url.searchParams.keys()];
    return url.pathname === "/css2"
      && families.length > 0
      && families.every((family) => /^(Poppins|Syne):wght@(?:[3-9]00)(?:;(?:[3-9]00))*$/i.test(family))
      && keys.every((key) => key === "family" || key === "display")
      && url.searchParams.getAll("display").length === 1
      && url.searchParams.get("display") === "swap";
  }
  if (url.hostname === "fonts.gstatic.com") {
    return /^\/s\/(poppins|syne)\/v[0-9]+\/[a-z0-9_-]+\.woff2$/i.test(url.pathname) && url.search === "";
  }
  return false;
}

export function isAllowedProductionReadRequest(value, method, expectedOrigin) {
  if (method !== "GET" && method !== "HEAD") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.origin !== expectedOrigin || url.username || url.password || url.port || url.search || url.hash) return false;
  return url.pathname === "/"
    || url.pathname.startsWith("/assets/")
    || ["/favicon.ico", "/favicon-32.png", "/favicon-48.png", "/favicon-180.png", "/vite.svg"].includes(url.pathname);
}

function fail(reason, deploymentId = "unknown", sha = "unknown") {
  return { outcome: "fail", reason, deploymentId: String(deploymentId), sha: String(sha) };
}

export function classifyDeploymentEvent(event) {
  if (!isObject(event) || !isObject(event.repository) || !isObject(event.deployment) || !isObject(event.deployment_status)) {
    return fail("Malformed deployment_status event.");
  }

  const { repository, deployment, deployment_status: status } = event;
  if (`${repository.owner?.login}/${repository.name}` !== REPOSITORY) {
    return { outcome: "ignore", reason: "Event belongs to another repository." };
  }

  const productionLabel = deployment.environment === PRODUCTION_ENVIRONMENT
    || status.environment === PRODUCTION_ENVIRONMENT;
  if (!productionLabel) return { outcome: "ignore", reason: "Not the NeonPrint Production environment." };

  const deploymentId = deployment.id;
  const sha = deployment.sha;
  if (!positiveId(deploymentId) || !SHA.test(sha ?? "") || deployment.task !== "deploy"
    || deployment.environment !== PRODUCTION_ENVIRONMENT
    || status.environment !== PRODUCTION_ENVIRONMENT
    || !isBot(deployment.creator)
    || !isBot(status.creator)
    || !positiveId(status.id)) {
    return fail("Production deployment identity is incomplete or untrusted.", deploymentId, sha);
  }

  if (status.state === "pending") {
    return { outcome: "ignore", reason: "Production deployment is still pending.", deploymentId: String(deploymentId), sha };
  }
  if (status.state === "failure" || status.state === "error") {
    return {
      outcome: "deployment-failed",
      reason: `Vercel reported Production deployment state: ${status.state}.`,
      deploymentId: String(deploymentId),
      statusId: String(status.id),
      sha,
    };
  }
  if (status.state !== "success") {
    return fail(`Unexpected Production deployment state: ${String(status.state)}.`, deploymentId, sha);
  }

  const expectedStatusUrl = `https://api.github.com/repos/${REPOSITORY}/deployments/${deploymentId}`;
  if (status.deployment_url !== expectedStatusUrl || !validateDeploymentUrl(status.environment_url)) {
    return fail("Production deployment URL is missing, mismatched, or outside the immutable Vercel project host.", deploymentId, sha);
  }

  return {
    outcome: "smoke",
    deploymentId: String(deploymentId),
    statusId: String(status.id),
    sha,
    url: status.environment_url,
  };
}

export function resolveLatestProductionDeployment(deployments, eventDeploymentId, eventSha) {
  if (!Array.isArray(deployments)) throw new Error("GitHub deployments response is not an array.");
  const candidates = deployments.filter((deployment) => isObject(deployment)
    && deployment.environment === PRODUCTION_ENVIRONMENT
    && deployment.task === "deploy");
  if (candidates.length === 0) throw new Error("GitHub returned no current Production deployment.");
  const dated = candidates.map((deployment) => {
    const createdAt = Date.parse(deployment.created_at ?? "");
    if (!Number.isFinite(createdAt)) throw new Error("Production deployment is missing a valid created_at timestamp.");
    return { deployment, createdAt };
  }).sort((left, right) => right.createdAt - left.createdAt);
  if (dated.length > 1 && dated[0].createdAt === dated[1].createdAt) {
    throw new Error("Latest Production deployment is ambiguous because timestamps are equal.");
  }
  const latest = dated[0].deployment;
  if (!positiveId(latest.id) || !SHA.test(latest.sha ?? "") || !isBot(latest.creator)) {
    throw new Error("Latest Production deployment metadata is incomplete or not from Vercel.");
  }
  return {
    current: String(latest.id) === String(eventDeploymentId) && latest.sha.toLowerCase() === String(eventSha).toLowerCase(),
    latestDeploymentId: String(latest.id),
    latestSha: latest.sha,
  };
}

function safeText(value) {
  return String(value).replace(/[\r\n]/g, " ").replace(/::/g, ": :");
}

function writeOutput(values) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${safeText(value)}`);
  appendFileSync(file, `${lines.join("\n")}\n`, { encoding: "utf8" });
}

function writeFailureSummary(result) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const deploymentUrl = validateDeploymentUrl(result.url) ? result.url : "Unavailable or rejected";
  const body = [
    "## Production deployment health check failed",
    "",
    `- **Reason:** ${safeText(result.reason)}`,
    `- **Deployment ID:** ${safeText(result.deploymentId)}`,
    `- **Commit:** \`${safeText(result.sha)}\``,
    `- **Deployment URL:** ${deploymentUrl}`,
    "- **Recovery:** Follow [the manual rollback runbook](https://github.com/uroracompany/neonprint-order-system/blob/main/docs/post-deploy-health.md).",
    "",
    "No automatic routing, database, or business-data changes were made.",
    "",
  ].join("\n");
  if (summary) appendFileSync(summary, body, { encoding: "utf8" });
  console.error(`::error title=Production health check failed::${safeText(result.reason)} (deployment ${safeText(result.deploymentId)}, SHA ${safeText(result.sha)})`);
}

export async function fetchLatestProductionDeployment(eventDeployment, { token = process.env.GITHUB_TOKEN, fetchImpl = fetch } = {}) {
  if (!isObject(eventDeployment) || !positiveId(eventDeployment.id) || !SHA.test(eventDeployment.sha ?? "")) {
    throw new Error("Deployment event has no validated deployment ID/SHA for latest-release comparison.");
  }
  if (!token) throw new Error("GITHUB_TOKEN is required for the read-only latest-deployment comparison.");
  const endpoint = new URL(`https://api.github.com/repos/${REPOSITORY}/deployments`);
  endpoint.searchParams.set("environment", PRODUCTION_ENVIRONMENT);
  endpoint.searchParams.set("task", "deploy");
  endpoint.searchParams.set("per_page", "100");
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const deployments = [];
  let exhausted = false;
  for (let page = 1; page <= 20; page += 1) {
    endpoint.searchParams.set("page", String(page));
    const response = await fetchImpl(endpoint, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`GitHub deployments API returned HTTP ${response.status} on page ${page}.`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error(`GitHub deployments API returned malformed page ${page}.`);
    deployments.push(...batch);
    if (batch.length < 100) {
      exhausted = true;
      break;
    }
  }
  if (!exhausted) throw new Error("More than 2,000 deployments were returned; latest Production deployment cannot be verified safely.");
  return resolveLatestProductionDeployment(deployments, eventDeployment.id, eventDeployment.sha);
}

async function checkLatest(event) {
  return fetchLatestProductionDeployment(event?.deployment);
}

function main() {
  const command = process.argv[2];
  if (command !== "classify" && command !== "report-failure" && command !== "report-deployment-failure" && command !== "check-latest") {
    throw new Error("Usage: node scripts/post-deploy-health.mjs classify|check-latest|report-failure|report-deployment-failure");
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required.");
  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch {
    const result = fail("GitHub deployment event could not be parsed.");
    writeFailureSummary(result);
    writeOutput({ outcome: "fail" });
    process.exitCode = 1;
    return;
  }

  const result = classifyDeploymentEvent(event);
  if (command === "check-latest") {
    checkLatest(event).then((latest) => {
      if (!latest.current) {
        const summary = process.env.GITHUB_STEP_SUMMARY;
        if (summary) appendFileSync(summary, [
          "## Skipped superseded Production deployment",
          "",
          `- Event deployment: \`${String(event.deployment.id)}\` / \`${String(event.deployment.sha)}\``,
          `- Newer deployment: \`${latest.latestDeploymentId}\` / \`${latest.latestSha}\``,
          "- No browser request was made; the current deployment has its own status event.",
          "",
        ].join("\n"), { encoding: "utf8" });
        writeOutput({ current: "false" });
        console.log("Skipped a Production deployment status superseded by a newer deployment.");
        return;
      }
      writeOutput({ current: "true" });
      console.log(`Confirmed deployment ${latest.latestDeploymentId} is the latest Production release.`);
    }).catch((error) => {
      const message = safeText(error instanceof Error ? error.message : error);
      writeFailureSummary({ reason: `Could not verify the latest Production deployment: ${message}`, deploymentId: event.deployment?.id ?? "unknown", sha: event.deployment?.sha ?? "unknown" });
      writeOutput({ current: "error" });
      process.exitCode = 1;
    });
    return;
  }
  if (command === "report-failure") {
    writeFailureSummary({
      ...result,
      reason: result.outcome === "smoke"
        ? "The validated Production smoke job failed. Inspect the preceding step logs."
        : `The Production smoke job failed after event classification (${result.reason ?? result.outcome}).`,
      url: result.outcome === "smoke" ? result.url : undefined,
    });
    return;
  }
  if (command === "report-deployment-failure") {
    if (result.outcome !== "deployment-failed") throw new Error("Event does not contain a verified Vercel Production failure status.");
    writeFailureSummary(result);
    process.exitCode = 1;
    return;
  }
  if (result.outcome === "fail") {
    writeFailureSummary(result);
    writeOutput({ outcome: "fail" });
    process.exitCode = 1;
    return;
  }
  if (result.outcome === "ignore") {
    console.log(result.reason);
    writeOutput({ outcome: "ignore" });
    return;
  }
  if (result.outcome === "deployment-failed") {
    writeOutput({ outcome: result.outcome, deployment_id: result.deploymentId, status_id: result.statusId, sha: result.sha });
    console.log(result.reason);
    return;
  }
  writeOutput({
    outcome: "smoke",
    deployment_id: result.deploymentId,
    status_id: result.statusId,
    sha: result.sha,
    url: result.url,
  });
  console.log(`Validated Production deployment ${result.deploymentId} at ${result.url}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
