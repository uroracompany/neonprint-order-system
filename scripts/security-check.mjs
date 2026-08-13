import { execFileSync } from "node:child_process";

const runGit = (args) => {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
};

const trackedEnv = runGit(["ls-files", "--error-unmatch", ".env"]);
if (trackedEnv) {
  throw new Error("Se bloqueo el build: .env no debe estar versionado.");
}

const exposedServiceRole = runGit([
  "grep", "-nE",
  "^[[:space:]]*(export[[:space:]]+)?VITE_[A-Z0-9_]*(SERVICE_ROLE|SERVICE_KEY|SECRET)[A-Z0-9_]*[[:space:]]*=",
  "--", ".", ":!src/__tests__", ":!README.md",
]);

if (exposedServiceRole) {
  throw new Error("Se bloqueo el build: una variable sensible con prefijo VITE_ quedaria expuesta al navegador.");
}

console.log("security:check OK");
