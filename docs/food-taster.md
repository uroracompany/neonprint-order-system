# Food Taster CI gate

Food Taster adds an isolated code-verification gate before a pull request can
merge to `main`. It does not connect to Vercel Preview or Supabase, use
Production credentials, or make external writes.

## Workflows and trust boundaries

- `.github/workflows/food-taster.yml` runs on `pull_request`. It checks security
  configuration, lint, Vitest, build, and a loopback browser smoke. Since this
  workflow executes PR-controlled code, it has read-only repository access and
  no App credentials.
- `.github/workflows/food-taster-trusted.yml` runs after that workflow
  completes. The controller is loaded from the default branch and validates the
  source workflow, open PR targeting `main`, and exact current PR head SHA. Its
  `quality` job checks out that exact SHA with checkout credentials disabled and
  only `contents: read`. It runs security checks, lint, Vitest, build, then the
  loopback smoke with placeholder Supabase settings. It has no Supabase or
  Vercel credentials and does not contact those services.
- The dedicated GitHub App publishes the `Food Taster gate` Check Run. It is
  successful only when the trusted quality job succeeds and the finalizer
  revalidates the current PR and SHA. A failed, skipped, cancelled, missing, or
  stale result must fail closed.

The Playwright configuration always serves the built application on
`http://127.0.0.1:4173`, with `reuseExistingServer: false`. The smoke test
rejects requests outside that loopback origin. Placeholder values let the app
build without credentials; no test logs in, submits forms, calls external APIs,
writes data, or runs migrations.

## GitHub App publisher Environment

Configure the `food-taster-publisher` GitHub Environment with:

| Kind | Name | Purpose |
| --- | --- | --- |
| Environment variable | `FOOD_TASTER_GITHUB_APP_ID` | Numeric ID of the Food Taster GitHub App. |
| Environment variable | `FOOD_TASTER_GITHUB_APP_CLIENT_ID` | Client ID used to mint a short-lived installation token. |
| Environment secret | `FOOD_TASTER_GITHUB_APP_PRIVATE_KEY` | PEM private key for that App. Never commit or print it. |

Install the App only on this repository with `Checks: write` and metadata read
access. The publisher mints a short-lived, repository-scoped token only in its
publisher jobs. The code-verification job never receives that token. A human
approval rule on the Environment is optional and is not required by this CI
pattern.

## Branch protection rollout

During bootstrap, keep the existing `main` ruleset requiring pull requests and
the direct `Quality checks` status. That workflow is useful feedback, but a PR
can edit it, so it is not the trusted root. The trusted controller becomes
available only after its workflow is present on the default branch. Once it
runs for a PR, publishes `Food Taster gate`, and that Check Run is verified as
the expected GitHub App, update the `main` ruleset to require `Food Taster gate`.
Keep the pull request requirement. The ruleset may then stop requiring the
direct `Quality checks` status if the trusted gate fully replaces it.

Until that App check is visible, verified, and required in the `main` ruleset,
the Food Taster protection is not fully active. A green check on the feature
branch alone is not proof that the trusted gate protects Production.

## What this gate does not guarantee

This gate catches code quality, security-configuration, unit-test, build, and
local browser-smoke failures before merge. It does not verify deployment health,
database migrations, Production configuration, or automatic rollback. Those
require separate release and recovery procedures. Production secrets remain
configured only for Production; this workflow neither reads nor changes them.
