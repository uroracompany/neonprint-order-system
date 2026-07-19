# Plan: Unify Visual Design & Elevate Production/Delivery Intelligence Panels

## Context
The Production Intelligence and Delivery Intelligence panels were recently implemented but use inline styles and inconsistent CSS classes compared to the established Design, Seller, and Quote Intelligence panels. The analysis found **76 specific visual inconsistencies** across both files. Additionally, the Area Detail view needs to be elevated to a full submodule matching the depth of SellerDetailView/DesignerDetailView.

## Goals
1. **Unify card design** — All cards, grids, lists, comparisons, alerts, and section headers must use the exact same CSS classes as the existing intelligence panels
2. **Rename** "Ranking de Áreas" → "Análisis por Área"
3. **Elevate Production Area Detail** to a full submodule (profile header, executive summary, hero KPIs, trend chart, status breakdown, employee ranking, comparison, alerts)
4. **Elevate Delivery Detail** to a full submodule (same depth as Area Detail)
5. **Verify lint passes** after all changes

---

## Step 1: Rename "Ranking de Áreas" → "Análisis por Área"

**File:** `src/components/kpi/KPIProductionIntelligence.jsx`
- Line ~205-207: Change section title from `Ranking de Areas` to `Análisis por Área`
- Also change CSS class from `kpi-card-subtitle` to `kpi-seller-section-title`

---

## Step 2: Unify Production Intelligence GlobalView CSS

**File:** `src/components/kpi/KPIProductionIntelligence.jsx`

### 2a. Hero cards grid (line ~137)
- Replace `style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}`
- With `className="kpi-hero-grid kpi-hero-grid--4"`

### 2b. Trend chart header (line ~158)
- Change `alignItems: 'center'` → `alignItems: 'flex-start'`
- Change `marginTop: 2` → `marginTop: 4` (period label, line ~161)

### 2c. Custom date filter (lines ~173-176)
- Change wrapper `marginBottom: 16` → `marginTop: 8, marginBottom: 8`
- Wrap each input in `<label><span>Desde</span>` / `<label><span>Hasta</span>` pattern
- Remove the bare `<span>a</span>` separator

### 2d. Section title (lines ~205-207)
- Replace `<div style={{ marginBottom: 16 }}><h3 className="kpi-card-subtitle">Ranking de Areas</h3></div>`
- With `<div className="kpi-seller-section-title">Análisis por Área</div>`

### 2e. Area ranking cards (lines ~208-265)
- Keep grid inline (dynamic columns), but replace card internals:
  - Card wrapper: simplify to `className="kpi-card"` + consistent padding/border/shadow
  - Inner elements: use consistent typography (fontSize: 13/12/11, fontWeight patterns, colors from design system)
  - Progress bars: keep inline (unique to this component), but match border-radius and height to design system

### 2f. Comparison section (lines ~267-280)
- Title: `<div className="kpi-seller-section-title">Comparación con Periodo Anterior</div>`
- Grid: `className="kpi-seller-comparison-grid"`
- Cards: `className="kpi-seller-comparison-card"`
- Label: `className="kpi-seller-comparison-label"`
- Value: `className="kpi-seller-comparison-value"`

---

## Step 3: Unify Production Area Detail View CSS

**File:** `src/components/kpi/KPIProductionIntelligence.jsx`

### 3a. Add `kpi-seller-page-body` wrapper (after header, ~line 327)
- Wrap all post-header content in `<div className="kpi-seller-page-body">`

### 3b. Hero cards grid (line ~343)
- Replace inline grid with `className="kpi-seller-hero-grid"`

### 3c. Hero cards (lines ~350-356)
- Change `className="kpi-hero-card"` → `className="kpi-seller-hero-card"`
- Change `className="kpi-hero-header"` → `className="kpi-seller-hero-header"`
- Change `className="kpi-hero-label"` → `className="kpi-seller-hero-label"`
- Change `className="kpi-hero-value"` → `className="kpi-seller-hero-value"`
- Add `kpi-seller-hero-icon` with `style={{ background: \`${h.color}15\`, color: h.color }}`
- Add `kpi-seller-hero-footer` with `kpi-seller-hero-subtitle` and `kpi-seller-hero-trend`

