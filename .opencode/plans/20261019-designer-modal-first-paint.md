# Plan — Designer modal first-paint tracker and information layout

- Plan ID: `20261019-designer-modal-first-paint`
- Original user request: Fix the Designer modal so its flow tracker appears immediately on open, at the same speed and with matching typography as Sales; show Customer Information and Work Details cards side by side in the Sales-like proportions and presentation.
- Baseline commit: `2c2f6e8210cd1cd8a32c7f2dc980587ca4ef79cb`
- Status: `DRAFT`
- Affected files: `src/pages/page-designer.jsx`, `src/css-components/page-designer.css`, focused Designer modal tests, and this task's evidence files.
- Excluded: APIs, RPCs, database/migrations, permissions, Sales behavior, CDC/CI/CD, deployment, commits and remote writes.

## Plan

Derive flow origin synchronously from the selected order: `seller_id == null` plus present `designer_id` equal to `created_by` means a direct Designer-created order and starts at Design. External orders keep the existing external flow; seller-origin and ambiguous legacy orders use the standard flow. Render `FlowTracker` from the loaded order fields on the modal's first paint, independently of participation history. Keep the existing history hook, loading/error states and single subscription unchanged.

Match the Sales tracker’s circles, labels, connecting lines, scrolling and focus treatment with CSS scoped to Designer. Put Customer Information and Work Details in a two-column grid matching Sales (`1.12fr/0.88fr`, 16px gap), stack at 900px, and render their existing fields as icon/label/value rows with separators. Preserve WhatsApp, order-return badge, optional dimensions/quantity, review card directly after the pair, and existing file, preview, tracking, history and footer actions.

## Acceptance criteria

- Tracker is mounted on first modal render, including while history is loading or has failed.
- Direct Design, external, seller-origin, and ambiguous legacy orders select their existing appropriate flows without consulting the history result.
- History maintains its own loading/error behavior and no duplicate request/subscription is introduced.
- Sales tracker presentation remains unchanged; Designer typography and geometry match it.
- Customer and Work cards align at approximately 56/44 on desktop, stack at 900px or below, and long values wrap safely.
- Review and all existing Designer actions/data remain functional and in place.

## Tests, risks and required checks

Add or extend focused component/layout coverage for first paint during history loading/error, origin selection, independent history state, row fields, responsive grid and Sales non-regression. Run focused tests, lint, security check, build and full test suite through the project workflow. Visual QA is required; Playwright is not requested. No Security Auditor is required unless implementation scope expands into auth/API/SQL/permissions. Food Taster and independent Reviewer are required.

Risks: incomplete legacy origin fields must fall back immediately to the standard flow; narrow columns can overflow long text; CSS must remain scoped; the worktree contains many concurrent changes, including Designer/Sales/CDC/CI/CD, and those changes must be preserved.
