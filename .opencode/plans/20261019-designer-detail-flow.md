# Plan — Designer detail flow and history

**Plan ID:** `20261019-designer-detail-flow`  
**Original request:** Adapt the Designer order detail modal to show order statuses/progress, let the designer copy the customer tracking link, and show the participation history from Sales, while preserving Designer-specific actions and visual coherence. The user asked whether to clone Sales' modal or adapt Designer's modal.  
**Decision:** Adapt the existing Designer modal and reuse the relevant shared pieces/behavior; do not clone the whole Sales modal. This preserves Designer uploads, work-order details, references and guarded routing without duplicating sales-specific layout/actions.

## Summary and revalidated state

- Baseline and revalidated `HEAD`: `2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb`.
- Working tree contains substantial pre-existing concurrent changes, including CI/CD/CDC artifacts and dirty `src/pages/page-designer.jsx` and `src/components/orders/OrderDetailModal.jsx`. Preserve all pre-existing hunks and keep the final diff limited to this plan.
- The Designer modal is in `src/pages/page-designer.jsx`; Sales modal is `src/components/orders/OrderDetailModal.jsx` and already uses `FlowTracker`, `FlowTrackerExternal`, an inline tracking-link component, and `OrderParticipationTimeline`.
- Designer-created orders persist `seller_id = NULL`, `created_by = auth.uid()`, `designer_id = auth.uid()`, status `in_Design`. Profile RLS may hide unrelated creators, so route classification comes from the creation event in the authorized history RPC, not a frontend profile lookup or mutable assignment.
- Tracker constants are `FLOW_STEPS` (Pending → Diseño → Caja…) and `FLOW_STEPS_EXTERNAL` (Pending → Caja…). Existing Sales behavior remains the default.
- `get_order_participation_timeline(uuid)` is currently `SECURITY DEFINER`, has no order-level authorization check, and labels all creators Vendedor. Existing order read policy admits admin, order operator, direct participants, or an eligible producer via `producer_can_access_order(id)`.
- `src/hooks/useOrderParticipation.js` currently destructures `{ data, err }` from the Supabase RPC result even though the client returns `{ data, error }`; failures therefore look like empty history. Correct this as a required dependency and lock it with `src/__tests__/use-order-participation.test.jsx`.

## Implementation changes

- Adapt the existing Designer modal to include shared progress, copyable public tracking link, and participation history. Preserve all uploads/previews/references and existing save, send-to-Cashier, and guarded send-to-Production actions.
- Extract `OrderParticipationTimelineContent({ timeline, loading, error })` as presentational UI while keeping `OrderParticipationTimeline({ orderId })` as the Sales wrapper over `useOrderParticipation`. Designer calls `useOrderParticipation(order.id)` once and shares that result with the timeline content and route selection.
- Fix the hook's Supabase result handling in `src/hooks/useOrderParticipation.js`: destructure `{ data, error }` and throw `error`. On RPC failure, expose the error, clear timeline to `[]`, and finish loading. Add a regression test for this contract; Sales must display the error, while Designer remains on neutral progress and announces the error accessibly.
- Classify direct Design creation using `seller_id IS NULL` and the RPC creation entry matching `user_id === order.created_by` with `role === 'design'`. This remains correct after designer reassignment and works under profile RLS. While the RPC is loading show neutral progress; on error or absent creator event show neutral unavailable progress instead of inferring a Sales route. Once classification arrives, direct Design orders start at Diseño and other orders retain their existing Sales internal/external route. Add optional steps and Caja authorization badge support to `FlowTracker`, preserving its defaults.
- Extract Sales' link behavior into shared `OrderTrackingLink({ orderId, trackingToken })`; accept a provided token or load it through the existing authenticated order read path. Handle loading, missing token and clipboard fallback without blocking Designer actions.
- Add a forward-only migration at `supabase/migrations/20261019120000_order_participation_timeline_access_control.sql`. Preserve the timeline RPC signature, JSON keys and chronological response; deny anonymous and callers lacking current order visibility; revoke `public`/`anon` execution and grant `authenticated`; label designer-created events as Diseñador. Do not apply the migration remotely.
- Restrict edits to `src/pages/page-designer.jsx`, `src/hooks/useOrderParticipation.js`, `src/components/orders/OrderDetailModal.jsx`, new `src/components/orders/OrderTrackingLink.jsx`, `src/components/orders/OrderParticipationTimeline.jsx`, `src/components/FlowTracker.jsx`, `src/css-components/page-designer.css`, the named migration, `src/__tests__/use-order-participation.test.jsx`, and focused existing/new tests under `src/__tests__/`. If another app path proves necessary, return for scope approval.

## Test plan and acceptance

- Cover hook RPC failure (`error` populated, timeline empty, loading false); Sales error rendering; Designer neutral, accessible error state; Design origin after reassignment and profile-RLS restrictions using the RPC creation entry without a frontend role lookup; one Designer hook/RPC result feeds history and route selection; neutral loading/error/missing-entry route UI; existing Sales internal/external defaults; authorization badge only when both persisted fields exist; tracking token available/missing and clipboard fallback; timeline loading/empty/populated; Designer action and permission regressions; migration signature/JSON/access policy/grants and creator role label.
- Security Auditor and Visual QA are required. Review security-definer authorization and grants; inspect rendered modal hierarchy, narrow viewport overflow, keyboard/focus and scrolling. Static visual evidence is acceptable without launching the app.
- Playwright is not requested and must not be started by default.
- Run focused tests, `npm run lint`, `npm run security:check`, `npm run build`, and full `npm run test`. Food Taster must independently record all four required checks after Tester, Security Auditor and Visual QA. Failed/missing evidence stops the workflow.
- Final Reviewer compares the original request, plan, evidence, initial dirty status and final task diff. No deployment, remote migration, commit or push.

## Assumptions and risks

- Authorization is a visual badge in Caja, derived from `production_authorized_at` and `production_authorized_by`; no new status or transition is added.
- Direct designer flow is derived from persisted creator identity, the role returned by the authorized history RPC, and absent seller association. If role data is unavailable, show neutral progress instead of misclassifying.
- Public tracking remains limited to existing public fields and never includes the internal participation history.
- Main risks are current RPC disclosure by arbitrary order UUID, token availability under RLS, and preserving unrelated concurrent edits/CI/CD work.

**Acceptance:** Designer shows the three requested tracking elements, directly-created orders begin at Diseño, Sales routes remain unchanged, existing Designer controls remain intact, and the history RPC enforces the established visibility boundary with stable output contract.

**STATUS: DRAFT** — awaiting independent Plan Reviewer verdict.
