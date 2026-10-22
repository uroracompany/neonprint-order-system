# Plan Review — Designer modal first-paint tracker and information layout

- Plan ID: `20261019-designer-modal-first-paint`
- Reviewer: Independent Plan Reviewer
- Verdict: `READY FOR EXECUTION`

## Findings

- The loading defect is grounded in the current implementation: `src/pages/page-designer.jsx` derives the tracker's origin from `participation.timeline` and renders a loading/error paragraph when that entry is unavailable. Sales renders the shared `FlowTracker` from the already loaded order's `status` and order type, without waiting for participation history.
- The existing Designer order select includes `status`, `order_design_type`, `seller_id`, `designer_id`, and `created_by`, and selected orders are passed to the modal. Those fields support synchronous first-render routing without a second request or a change to the history hook.
- The direct-creation predicate in the plan matches the canonical creation RPC: Designer mode stores `seller_id = null`, `designer_id = actor`, `created_by = actor`, and starts at `in_Design`. The plan specifies a deterministic standard-flow fallback for incomplete legacy origin data, so the tracker remains visible while history is pending or unavailable.
- The Sales style reference is concrete and locally scoped: `.order-detail-flow` defines the circle, label, line, scroll, and focus presentation. Applying equivalent values only under `.designer-order-modal__flow` avoids Sales regressions.
- The paired-card layout follows the Sales grid proportions (`1.12fr / 0.88fr`, 16px gap, one column at 900px), while the plan preserves customer actions and optional work fields. Long-value wrapping and row accessibility are explicitly included in acceptance criteria.
- The allowed paths and exclusions preserve the concurrently modified Sales, CDC/CI/CD, auth, migrations, and unrelated tests. No API, database, authorization, or deployment change is necessary.

## Required implementation checks

- Keep tracker routing purely synchronous from the selected order. Ensure route precedence remains direct Designer creation first, then external order type, then standard fallback; the existing order-creation RPC establishes the direct Designer case at `in_Design`.
- Confirm first render with history pending, failed, and without a creator event; separately confirm history still displays its own loading/error state.
- Cover direct Designer, seller-origin, external, and ambiguous legacy orders, including the direct Designer record's `in_Design` status.
- Verify the Sales tracker remains unchanged, Designer tracker geometry/type matches the Sales CSS reference, and the two cards stack at the specified breakpoint without overflow.
- Preserve all pre-existing hunks and limit edits to manifest-authorized paths.

## Scope and risk review

No blocking ambiguity or architectural risk remains. The plan is implementation-ready. The primary risks—legacy origin fields, asynchronous history, responsive overflow, and CSS leakage—have defined behavior and acceptance coverage.
