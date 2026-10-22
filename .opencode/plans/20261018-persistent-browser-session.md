# Implementation plan — Persistent browser session

- Plan ID: `20261018-persistent-browser-session`
- Task ID: `20261018-210046-persistent-browser-session`
- Original user request: "Hola, me gustaría trabajar en una funcionalidad súper importante y súper interesante, que es la funcionalidad, es que yo estuve viendo allí en la empresa y básicamente los usuarios cada vez que entran a la aplicación tienen que iniciar sesión. Así que me gustaría que hubiera una perduración de la sesión en el navegador, al menos de que el usuario decida cerrarla. Ya ahí la sesión se perdería. Por ejemplo, que si un usuario cierra la sesión en el sistema y entonces se le apaga la computadora, se va la luz, o si es en el navegador y apaga su computadora y vuelve a abrir la computadora y vuelve a abrir el navegador, su sesión está iniciada. O sea, como que algo como una perduración en el inicio de sesión. Y ya, pero si cierra sesión, entonces ahí ya se cierra. pero como que la sesión perdure en el navegador, ¿sabes? Como un sistema normal, como un sistema profesional. Tienes, tienes que tener cuidado también con que haces cualquier cosa, porque también en este mismo proyecto estoy ejecutando otro agente, básicamente otro chat lateral tuyo, que básicamente es un agente para implementar la funcionalidad CDC. ¿Me entiendes? Para que no vengas con lo de él y no dañes nada."
- Execution authorization: User approved implementation after the plan was presented.
- Baseline commit: `2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb`.
- Revalidation: existing worktree remains broadly dirty; `src/pages/lobby.jsx` has pre-existing profile-error handling and accessibility changes. Keep every existing unrelated hunk intact.
- STATUS: DRAFT

## Summary

After successful password, profile/account, and applicable admin MFA validation, promote the validated session from tab-scoped `sessionStorage` to persistent `localStorage`. Keep the candidate session temporary through every validation step. If persistent storage is inaccessible or a write fails, retain the candidate in session storage and allow login to continue in the current tab. Global logout continues to remove auth credentials and remember preference from both stores.

## Implementation changes

- `supabaseClient.js`: Harden storage availability and preference access so blocked storage getters/operations do not throw. On persistence promotion, read the active session item from `sessionStorage`, write it successfully to `localStorage` first, then enable the shared remember preference, clear the tab-only marker, and remove the temporary copy only when safe. If local storage is unavailable or write fails, leave the temporary session readable and the tab in session-only mode. Make global cleanup best-effort across both stores so a blocked store cannot prevent cleanup in the accessible store.
- `src/pages/lobby.jsx`: Invoke promotion only after `loadUserProfile`, inactive-account rejection, and `requireAdminMfa` have all completed successfully, before success messaging and protected-route navigation. Preserve the existing candidate cleanup and restoration behavior on profile/account/MFA failure and invalid credentials. Do not add login controls or alter auth policy.
- `src/__tests__/supabase-client-storage.test.js`: Cover session transfer and ordering, preference activation only after successful copy, temporary fallback on denied local storage, storage access exceptions, preservation of an older remembered credential on rejected temporary login, and global cleanup of available stores.
- `src/__tests__/login-security.test.jsx`: Cover promotion only after all login validation, including admin MFA; no promotion for rejected credentials, unavailable/inactive profile, or failed MFA; and restoration of the prior remember mode after failed attempts.

## Interfaces and data flow

- No public API or UX changes. Keep the existing `setAuthSessionPersistence(boolean)` helper contract.
- Candidate auth remains in the existing custom adapter's selected session store while validation runs. Successful promotion copies the existing Supabase auth storage value before switching the adapter's preference. On storage failure, the session-only tab marker keeps the adapter selecting `sessionStorage`.
- Existing global `signOutAuth` calls `clearAuthSessionStorage`; retain that integration and make its storage operations best-effort.

## Acceptance criteria

- A validated login survives a browser restart when local storage is available.
- The candidate session is not made persistent before profile/account and applicable MFA checks pass.
- Failed credentials do not sign out or overwrite a previously remembered session.
- A candidate rejected after authentication is locally cleaned, and the prior remember preference is restored.
- Denied persistent storage does not throw or prevent current-tab login; the session remains session-scoped.
- Global logout attempts to remove auth data and preference from both stores, without a storage exception preventing logout cleanup elsewhere.
- The final diff changes only the allowed application/test paths and preserves all pre-existing changes, including concurrent CDC work.

## Scope and exclusions

- Allowed paths: `supabaseClient.js`, `src/pages/lobby.jsx`, `src/__tests__/login-security.test.jsx`, `src/__tests__/supabase-client-storage.test.js`, and task evidence under `.opencode/runs/20261018-210046-persistent-browser-session/`.
- Excluded: CDC changes; unrelated dirty files or hunks; `src/ProtectedRoute.jsx`, `src/contexts/AuthProvider.jsx`, and unrelated tests; database migrations; APIs, authorization policy, roles, MFA policy, deployment configuration, and new login UI.
- If implementing this requires changes outside allowed paths, stop and report the specific dependency before expanding scope.

## Risks and required checks

- Security risk: a partially switched store could leave the current candidate unreadable or expose/overwrite another tab's credential. Copy must succeed before preference changes, and candidate cleanup must remain scoped to the session-only tab.
- Storage APIs may throw both when retrieving `window.localStorage`/`window.sessionStorage` and during operations; guard acquisition and operations independently. Do not log or expose token values.
- Existing Supabase expiry, refresh-token revocation, account status, and server policy can still require a fresh login.
- Tester: targeted storage/login tests for happy, rejected-validation, and denied-storage paths; run the applicable project lint, security check, and build required by the project workflow.
- Security Auditor: required because the change affects authentication credential storage and logout cleanup.
- Food Taster and independent Reviewer: required after Tester and Security Auditor. Reviewer compares request, plan, task evidence, and final diff.
- Visual QA and Playwright: not required; there is no rendered UI change and browser automation was not requested.
