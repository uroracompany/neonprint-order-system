# Plan: Fix "Configuración avanzada" navigation from modal

## Problem Summary

When clicking an order in **Admin → Actividad reciente → Últimas órdenes**, the order detail modal opens correctly. However, clicking **"Configuración avanzada"** from that modal does NOT navigate to the advanced settings view.

## Root Cause

**Tab mismatch:** `openAdvancedSettings()` sets `settingsOrder` and `settingsView` but does NOT switch `activeTab` to `"orders"`. The `AdminAdvancedSettings` component only renders when `activeTab === "orders" && advancedSettingsOpen` (line 4216), so it never appears when the user is on the Overview tab.

Additionally:
- `handleAdminTabChange()` resets `settingsOrder` and `settingsView` to defaults, so even if we switch tabs via that function, the advanced settings state is wiped.
- The `?order=` deep link parameter from SQL notifications is never consumed by the frontend.
- No URL synchronization means reload/back loses context.

## Changes

### 1. Fix `openAdvancedSettings` to switch tab without resetting state

**File:** `src/pages/dashboard.jsx` (~line 2422)

```javascript
// BEFORE:
const openAdvancedSettings = (order) => {
  setSelectedOrder(null);
  setSettingsOrder(order);
  setSettingsView("detail");
};

// AFTER:
const openAdvancedSettings = (order) => {
  setSelectedOrder(null);
  setSettingsOrder(order);
  setSettingsView("detail");
  selectAdminTab("orders");
};
```

`selectAdminTab` updates the URL to `?tab=orders` and sets `activeTab`. It does NOT reset `settingsOrder`/`settingsView` (unlike `handleAdminTabChange`).

### 2. Sync advanced settings state to URL

**File:** `src/pages/dashboard.jsx`

Add `?advanced=<orderId>` to URL when advanced settings are open, and parse it on mount/URL change.

- In `openAdvancedSettings`: navigate to `?tab=orders&advanced=<orderId>`
- In `AdminAdvancedSettings` onClose: remove `advanced` param
- Add a `useEffect` that parses `?advanced=<id>` from URL and restores `settingsOrder`/`settingsView` (for deep links and page reload)

### 3. Consume `?order=` deep links from SQL notifications

**File:** `src/pages/dashboard.jsx`

Add logic to detect `?order=<uuid>` in URL, find the order in the loaded orders list, and auto-open it in advanced settings. This connects the existing SQL deep links (`/dashboard?order=<uuid>`) to the actual UI.

### 4. Preserve `settingsOrder` across tab changes when advanced settings are open

**File:** `src/pages/dashboard.jsx` (~line 3874)

`handleAdminTabChange` currently always resets `settingsOrder`/`settingsView`. It should preserve them when navigating away from orders tab temporarily and back. Alternatively, since `selectAdminTab` is used for the fix in step 1, ensure `handleAdminTabChange` only resets when the user explicitly navigates away (not during the advanced settings flow).

## Files Affected

| File | Change |
|---|---|
| `src/pages/dashboard.jsx` | Fix `openAdvancedSettings`, add URL sync, consume `?order=` param, adjust `handleAdminTabChange` |

## Verification

1. **From Overview tab**: Click order → modal opens → click "Configuración avanzada" → should switch to orders tab and show advanced settings for that order
2. **From Orders tab**: Same flow should work as before
3. **URL sync**: After opening advanced settings, URL should show `?tab=orders&advanced=<orderId>`
4. **Page reload**: Reload with `?tab=orders&advanced=<orderId>` → should restore advanced settings view
5. **Back button**: After navigating back from advanced settings, should return to orders list
6. **Deep link**: Navigate to `/dashboard?order=<uuid>` → should open that order's advanced settings
7. **Existing flows**: All other order modal actions (edit, payment, cancel) should continue working
8. **Tab switching**: Switching between tabs should properly reset/cleanup advanced settings state
