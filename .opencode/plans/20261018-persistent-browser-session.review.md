# Independent plan review — Persistent browser session

- Task: `20261018-210046-persistent-browser-session`
- Plan: `20261018-persistent-browser-session`
- Reviewer role: independent Plan Reviewer
- Verdict: **READY FOR EXECUTION**
- Reviewed: business context, manifest, revalidated analysis, task plan, durable draft, canonical auth storage/login sources, relevant current diffs, and current worktree status.

## Findings

1. The requested behavior is correctly translated into temporary candidate authentication followed by persistence only after profile/account and applicable administrator MFA checks succeed. The proposed transfer order—copy session data first, then enable the shared remember preference—avoids making an incomplete copy authoritative.
2. The plan preserves the existing auth manager and Supabase custom storage adapter contract, keeps the change within the approved auth/login/storage test files, and excludes CDC work, migrations, role policy, deployment configuration, and unrelated dirty files.
3. The storage failure behavior is appropriately best-effort: persistent storage denial should leave the candidate in the tab store and permit current-tab use; storage exceptions must not escape auth adapter or logout cleanup paths. No credential values should be logged.
4. One concrete existing-path detail must be honored during implementation: the inactive-account branch in `src/pages/lobby.jsx` locally signs out and returns before restoring `previousSessionPersistence`. The acceptance criteria already require restoring the previous mode after candidate rejection, so the coder must add that restoration there and cover it in `src/__tests__/login-security.test.jsx`; do not assume the existing branch already does so.
5. Current diffs show pre-existing unrelated edits in `src/pages/lobby.jsx` and broad changes elsewhere. The plan identifies preservation requirements and an allowlist. The coder must edit narrowly and compare final hunks with the baseline; no whole-file replacement or cleanup of unrelated changes.

## Review conclusion

No architectural or product decision blocks implementation. The inactive-account restoration observation is covered by the plan's acceptance criteria and is an implementation check, not a scope expansion. Proceed with the stated allowlist and required Tester, Security Auditor, Food Taster, and final Reviewer stages.

