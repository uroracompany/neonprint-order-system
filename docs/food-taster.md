# Food Taster CI gate

Food Taster is a private pre-merge gate for pull requests targeting `main`. It
checks the exact PR head with security checks, lint, Vitest, a production build,
and a non-destructive Playwright smoke of that build served on runner loopback.
The browser uses placeholder Supabase public configuration and blocks every
request outside `http://127.0.0.1:4173`. The check never authenticates, writes to
an external service, or opens a Vercel Preview.

This gate validates the built PR artifact's basic login experience. It does
**not** validate Vercel Preview configuration, staging Supabase connectivity,
production deployment health, database migrations, or rollback. It does not
deploy or promote Production and does not automatically roll back a release.

## Trust boundaries

- `.github/workflows/food-taster.yml` runs from `pull_request`. Its quality job
  executes PR-controlled code on a runner with `contents: read` only. It has no
  Environment, Vercel/GitHub App secrets, writable checks/statuses, artifacts,
  shared cache, or OIDC permission.
- `.github/workflows/food-taster-trusted.yml` runs on `workflow_run`. GitHub
  starts it only when this definition exists on the default branch. The
  controller ignores caller conclusions and artifacts. It looks up the
  workflow run and current PR through GitHub's API, requiring the expected
  workflow ID, `pull_request` event, one open PR to this repository's `main`,
  and an unchanged full head SHA.
- Trusted quality checks execute the exact validated PR SHA on a separate
  runner with no secrets, publisher permission, shared filesystem, cache or
  artifacts. The local Playwright browser can contact only the runner's
  loopback server. No PR-controlled code receives a Vercel or GitHub App token.
- The trusted workflow never resolves, opens, or sends credentials to a PR
  Preview. There is no OIDC or deployment-protection bypass path.
- A dedicated GitHub App publishes the `Food Taster gate` Check Run. The
  controller revalidates the PR before creating it and before finalizing it.
  It marks success only if the PR remains open at the same SHA and the complete
  trusted quality job succeeds. A missing, incomplete, stale, failed, cancelled
  or skipped result cannot satisfy the required check. The App identity is
  checked on both API responses so a same-named check from another publisher
  is not accepted.

## Required external setup

The following configuration is external to this repository and has not been
verified by this change. Until it is completed and tested, treat the production
gate as inactive.

1. Create the dedicated GitHub App and install it only in this repository. Give
   it only `Checks: write` and `Metadata: read`.
2. Create protected GitHub Environment `food-taster-publisher`, configure a
   trusted reviewer, and keep these values in that Environment only:
   - Variable `FOOD_TASTER_GITHUB_APP_ID` with the numeric App ID.
   - Variable `FOOD_TASTER_GITHUB_APP_CLIENT_ID` with the App client ID.
   - Secret `FOOD_TASTER_GITHUB_APP_PRIVATE_KEY` with its private key.
   The workflow mints an installation token limited to this repository and
   `Checks: write`; it never grants `statuses: write` to `GITHUB_TOKEN`. Both
   creation and finalization use the protected publisher Environment.
3. Configure `main` to require pull requests and the exact Check Run
   `Food Taster gate`, with its source restricted to the dedicated GitHub App.
   Require trusted owner review for changes to workflows, agent/ship
   instructions, the GitHub controller, smoke test and this document. Do not
   add a temporary bypass while bootstrapping the rule.
4. Configure Vercel independently so Production deploys only from reviewed
   updates to `main`. Configure a separate staging Supabase project for Vercel
   Preview and never put production credentials/data in Preview. Those
   deployments are not tested by this gate. Never put a service-role key in a
   `VITE_*` variable.

## Fail-closed behavior and limits

- A `workflow_run` controller is inactive until its file is present on the
  default branch. Local repository changes alone do not protect Production.
- Missing GitHub metadata, ambiguous PR association, wrong workflow, changed
  head SHA, closed PR, API error, missing Environment approval, missing App
  credentials, or failed/ambiguous quality result prevents a successful gate.
- If a PR head changes during a run, the finalizer refuses success for the old
  SHA. The new SHA remains blocked until its own trusted run completes.
- Forks may not be able to access private head repositories or approved
  Environments. Such runs fail closed; do not use `pull_request_target` to work
  around that restriction.
- This gate reduces the chance of a broken application change reaching users.
  It cannot guarantee a bug-free release and does not roll back Production or
  protect data migrations by itself. Production rollback and database recovery
  require separate, tested release procedures.
