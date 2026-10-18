# Food Taster CI gate

Food Taster is intended to block a pull request to `main` unless trusted quality
checks and the isolated Vercel Preview smoke both pass. It uses two workflows
with different trust boundaries:

- `.github/workflows/food-taster.yml` is triggered by `pull_request`. It checks
  the exact PR head with security checks, lint, Vitest, build, and a loopback
  browser smoke. This workflow executes PR-controlled code, so it has only
  `contents: read` and must not resolve or visit a Vercel Preview.
- `.github/workflows/food-taster-trusted.yml` is triggered by `workflow_run`
  and uses the copy of the controller on the default branch. Its `quality` job
  runs the PR head without secrets and performs the same local smoke. Its
  separate `preview-smoke` job checks out only `${{ github.sha }}` from the
  default branch, installs dependencies from that trusted revision, then runs
  the Preview resolver and Playwright suite. It never checks out or executes
  PR source code. The publisher finalizes `Food Taster gate` successfully only
  when both trusted `quality` and `preview-smoke` succeed.

## Ruleset rollout state

The current `main` ruleset still requires the direct `Quality checks` status
from `.github/workflows/food-taster.yml`. A PR can edit its own direct workflow,
so that check alone is not a tamper-resistant trust root. The trusted controller
and its new Preview job do not become active until the controller change is
published on the default branch. Keep the current ruleset unchanged during this
rollout; after the trusted workflow is present on the default branch and its
App-published `Food Taster gate` has been verified, update the ruleset to require
that trusted check before removing the direct `Quality checks` requirement.
Until then, do not treat this PR branch's direct check as the trusted gate.

## Critical Preview safety prerequisite

**Pause Vercel Preview deployments while any Production Supabase credential is
available to Preview. Do not run the Preview smoke during that period.** The
observed Vercel configuration shared Supabase variables with Production,
including `SUPABASE_SERVICE_ROLE_KEY`. PR-controlled code runs in a Vercel
Preview and could expose Production data if those credentials are present.

The resolver inspects the exact Preview's compiled HTML and JavaScript for the
configured staging URL and anon key, and for the configured Production URL. It
cannot inspect or prove Vercel's server-side variable scopes, including the
scope/value of `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_URL`. A passing resolver
is therefore not evidence of server-side isolation.

## Required GitHub repository variables

The trusted Preview job consumes these five GitHub **repository variables**:

| Variable | Purpose |
| --- | --- |
| `FOOD_TASTER_STAGING_SUPABASE_URL` | HTTPS URL of the isolated staging Supabase project. |
| `FOOD_TASTER_STAGING_SUPABASE_ANON_KEY` | Public anon key for staging. Never use a service-role key. |
| `FOOD_TASTER_PRODUCTION_SUPABASE_URL` | Production URL, used to reject equality with staging and detect it in client assets. |
| `FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED` | Manual safety attestation. Must equal the literal `true` before the resolver makes any GitHub API or Preview request. |
| `FOOD_TASTER_VERCEL_PROJECT_ID` | Expected Vercel project ID. The resolver accepts deployment metadata only when `deployment.payload.projectId` exactly matches. |

The PR workflow does not receive these values. The trusted Preview job has only
read permissions for repository contents, deployment metadata, and pull-request
metadata. It receives no Vercel token, service-role key, or GitHub App token.

## GitHub App publisher Environment

The trusted controller publishes its check through the GitHub App installed on
this repository. Configure the `food-taster-publisher` GitHub Environment with
these values:

| Kind | Name | Purpose |
| --- | --- | --- |
| Environment variable | `FOOD_TASTER_GITHUB_APP_ID` | Numeric ID of the Food Taster GitHub App. |
| Environment variable | `FOOD_TASTER_GITHUB_APP_CLIENT_ID` | Client ID used to mint a short-lived installation token. |
| Environment secret | `FOOD_TASTER_GITHUB_APP_PRIVATE_KEY` | PEM private key for that App. Never commit or print it. |

The App installation must be limited to this repository and have `Checks: write`
and `Metadata: read`. The workflow mints a short-lived, repository-scoped token
for the Check Run; the Preview smoke job never receives it. An Environment rule
that requires a human reviewer needs a separate eligible reviewer; without one,
the publisher jobs remain pending and the Food Taster check cannot complete.
No human reviewer is required by the CI/CD pattern itself.

## External setup before Preview smoke

1. Create or select a **separate Supabase staging project** with disposable
   accounts and data. Do not copy Production data unless separately reviewed
   and sanitized.
2. Add the five GitHub repository variables above. Set `FOOD_TASTER_VERCEL_PROJECT_ID`
   to the project ID shown for the NeonPrint project in Vercel. Confirm the
   staging and Production URLs are different HTTPS `*.supabase.co` project
   origins.
3. In Vercel, scope Production Supabase values to **Production only**. Configure
   Preview with staging values for `VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, and
   `SUPABASE_SERVICE_ROLE_KEY`. Confirm no Production credential is available
   to Preview. Keep the service-role key server-side; never expose it through a
   `VITE_*` variable or browser bundle.
4. Verify the Vercel environment scopes and values directly without exposing
   secret values. If any Production credential remains available to Preview,
   pause Preview deployments and keep the attestation unset or not equal to
   `true`.
5. Only after the direct verification confirms Preview uses staging values and
   has no Production credentials, set
   `FOOD_TASTER_PREVIEW_ISOLATION_CONFIRMED` to exactly `true`. This is an
   operator attestation, not an automated verification of Vercel scopes. The
   resolver fails before `fetch` when it is missing or differs from the exact
   string `true`.
6. Keep Vercel Preview protection enabled unless the trusted runner can access
   the deployment without a bypass credential. Missing staging configuration,
   an unavailable/ambiguous deployment, or a Preview that fails isolation
   checks fails the trusted check.

## What the trusted Preview smoke does

The trusted controller validates the current open PR targets this repository's
`main` and still has the exact checked head SHA. The Preview job uses read-only
GitHub API access to find the successful Vercel deployment for that SHA. Before
starting a browser, it fetches the Preview HTML and JavaScript as static text
and verifies the expected staging URL and anon key are present and the
configured Production URL is absent. It requires the deployment's direct
`payload.projectId` value to equal `FOOD_TASTER_VERCEL_PROJECT_ID`; missing or
mismatching metadata fails closed. It does not infer a project ID from other
payload shapes. Resolver and Playwright configuration also reject nonstandard
URL ports.

The trusted Playwright test renders the login page and makes only a `GET` to the
staging Supabase Auth settings endpoint. Browser requests are restricted to the
Preview origin and that staging endpoint. It does not sign in, submit forms,
call application APIs, write data, or run migrations. Preview content is
PR-controlled, so this job must remain trusted controller code and may run only
after staging isolation has been manually verified.

The gate does not verify Vercel's server-side variable scopes, database
migrations, Production health, or rollback. It reduces the chance of a broken
change reaching users but cannot guarantee a bug-free release or restore
Production data. Production rollback and database recovery require separate,
tested release procedures.
