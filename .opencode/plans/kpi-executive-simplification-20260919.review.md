# Plan reviewer — KPI executive simplification

## Evidence reviewed

- Original analysis-only request.
- Business context for KPI meaning, role restrictions and data rules.
- Current `KPIModule`, `useKPI`, KPI components, workspace persistence, API proxy and server handler.
- The documented plan and current worktree baseline.

## Review

The proposal removes visual and fetch complexity before deleting any data contract. It preserves the critical separation between snapshots and period measures, does not rely on client metadata for authorization, and keeps all KPI retrieval behind the existing administrator gate. The staged approach reduces regression risk: information is first moved/lazy-loaded, then candidates may be retired only after consumer verification.

The main implementation risk is changing the broad `action: all` query. That must be accompanied by authorization, cache/realtime, schema-compatibility and production-volume tests. Product direction is now explicit: Materials moves into a simplified Production context, Equipo remains a department/person activity workspace, and payment data remains count-only with no change to payment operations or monetary balances.

## VERDICT: READY FOR EXECUTION

This is a draft plan only. It does not authorize implementation. A future explicit request must name `kpi-executive-simplification-20260919`, revalidate the plan against the then-current worktree, and run the full change workflow.
