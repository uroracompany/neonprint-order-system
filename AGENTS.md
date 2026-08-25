# NeonPrint — Mandatory OpenCode Change Workflow

This is a permanent project rule. For **every user request that changes** source
code, tests, configuration, documentation, database migrations, APIs, styles or
deployment files, follow this workflow. Do not edit the repository directly from
the primary chat before it has completed.

Read-only requests (questions, explanation, status, audit or code review without
requested edits) do not create a run. If a request contains both analysis and a
change, it is a change request and the workflow is mandatory.

## Direct operational commands

An explicit user request to run a command or carry out an operational action is
an exception to the development workflow. Examples include Git status/commit/
sync, fetch/pull/push, tests, builds, installs, starting or stopping the local
application, and a named terminal command. Execute it directly; do **not** demand
a task ID, plan, `SHIP` verdict or a handoff just to run that command.

If the user explicitly says **all changes**, stage all current non-ignored changes
with `git add -A` and proceed with the requested commit/synchronization. If they
name files or a subset, use those exact paths. Do not ask them to repeat a choice
that is already clear in the request. OpenCode may still request its normal tool
approval before running the command.

For dangerous operations (force-push, reset, rebase, clean, destructive delete,
history rewrite or remote deletion), require an explicit target and confirmation.
This safety check does not apply to ordinary commit, fetch, pull, push, test,
build or local-dev commands that the user directly requests.

## Plan-only workflow and later execution

A request to **plan**, **analyze before implementing**, **design a solution** or
**prepare a plan** is a plan-only request. It must not edit application code,
tests, migrations or operational configuration. Run this shorter workflow:

```text
Analyst → Planner → Plan Reviewer → wait for explicit execution request
```

Create normal ephemeral evidence under `.opencode/runs/<task-id>/`, then publish
the durable draft to `.opencode/plans/<plan-id>.md` and its independent review to
`.opencode/plans/<plan-id>.review.md`. A plan must record its ID, original user
request, baseline commit, affected files, acceptance criteria, risks, required
specialist checks and `STATUS: DRAFT`. The plan reviewer must issue either
`VERDICT: READY FOR EXECUTION` or `VERDICT: BLOCK`.

Never implement a plan merely because it was created. Only an explicit later
request such as “ejecuta el plan <plan-id>” authorizes execution. On that request,
locate the exact ready plan and review, create a fresh execution run, and repeat
the Analyst and Planner stages to revalidate it against the current worktree.
Then run the complete change workflow below. If no unambiguous ready plan is
named, ask the user which plan to execute.

## Non-negotiable sequence

1. **Analyst** — clarify objective, scope, assumptions, risks and acceptance
   criteria. If a critical decision is missing, stop and ask the user.
2. **Planner** — inspect relevant code and write an exact implementation plan.
3. **Coder** — make only the approved scoped changes.
4. **Tester** — run and/or add tests for happy path, edge case and failure path.
5. **Conditional specialist** — run `visual-qa` for any rendered UI change;
   run `security-auditor` for auth, permissions, API, SQL, RLS, secrets, Storage,
   payment, tracking or destructive-operation changes. Run both when applicable.
6. **Reviewer** — independently inspect the final diff and issue `SHIP`,
   `NEEDS WORK` or `BLOCK`.

## Playwright on demand

Do **not** start the app or launch Playwright by default. Run browser automation
only when the user explicitly asks to: “revisa con Playwright”, “prueba con
Playwright”, “ejecuta Playwright”, “corre/abre la aplicación” or an unambiguous
equivalent.

When requested, the Analyst must mark `PLAYWRIGHT: REQUIRED` in `analysis.md`.
After Tester and any applicable Visual QA/Security Audit, run the `playwright-qa`
subagent before the final Reviewer. It must validate only the requested route and
flow, take snapshots before using element references, re-snapshot after UI state
changes, and write its outcome to `playwright-results.md`.

Playwright evidence belongs in `output/playwright/` and the task directory. Do
not use production credentials, perform external writes, create durable E2E test
files, or claim a browser pass when the application could not be started.

No stage may be skipped, reordered or combined. A failed or missing handoff stops
the workflow. The Coder is the only stage allowed to alter application code.

## Isolated task evidence

At the start of each change create a new directory:

```text
.opencode/runs/<unique-task-id>/
  manifest.md
  analysis.md
  plan.md
  changes.md
  test-results.md
  visual-results.md        # UI changes only
  security-results.md      # sensitive changes only
  review.md
```

Use a unique timestamp-plus-slug task ID. Do not use `.pipeline/` for new work;
it contains historical shared artifacts only. Pass the exact `TASK_DIR` to every
subagent. The manifest must preserve the user's original request, baseline commit,
allowed paths, scope exclusions and acceptance criteria.

## Required safeguards

- Every stage reads `.opencode/context/neonprint-business-context.md` and the
  relevant canonical source before acting.
- Never silently expand scope. Any required out-of-scope change returns to the
  user for approval.
- Preserve unrelated local changes. Record `git status --short` and baseline
  commit in `manifest.md` before editing; do not reset, stash, revert or overwrite
  changes not made by this task.
- Never expose secrets or use service-role credentials in browser code.
- Never run destructive production operations, remote migrations, deletes, purge,
  deploys or external writes unless the user explicitly requests them.
- A reviewer must compare the original request, plan, evidence and actual
  `git diff`, not merely accept passing tests.

## Commit and remote synchronization on explicit request

Commit and remote synchronization are never automatic. When the user explicitly
requests them, the Orchestrator performs them directly after OpenCode asks for
approval of the relevant Git command; a `SHIP` verdict is not required for this
operational request.

- Stage only task-owned paths with `git add -- <paths>` by default. When the user
  explicitly requests **all changes**, use `git add -A`; otherwise never use
  broad staging or `git commit -a`.
- Inspect `git status` and staged `git diff` before committing. Do not include
  `.env*`, Playwright artifacts, task evidence or unrelated local changes.
- `fetch`, `pull` and `push` require an explicit user request and approval.
- Never use `push --force`, `reset`, `rebase`, `stash`, history rewriting or
  remote deletion. Stop and report merge conflicts or non-fast-forward state.
- If the user does not provide a commit message, use a concise message describing
  only the reviewed task.

## Completion standard

Report the final verdict, changed files, verification evidence and any remaining
risks. `SHIP` means all required stages completed and the diff stays within the
approved scope. `NEEDS WORK` or `BLOCK` means do not present the request as done.