### 3d. Employee ranking list (lines ~363-394)
- Container: `className="kpi-seller-list"`
- Items: `className="kpi-seller-list-item"`
- Rank badge: `className="kpi-seller-list-rank"` + `style={{ background: color }}`
- Name: `className="kpi-seller-list-name"`
- Value: `className="kpi-seller-list-value"` + inline color
- Sub-text: `className="kpi-seller-list-sub"`

### 3e. Pie chart radius (line ~413)
- Change `innerRadius={50} outerRadius={80}` → `innerRadius={35} outerRadius={55}`

---

## Step 4: Unify Production Employee Detail View CSS

**File:** `src/components/kpi/KPIProductionIntelligence.jsx`

### 4a. Add `kpi-seller-page-body` wrapper (after header, ~line 492)
### 4b. Hero cards: same fixes as Step 3b-3c
### 4c. Activity section (lines ~561-577)
- Title: `className="kpi-seller-section-title"`
- Event items: use `kpi-seller-timeline-item`, `kpi-seller-timeline-dot`, `kpi-seller-timeline-content` CSS classes

---

## Step 5: Unify Delivery Intelligence GlobalView CSS

**File:** `src/components/kpi/KPIDeliveryIntelligence.jsx`

### 5a. Hero cards grid (line ~171)
- Replace inline grid with `className="kpi-hero-grid kpi-hero-grid--4"`

### 5b. Trend chart header (line ~192)
- Change `alignItems: 'center'` → `alignItems: 'flex-start'`
- Change `marginTop: 2` → `marginTop: 4` (period label, line ~195)

### 5c. Custom date filter (lines ~207-210)
- Same fix as Step 2c: wrapper margin, `<label>` wrapping, remove bare `<span>a</span>`

### 5d. Ranking section title (line ~237)
- Change to `className="kpi-seller-section-title"` (inside card)
- Select: use `className="kpi-select"` or simplify inline styles to match

### 5e. Comparison section (lines ~287-296)
- Title: `className="kpi-seller-section-title"`
- Grid: `className="kpi-seller-comparison-grid"`
- Cards: `className="kpi-seller-comparison-card"`
- Label: `className="kpi-seller-comparison-label"`
- Value: `className="kpi-seller-comparison-value"`

---

## Step 6: Unify Delivery Detail View CSS

**File:** `src/components/kpi/KPIDeliveryIntelligence.jsx`

### 6a. Add `kpi-seller-page-body` wrapper (after header, ~line 471)
### 6b. Hero cards grid (line ~490)
- Replace inline grid with `className="kpi-seller-hero-grid"`

### 6c. Hero cards (lines ~499-507)
- Change all `kpi-hero-*` → `kpi-seller-hero-*`
- Add `kpi-seller-hero-icon` with color styling
- Add `kpi-seller-hero-footer` with subtitle and trend

### 6d. Trend chart header (line ~511)
- Change `alignItems: 'center'` → `alignItems: 'flex-start'`
- Change `marginTop: 2` → `marginTop: 4`

### 6e. Custom date filter (lines ~526-529)
- Same fix as Step 2c

### 6f. Pie chart radii (lines ~556, ~583)
- Change both to `innerRadius={35} outerRadius={55}`

### 6g. Pie chart legend dots (lines ~569, ~596)
- Change `borderRadius: 3` → `borderRadius: '50%'`

### 6h. Top clients/materials lists (lines ~609-629)
- Use `kpi-seller-list-item`, `kpi-seller-list-rank`, `kpi-seller-list-info`, `kpi-seller-list-name`, `kpi-seller-list-sub`, `kpi-seller-list-value`

