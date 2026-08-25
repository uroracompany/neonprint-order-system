Create and review a durable NeonPrint implementation plan for: $ARGUMENTS

This is planning only: do not invoke the Coder, Tester, Visual QA,
Security Auditor or final Reviewer, and do not edit application code, tests,
migrations or operational configuration.

Create a unique task directory at `.opencode/runs/<task-id>/` and a unique
durable plan file at `.opencode/plans/<plan-id>.md`. Write a manifest with the
original request, baseline commit, worktree status and scope exclusions. Then run
these stages in sequence, passing both `TASK_DIR` and `PLAN_FILE`:

1. `analyst` — stop on `BLOCKED: USER DECISION`.
2. `planner` — create the task plan and publish the durable draft.
3. `plan-reviewer` — write `<plan-id>.review.md`.

Report the plan ID and review verdict. If the verdict is ready, wait for an
explicit user request to execute that exact plan; never continue automatically.
