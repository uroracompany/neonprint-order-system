# Changes: Smooth Curve for Evolution Chart

## Files changed

### `src/components/kpi/KPIMaterialsAnalytics.jsx`

1. **Added `interpolatePoints` helper** (after `getMaterialEmptyText`, before `ChartTooltip`):
   - New constant `INTERPOLATION_STEPS = 6` and function `interpolatePoints(startVal, endVal, steps)` that generates 7 intermediate points using an easeInOutQuad easing function between the two real values.

2. **Rewrote `evoData` return** (was lines 283-294):
   - Replaced the 2-point array with an interpolated 7-point array using `interpolatePoints`.
   - First point has `name: 'Mes anterior'`, last has `name: 'Mes actual'`, intermediate points have `name: ''`.
   - Each point includes an `isIntermediate` boolean flag.
   - The comparison series `'Periodo anterior'` is also interpolated.

3. **Added custom `EvoTick` component** (inside the chart IIFE):
   - Renders `<text>` only when `payload.value` is truthy, hiding intermediate `''` labels on the XAxis.

4. **Replaced all 3 `<XAxis>` instances** (BarChart, LineChart, AreaChart):
   - Changed from `tick={{ fontSize: 11 }}` to `tick={<EvoTick />} tickLine={false} axisLine={false}`.

### `src/__tests__/kpi-materials-analytics.test.jsx`

- `'genera exactamente 2 data points...'` → now expects `toHaveLength(7)`, checks index 0 and 6 for names.
- `'asigna los valores correctos...'` → checks `chartData[0]` and `chartData[6]` instead of index 1.
- `'incluye la serie "Periodo anterior"...'` → checks index 0 and 6 instead of index 1.
- `'el toggle de chart type...'` → all `.toHaveLength(2)` changed to `.toHaveLength(7)`, test name updated.
- Subtitle test unchanged.

## Test results

All 10 tests pass.

## What to focus on

- The easing curve (easeInOutQuad) produces smooth S-shaped transitions — verify visually in the browser that the curve looks natural between "Mes anterior" and "Mes actual".
- Tooltip behavior with intermediate points (they have empty `name` labels but visible `Materiales` values).
- All 3 chart types (area, line, bar) render correctly with the new 7-point data.