### 6i. Alerts section (lines ~636-644)
- Container: `className="kpi-seller-alerts"`
- Items: `className="kpi-seller-alert-item"` + `style={{ borderColor: a.color }}`

### 6j. Comparison section (lines ~649-657)
- Same fix as Step 5e
- Add delta/change display

---

## Step 7: Elevate Production Area Detail to Full Submodule

**File:** `src/components/kpi/KPIProductionIntelligence.jsx` — AreaDetailView

Enhance the AreaDetailView to match the depth of SellerDetailView/DesignerDetailView:

### 7a. Profile header (enhance existing)
- Add area icon (Brush for Digital, Package for DTF, Clipboard for Ploteo)
- Add period badge and participation badge
- Keep back button pattern

### 7b. Executive summary section
- Add a text summary below the header: "Análisis del área [AreaName] durante el período [period]. Se procesaron [total] archivos con una tasa de finalización del [completionRate]%."

### 7c. Hero KPIs (enhance existing 4 cards)
- Keep: Archivos, Tasa Éxito, Tiempo Promedio, Trabajadores
- Add footer/subtitle to each card (matching seller hero pattern)

### 7d. Trend chart (add new section)
- Add daily trend chart for the specific area (reuse existing backend `production_daily_trend` or create area-specific variant)
- Period selector (7d, 15d, 30d, 90d)
- Custom date filter

### 7e. Status breakdown (enhance existing pie chart)
- Keep the pie chart but use smaller radius (35/55)
- Add a section title `kpi-seller-section-title`

### 7f. Employee ranking (enhance existing list)
- Use `kpi-seller-list-*` CSS classes
- Add bar visualization for each employee's file count

### 7g. Comparison section (add new)
- Period vs previous period comparison
- Use `kpi-seller-comparison-grid` / `kpi-seller-comparison-card`

### 7h. Alerts section (add new)
- Show bottleneck alerts (files stuck >2 days in area)
- Use `kpi-seller-alerts` / `kpi-seller-alert-item`

### 7i. Activity section (enhance existing)
- Use `kpi-seller-section-title` for header
- Use `kpi-seller-timeline-*` CSS classes for events

---

## Step 8: Elevate Delivery Detail to Full Submodule

**File:** `src/components/kpi/KPIDeliveryIntelligence.jsx` — DeliveryDetailView

### 8a. Profile header (enhance existing)
- Add delivery icon (Truck/Package)
- Add period badge and participation badge
- Keep back button pattern

### 8b. Executive summary section
- Summary text about the delivery person's performance

### 8c. Hero KPIs (enhance existing)
- Add footer/subtitle to each card
- Add trend indicators

### 8d. Trend chart (enhance existing)
- Fix CSS classes to match design system
- Period selector and custom date filter

### 8e. Order distribution (enhance existing pie chart)
- Fix radius, legend dots, add section title

### 8f. Top clients / materials (enhance existing lists)
- Use `kpi-seller-list-*` CSS classes

### 8g. Alerts section (enhance existing)
- Use `kpi-seller-alerts` / `kpi-seller-alert-item`

### 8h. Comparison section (enhance existing)
- Use `kpi-seller-comparison-*` CSS classes
- Add delta display

---

## Step 9: Verify

- Run lint (`npm run lint` or equivalent)
- Verify no new warnings or errors
- Visual spot-check: all cards should have consistent borders, shadows, radius, spacing, typography, hover states

---

## Files to Modify
1. `src/components/kpi/KPIProductionIntelligence.jsx` — Steps 1-4, 7
2. `src/components/kpi/KPIDeliveryIntelligence.jsx` — Steps 5-6, 8

## Reference Files (read-only)
- `src/components/kpi/KPIDesignIntelligence.jsx` — primary visual reference
- `src/components/kpi/KPISellerIntelligence.jsx` — primary visual reference
- `src/components/kpi/KPIQuoteIntelligence.jsx` — primary visual reference
- `src/css-components/page-kpi.css` — all CSS classes
