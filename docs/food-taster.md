# Food Taster CI gate

Food Taster is a pre-merge gate for pull requests targeting `main`. The PR
workflow runs security checks, lint, Vitest and a production build on the exact
PR head. A separate trusted workflow resolves the isolated Vercel staging
Preview for that exact SHA, then checks only the anonymous public login shell.
The smoke does not authenticate, submit forms, read business data, or write to
any service.

## Isolated smoke and deployment discovery

The trusted controller reads GitHub metadata only. It verifies that the PR is
still open, targets this repository's `main`, and retains the validated head
SHA and repository. It then reads the exact SHA's commit statuses and PR issue
comments. It accepts only the unique context
`Vercel – neonprint-order-system-food-taster`; it never selects the production
project's `Vercel – neonprint-order-system` status.

The project-specific status target must be an HTTPS Vercel inspector URL for
team `urora-companys-projects`, project
`neonprint-order-system-food-taster`, and a syntactically valid deployment ID.
The matching Ready row must occur in a comment authored by GitHub's verified
`vercel[bot]` identity (id `35613825`) and point to the same team, project, and
deployment ID. The GitHub commit status itself is treated as untrusted status
data; no creator field is required. The resolver never follows URLs from the
comment. It extracts only the matching deployment and preview cells from the
Vercel deployment table.

The resolver reads `head.ref` from the current PR and ties the Preview hostname
to that exact branch slug. Vercel branch aliases use
`neonprint-order-system-food-taster-git-<branch>-urora-companys-projects.vercel.app`;
the resolver rejects aliases for any other branch, the production project,
custom domains, and generic `neonprint-order-system-*` hosts. The stable
`neonprint-order-system-food-taster.vercel.app` alias is accepted only for the
staging project's configured Production Branch,
`codex/food-taster-preview-runner`. URLs must be HTTPS root URLs with no
credentials, port, path, query, or fragment.

The project and branch aliases are mutable; a matching alias is not an
immutable deployment URL. Vercel's current PR comment metadata does not expose
a unique commit-pinned preview URL, so the resolver correlates the exact SHA's
status and deployment ID with the comment, verifies its branch against
`head.ref`, and rechecks the metadata around the smoke. A deployment-specific
immutable URL would be preferable if Vercel exposes one in the integration
metadata later. Immediately after resolving the status/comment,
the controller re-reads the PR and all deployment metadata and requires the
same status ID, deployment ID, Vercel comment ID, and Preview URL. After the
Playwright smoke it repeats resolution and compares the same URL and IDs with
the values used by the browser. This detects PR changes and metadata movement
during the run. It cannot cryptographically pin DNS or prevent an external
deployment alias from moving in the tiny interval between requests. Keep the
dedicated staging project's Production Branch off `main` and keep that project
free of production domains, credentials, production variables, and business
data. If the branch restriction or Vercel metadata is in doubt, the gate must
remain failed.

The browser smoke uses trusted Playwright code/configuration from the default
branch. It sends no GitHub token, App token/private key, Vercel token, bypass
secret, OIDC token, cookie, Supabase key, or artifact to the Preview. Route
interception allows only anonymous root navigation and same-origin static
assets via GET/HEAD; it blocks APIs, auth/data paths, writes, other origins and
WebSockets. This static smoke does not need Supabase credentials or a Supabase
staging project. Business-flow tests must use separately reviewed synthetic
staging data and a separate credential boundary.

## Trust boundaries

- `.github/workflows/food-taster.yml` runs from `pull_request`. Its quality job
  executes PR-controlled code on a runner with `contents: read` only. It has no
  Environment, Vercel secrets, publisher credentials, writable checks/statuses,
  artifacts or shared cache.
- `.github/workflows/food-taster-trusted.yml` runs on `workflow_run`. GitHub
  starts it only when the workflow is present on the default branch. The
  controller validates the originating run and current PR using GitHub's API.
- Quality checks and the browser smoke run on separate runners. The smoke
  runner checks out controller code from the default branch and has only
  `contents: read`, `pull-requests: read`, and `statuses: read`. It has no App
  publisher credentials, Vercel secrets, OIDC permission, deployment write,
  shared filesystem, cache or artifacts from the PR-controlled quality job.
- A dedicated GitHub App publishes the `Food Taster gate` Check Run from the
  protected `food-taster-publisher` Environment. The controller revalidates the
  PR before creating and finalizing the check. It marks success only if the PR
  remains open at the same SHA and both isolated quality and smoke jobs succeed.
  Missing, incomplete, stale, failed, cancelled or skipped results cannot pass.
  The App identity is verified so a same-named check from another publisher
  cannot satisfy the gate.

## Required GitHub and Vercel configuration

1. Keep the separate Vercel project `neonprint-order-system-food-taster`
   connected to `uroracompany/neonprint-order-system`. It must contain no
   production domain, production variables, secrets or business data. Keep its
   Production Branch set to `codex/food-taster-preview-runner`, never `main`.
   Its Preview deployments must be publicly reachable without a bypass token;
   the browser test is intentionally anonymous and read-only.
2. Install the dedicated GitHub App only in this repository. Give it only
   `Checks: write` and `Metadata: read`. The protected GitHub Environment
   `food-taster-publisher` must hold:
   - Variable `FOOD_TASTER_GITHUB_APP_ID` with the numeric App ID.
   - Variable `FOOD_TASTER_GITHUB_APP_CLIENT_ID` with the App client ID.
   - Secret `FOOD_TASTER_GITHUB_APP_PRIVATE_KEY` with the App private key.

   The workflow mints a token limited to this repository and `Checks: write`;
   `GITHUB_TOKEN` never gets `checks: write` or `statuses: write`.
3. Configure `main` to require pull requests and the exact `Food Taster gate`
   Check Run from the dedicated GitHub App. Keep `Quality checks` required,
   require current branch status where supported, and do not add a bypass.
   Require trusted owner review for changes to workflows, agent/ship
   instructions, the resolver, GitHub controller, browser policy/smoke and this
   document.
4. Verify the GitHub rule and Vercel project settings in their consoles before
   claiming that production is protected. Passing workflow code alone does not
   prove that a branch rule is active.

## Scope and limits

- The smoke proves only that the anonymous login shell and allowlisted static
  assets load in the isolated Preview. It does not exercise changed business
  modules, authentication, APIs, database behavior, Supabase/RLS, server
  functions, or runtime health after merge. Changes in behavior still need
  focused unit/integration coverage and relevant browser coverage.
- This gate blocks merging changes that fail its pre-merge checks only when its
  workflow is on the default branch and the GitHub required-check rule is active.
  It does not automatically roll back a production deployment, migration or
  data change after merge. Production rollback is a separate deployment
  capability and must be verified independently.
- Forks may not be able to access private head repositories. Those runs fail
  closed; do not use `pull_request_target` or expose secrets as a workaround.
