import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const rootDirectory = process.cwd();
const skippedDirectories = new Set([".git", ".vercel", "dist", "node_modules"]);
const scannedExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".jsx", ".mjs", ".ts", ".tsx"]);
const exposedViteSecretPattern = /^[\t ]*(?:export[\t ]+)?VITE_[A-Z0-9_]*(?:SERVICE_ROLE|SERVICE_KEY|SECRET)[A-Z0-9_]*[\t ]*=/m;

const runGit = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
};

const isGitRepository = () => {
  try {
    return runGit(["rev-parse", "--is-inside-work-tree"]) === "true";
  } catch {
    return false;
  }
};

const shouldScanFile = (filePath) => {
  const fileName = filePath.split(/[\\/]/).pop() || "";
  if (fileName === "README.md" || filePath.includes("src/__tests__")) return false;
  return fileName.startsWith(".env") || scannedExtensions.has(extname(fileName));
};

const findExposedViteSecrets = (directory = rootDirectory) => {
  const findings = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) findings.push(...findExposedViteSecrets(join(directory, entry.name)));
      continue;
    }
    const filePath = join(directory, entry.name);
    if (!entry.isFile() || !shouldScanFile(relative(rootDirectory, filePath))) continue;

    const content = readFileSync(filePath, "utf8");
    const match = content.match(exposedViteSecretPattern);
    if (match) {
      const line = content.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${relative(rootDirectory, filePath)}:${line}:${match[0].trim()}`);
    }
  }
  return findings.join("\n");
};

const hasGitMetadata = isGitRepository();
const trackedEnv = hasGitMetadata
  ? runGit(["ls-files", "--error-unmatch", ".env"])
  : (existsSync(join(rootDirectory, ".env")) ? ".env" : "");
if (trackedEnv) {
  throw new Error("Se bloqueo el build: .env no debe estar versionado.");
}

const exposedServiceRole = hasGitMetadata
  ? runGit([
    "grep", "-nE",
    "^[[:space:]]*(export[[:space:]]+)?VITE_[A-Z0-9_]*(SERVICE_ROLE|SERVICE_KEY|SECRET)[A-Z0-9_]*[[:space:]]*=",
    "--", ".", ":!src/__tests__", ":!README.md",
  ])
  : findExposedViteSecrets();

if (exposedServiceRole) {
  throw new Error("Se bloqueo el build: una variable sensible con prefijo VITE_ quedaria expuesta al navegador.");
}

console.log("security:check OK");
