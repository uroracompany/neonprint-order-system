## Changes Summary

### File 1: `src/css-components/page-quote.css`

1. **Change 1** — Added 4 new card CSS variables (`--pq-card-border`, `--pq-card-radius`, `--pq-card-shadow`, `--pq-card-shadow-hover`) to `:root` after the existing shadow variables.

2. **Change 2** — Added `margin-bottom: 28px` to `.pq-metrics-grid`.

3. **Change 3** — Replaced `.pq-metric-card` styles: removed flex layout, increased padding to `22px 22px`, increased `min-height` to `140px`, simplified transition, added `cursor: default`.

4. **Change 4** — Split the combined `.pq-metric-card:hover, .pq-order-card:hover` rule into two separate rules. Metric card hover now uses `transform: none` and `--pq-card-shadow-hover`. Order card hover keeps original behavior.

5. **Change 5** — Replaced `.pq-metric-icon` styles: removed fixed dimensions/gradient background, now uses `display: flex`, `border-radius: 10px`, `padding: 10px`, `margin-bottom: 16px`, `width: fit-content`.

6. **Change 6** — Replaced `.pq-metric-copy span` and `.pq-metric-copy strong` with three new classes: `.pq-metric-value`, `.pq-metric-label`, `.pq-metric-sub`.

7. **Change 7** — Added `.pq-metric-glow` rule (absolute positioned circle element) after the hover rule block.

### File 2: `src/pages/page-quote.jsx`

8. **Change 8** — Added `CARD_ACCENTS` array with 5 color configs. Updated `metrics` array to include `accentIdx` and `sub` properties. Added `MetricCard` component function that renders icon, value, label, sub text, and glow circle with per-card accent colors.

9. **Change 9** — Replaced the inline `<article>` rendering in `.pq-metrics-grid` with `<MetricCard>` component usage via `.map()`.

### What to test

- All 5 metric cards render with correct values and labels
- Each card has a distinct color accent (navy, amber, emerald, violet, cyan)
- Glow circle is visible but subtle (positioned top-right of each card)
- Sub-text ("Activas en caja", "Requieren seguimiento", etc.) appears in each card
- Cards have no hover lift effect (flat interaction)
- Order card hover behavior is unchanged
- No regressions in other Quote module features (filters, modals, credit section)
