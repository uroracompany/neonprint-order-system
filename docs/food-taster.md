# Food Taster CI gate

Food Taster is a pre-merge gate for pull requests targeting `main`. The PR
workflow runs security checks, lint, Vitest and a production build on the exact
PR head. A separate trusted workflow resolves the Vercel Preview deployment
from GitHub's read-only Deployments API, then checks only the anonymous public
login shell. The smoke does not authenticate, submit forms, read business data,
or write to any service.

The Preview is code controlled by the PR. The trusted browser runner receives
its URL only after the controller validates the exact PR SHA and staging-only
GitHub deployment environment. It sends no credential, bypass secret or OIDC
token to that code: Vercel forwards request headers to deployed functions, so a
request token could be read or exfiltrated by malicious Preview code. To run the
smoke, the isolated staging project's Preview deployments must be publicly
reachable. That project must have no production domains, production variables,
credentials or business data. Its production branch stays off `main`. The
browser still blocks other paths, methods, origins and WebSockets. Local smoke
remains credential-free. This static smoke does not require a Supabase staging
project because it cannot access Supabase or application APIs.

## Trust boundaries

- `.github/workflows/food-taster.yml` runs from `pull_request`. Its quality job
  executes PR-controlled code on a runner with `contents: read` only. It has no
  Environment, Vercel secrets, publisher credentials, writable checks/statuses,
  artifacts or shared cache.
- `.github/workflows/food-taster-trusted.yml` runs on `workflow_run`. GitHub
  starts it only when this definition exists on the default branch. The
  controller validates the workflow run, current PR, target `main`, and exact
  full head SHA using GitHub's API.
- Quality checks run on a separate runner at that validated SHA. It has no
  secrets, publisher permission, shared filesystem, cache or artifacts with
  the Preview job.
- The trusted Preview job checks out controller code from the default branch.
  It uses a read token only to resolve the exact staging Preview deployment
  and statuses from `api.github.com`. The browser smoke receives the validated
  URL and a non-secret verification marker. No job mints or sends OIDC or
  deployment bypass credentials to the Preview.
- A deployment is accepted only when it belongs to the full current PR SHA, is
  in the exact staging-only GitHub environment `Preview – neonprint-order-system`,
  has `production_environment=false`, was created by the verified
  `vercel[bot]` identity, and its latest status is a successful status from that
  same bot and environment. The host pattern alone is not unique across the
  two Vercel projects; the environment label is required to distinguish staging.
  The resolver follows pagination only within the expected GitHub API path and
  fails closed for stale, ambiguous, failed, malformed or unavailable metadata.
  The returned URL must also use the reviewed NeonPrint Vercel hostname pattern.
- The browser uses trusted Playwright code/configuration from the default
  branch. Route interception permits only requests accepted by the exact-origin
  read-only allowlist. Redirects to login, other origins, API/auth paths, files,
  non-read methods and WebSockets remain blocked before the request is sent.
- A dedicated GitHub App publishes the `Food Taster gate` Check Run. The
  controller revalidates the PR before creating the check and before
  finalizing it. It marks success only if the PR remains open at the same SHA
  and both quality and Preview jobs succeed. Missing, incomplete, stale,
  failed, cancelled or skipped results cannot satisfy the required check.
  The App identity is verified so a same-named check from another publisher
  cannot pass.

## Required GitHub configuration

1. Connect the repository to the intended Vercel project and enable Preview
   deployments for pull requests. Confirm GitHub deployment metadata records
   the full commit SHA and status URL. The exact Preview hostname allowlist is
   embedded in the trusted resolver and smoke policy. A Vercel slug or hostname
   change intentionally blocks the gate until the allowlist is security-
   reviewed and updated in code and documentation. The verified isolated project
   is `neonprint-order-system-food-taster`, and its Production Branch is
   `codex/food-taster-preview-runner`, not `main`.
2. Create the dedicated GitHub App and install it only in this repository. Give
   it only `Checks: write` and `Metadata: read`. Create protected Environment
   `food-taster-publisher`, configure its trusted approval policy, and store
   only:
   - Variable `FOOD_TASTER_GITHUB_APP_ID` with the numeric App ID.
   - Variable `FOOD_TASTER_GITHUB_APP_CLIENT_ID` with the App client ID.
   - Secret `FOOD_TASTER_GITHUB_APP_PRIVATE_KEY` with the App private key.

   The workflow mints a token limited to this repository and `Checks: write`;
   it never grants `statuses: write` to `GITHUB_TOKEN`. Creation and
   finalization use the protected publisher Environment.
3. In the **staging Vercel project only**, make Preview deployments publicly
   accessible (disable Deployment Protection for Preview, or add only the
   reviewed staging Preview domains to its public exceptions). The staging
   project must have no production domain, secret, production environment value
   or business data, and its Production Branch must remain off `main`. Do not
   create a bypass secret or send a Trusted Sources OIDC token to Preview code.
   If Vercel cannot make only the isolated staging Preview public, the smoke
   must remain blocked until a safe access method is reviewed. The browser runner
   still fails closed unless it resolves a successful deployment for the exact
   PR SHA, staging environment, Vercel bot and approved hostname.
4. Configure `main` to require pull requests and the exact `Food Taster gate`
   Check Run from the dedicated GitHub App. Keep `Quality checks` required as
   well, require current branch status where supported, and do not add a bypass.
   Require trusted owner review for changes to workflows, agent/ship
   instructions, the resolver, GitHub controller, browser policy/smoke and
   this document.

## Scope and limits

- The smoke proves that the anonymous login shell and its allowlisted static
  assets load in the Preview. It does not exercise a changed business module,
  authentication, APIs, database behavior or any other user flow. A PR that
  changes behavior still needs focused unit/integration coverage; a meaningful
  browser flow that uses backend data must use a separately verified staging
  project with synthetic data and a separately reviewed credential boundary.
- Preview environment variables and server-side functions execute outside the
  browser runner. This smoke does not verify their isolation or prove that the
  Preview backend is harmless; it deliberately avoids calling those functions.
- The gate prevents merging changes that fail these pre-merge checks, provided
  the GitHub workflow and required rule are active on the default branch. It
  does not automatically roll back a production deployment, database migration
  or data change after merge. Production rollback requires a separate,
  verified deployment strategy.
- Forks may not be able to access private head repositories. Such runs fail
  closed; do not use `pull_request_target` or expose secrets to work around it.
