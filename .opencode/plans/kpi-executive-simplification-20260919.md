# Plan: KPI executive simplification

- **Plan ID:** `kpi-executive-simplification-20260919`
- **STATUS:** DRAFT
- **Source audit:** `20260919012411-kpi-simplification-audit`
- **Original request:** Analyze the Administrator KPI module and propose simplification without implementation.
- **Baseline commit:** `a5e548cbebe259433c514a46f7265dc95c795407`

## Executive proposal

Replace the six-tab, multi-chart administrative KPI experience with a concise company overview: four decision cards (work in course, attention required, delivered in period, payment follow-up), one pipeline, one created-vs-delivered trend and an actionable list limited to five urgent cases. Keep Orders, Clients, Production and Equipo as lazy-loaded secondary analysis. Move Materials into a substantially reduced Production context. Equipo remains a dedicated department → person activity workspace. Preserve all data/RPC/role contracts in the first implementation; optimize the broad `action: all` payload only after the new view is in place.

## Affected architecture

- Entry/UI: `KPIModule`, header, overview cards, pipeline/trend/attention components and KPI CSS.
- Data: `useKPI`, workspace persistence and server `kpi-data-handler`.
- Security: retain API proxy plus `requireAdmin`, server-side service-role use and admin-only RPCs.
- No first-pass database migration is planned unless existing executive summary cannot serve a concise overview.

## Acceptance criteria

1. One screen answers: current workload, what needs attention, delivery outcome and payment follow-up, using existing count metrics only; it makes no payment-operation or monetary-balance change.
2. No duplicated pipeline or multiple visual encodings of the same metric on the default route.
3. Summary query is lean; secondary data loads only when requested.
4. Current-vs-period semantics and client metric definitions remain correct.
5. Authorization, role behavior, caching, realtime invalidation and accessibility are covered by tests.

## Risks and required specialist checks

- **Confirmed product decisions:** Materials becomes a simplified Production context; Equipo remains a secondary KPI tab, focused on department/person activity.
- **Data/performance:** benchmark `action: all` replacement against representative production volume and validate no 5,000-row truncation becomes visible data loss.
- **Security:** security audit is required because the API query shape and potentially RPC access path will change.
- **Visual QA:** required because the rendered administrator UI will change.
- **Playwright:** only if explicitly requested in the execution request.

## Execution outline

1. Revalidate this plan against a clean/current worktree.
2. Implement the concise overview without deleting backend/data contracts.
3. Lazily query secondary analyses.
4. Add and run targeted tests plus lint, security check and build.
5. Run visual QA and security audit; complete independent review.
