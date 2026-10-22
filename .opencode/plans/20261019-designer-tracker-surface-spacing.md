# Plan — Designer tracker white surface and tracking-link spacing

- Plan ID: 20261019-designer-tracker-surface-spacing
- Original request: Make the Designer modal FlowTracker's inner stage strip white like the cards, and add vertical breathing room between the summary cards and tracking-link card.
- Baseline commit: 2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb
- Baseline status: See `.opencode/runs/20261019-designer-tracker-surface-spacing/baseline-status.txt`. The worktree has extensive concurrent edits. Preserve every pre-existing and unrelated change.
- STATUS: DRAFT

## Goal and scope

Make two presentation-only adjustments to the Designer order detail modal:

1. Change the Designer-scoped inner FlowTracker stage strip (`.designer-order-modal__flow .ps-flow`) from the pale gray surface to white, visually matching the summary cards and tracking card.
2. Add a clear, consistent top gap before the tracking-link card, which currently follows the summary grid with no top margin.

Do not change element order, tracker state/flow logic, labels, or tracking behavior.

## Current implementation

- `src/pages/page-designer.jsx` renders the flow section, summary grid, then tracking-link section in that order. No JSX change is needed.
- `src/css-components/page-designer.css` contains a scoped `.designer-order-modal__flow .ps-flow` rule setting `background: var(--surface-alt, #f6f8fb)`; this overrides the shared FlowTracker surface for the Designer modal.
- The summary grid has zero vertical margin. The tracking section currently has `margin: 0 var(--designer-order-modal-section-gutter, 20px) 18px`, so its top edge touches the summary cards.
- Mobile gutter is already controlled by `--designer-order-modal-section-gutter: 14px` under the existing 768px media query. Retain this responsive gutter behavior.

## Exact implementation steps

1. In `src/css-components/page-designer.css`, change only the background declaration in `.designer-order-modal__flow .ps-flow` to `background: var(--surface, #fff)` (or equivalent explicit white fallback) so the Designer-specific override remains scoped and other pages using `.ps-flow` retain their current appearance.
2. In the same stylesheet, add an 18px top margin to `.designer-order-modal__tracking`, retaining its responsive horizontal gutter and existing bottom margin. Prefer `margin: 18px var(--designer-order-modal-section-gutter, 20px) 18px`.
3. Add or extend a focused regression assertion in `src/__tests__/designer-tracker-layout.test.jsx` for the scoped CSS contract: the Designer stage strip is white and the tracking section has a positive 18px top gap. Prefer a computed-style assertion if the test setup actually loads CSS into jsdom; otherwise use a narrow stylesheet-contract check, without adding production code solely for testing.
4. Inspect the final diff and confirm only the intended declarations/test assertion changed within the allowed paths. Do not rewrite either file or disturb existing edits.

## Files

- `src/css-components/page-designer.css` — the two scoped visual adjustments.
- `src/__tests__/designer-tracker-layout.test.jsx` — focused regression coverage.
- `.opencode/runs/20261019-designer-tracker-surface-spacing/plan.md` — run evidence.
- `.opencode/plans/20261019-designer-tracker-surface-spacing.md` — durable draft.
- `.opencode/plans/20261019-designer-tracker-surface-spacing.review.md` — independent plan review.

No JSX, data, workflow, database, auth, storage, API, or migration changes are needed.

## Acceptance criteria

- The inner stage strip in Designer has a white background matching nearby cards.
- There is a visible 18px vertical gap between the summary grid and tracking-link card.
- Horizontal gutters remain 20px on desktop and 14px at the existing mobile breakpoint.
- Shared FlowTracker styling on Seller and other areas is unchanged.
- Flow order, state selection, accessibility labels, and tracking link remain unchanged.
- The final patch preserves unrelated concurrent work.

## Verification

- Run focused test: `npm run test -- src/__tests__/designer-tracker-layout.test.jsx`.
- Run the required project checks for a UI change: `npm run lint`, `npm run security:check`, `npm run build`.
- Run static Visual QA (no app/browser startup or Playwright; browser verification was not requested).
- Food Taster must subsequently run the required independent quality suite, and Reviewer must compare the request, plan, evidence and exact diff.

## Risks and constraints

- `.ps-flow` is shared. The background change must stay scoped to `.designer-order-modal__flow`.
- The stylesheet and test already have pre-existing changes. Preserve them and avoid broad formatting/reordering.
- A DOM test may not reflect CSS in jsdom; choose an assertion supported by the current test setup rather than assuming browser layout APIs are available.
- This is a visual-only CSS adjustment; no state, data, authorization, or performance behavior changes are expected.
- The user requested implementation, but this is only the draft plan stage. No application code has been edited.

## Required specialist checks

- Visual QA: required because this is a rendered UI change.
- Security audit: not required; this plan makes no auth, permission, API, SQL, RLS, secret, Storage, payment, tracking-data, or destructive-operation changes.
- Playwright: not required; the user did not request browser verification.

**PLAYWRIGHT: NOT REQUIRED**

