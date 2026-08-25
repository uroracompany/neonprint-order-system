Run the mandatory NeonPrint change workflow for: $ARGUMENTS

This command is mandatory for every requested repository change. Do not directly
edit files, skip stages or merge. First create a unique timestamp-plus-slug
directory at `.opencode/runs/<task-id>/` and write `manifest.md` with the exact
user request, `git status --short`, baseline commit, initial allowed paths, scope
exclusions and acceptance criteria. Pass that exact path as `TASK_DIR` to every
subagent.

Run and wait for the following stages in order:

1. Delegate to `analyst`. Stop if `analysis.md` contains `BLOCKED: USER DECISION`.
2. Delegate to `planner`. Stop for OPEN QUESTIONS or a missing `plan.md`.
3. Delegate to `coder`. Stop for a missing `changes.md`.
4. Delegate to `tester`. Stop if tests fail or `test-results.md` is missing.
5. If the analysis classifies any rendered UI as affected, delegate to
   `visual-qa`. Stop if it fails or `visual-results.md` is missing.
6. If the analysis classifies auth, roles, API, SQL, RLS, Storage, payments,
   public tracking, secrets or destructive operations as affected, delegate to
   `security-auditor`. Stop if it returns `NEEDS WORK`, `BLOCK`, or its evidence
   file is missing.
7. Only if the user explicitly requested Playwright/browser verification or
   `analysis.md` contains `PLAYWRIGHT: REQUIRED`, delegate to `playwright-qa`.
   Stop if it fails or `playwright-results.md` is missing.
8. Delegate to `reviewer` with all evidence. Report its final verdict.

Every stage must read the `neonprint-domain-context` skill or
`.opencode/context/neonprint-business-context.md`. `SHIP` is valid only when all
required artifacts exist and the Reviewer confirms the actual diff is in scope.
