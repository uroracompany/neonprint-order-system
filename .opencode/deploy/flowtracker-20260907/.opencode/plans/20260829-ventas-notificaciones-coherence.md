# Plan: Coherencia Visual Ventas — Notificaciones y Badges de Pago
**ID:** 20260829-ventas-notificaciones-coherence
**STATUS:** DRAFT
**Fecha original:** 2026-08-29
**Fecha revalidación:** 2026-08-29
**Baseline original:** HEAD al crear run 20260829-ventas-notif-coherence (vago)
**Baseline revalidado:** `c3c9bac57bc357ffd15e3ce4c13baa8fbe8f622a` (HEAD al 2026-08-29, verificado `git rev-parse HEAD`)
**Review:** 20260829-ventas-notificaciones-coherence.review.md — VERDICT: READY FOR EXECUTION
**TASK_DIR revalidado:** `.opencode/runs/20260829-ventas-notif-impl/plan.md` (plan exacto para Coder)
**visual-qa:** REQUIRED | **security-auditor:** NOT REQUIRED | **playwright-qa:** NOT REQUIRED

> **Revalidación 2026-08-29:** Plan VIGENTE sin delta funcional. Gaps menores cerrados: copy subtítulo `"Bandeja de trabajo · Historial disponible"` y tabla dot Pago explícita (pagado #16A34A, Pending_Payment #D97706, parcial #0284C7, credito #7C3AED). Worktree verificado: glow presente jsx:135/css:559-564, PAYMENT_COLORS sin dot, PaymentBadge sin dot, hero dnm-meta/status-pill/small y cards horizontal vs ps-card vertical — todo coincide con diagnóstico original. Allow-list 6 archivos intactos, exclusiones dnm-sound-setting 477-498 y dnm-list/dnm-item 632+/682+ sin diff. Orden 1)glow 2)constants+Badge 3)hero 4)cards. Ver plan revalidado completo en TASK_DIR para líneas exactas, tokens y verificación.

## 1. Solicitud original
Alinear banner Notificaciones a panel Ventas (misma jerarquia, tamaños, grosores, espaciados, badges, alineacion). Badge Bandeja activa mantener verde pero lenguaje badges Ventas. Texto secundario azul limpio horizontal sin iconos (eliminar Modulo de diseño / Historial archivado con iconos). Contadores 55 sin leer · 10 archivadas a badges independientes misma estructura Ventas. Tarjetas Activas/Sin leer/Archivadas adoptar estructura tarjetas estadísticas Ventas (dimensiones, jerarquia, padding, bordes, sombras, alineacion) conservando colores. Eliminar circulo decorativo superior derecho de tarjetas Ventas y no incorporarlo en Notificaciones. Badges Pago en Gestion Ordenes incorporar circulo indicador como Estado (● Texto). NO modificar div silenciar ni listado individuales. Reutilizar patrones existentes.

**Copy subtítulo cerrado (revalidación):** `Bandeja de trabajo · Historial disponible` en `<p class="dnm-hero-subtitle">` 13px #1E40AF 600 sin svg/icon.

**Tabla dot Pago cerrada (revalidación):**
- `pagado` (#14532D/#DCFCE7) → dot #16A34A
- `Pending_Payment` (#92620A/#FEF3C7) → dot #D97706
- `parcial` (#0369A1/#E0F2FE) → dot #0284C7
- `credito` (#6D28D9/#F3E8FF) → dot #7C3AED

## 2. Alcance
**In-scope:** banner hero, bandeja badge, texto azul, contadores badges, tarjetas 3 resumen, glow removal, badges Pago dot
**Out-of-scope (prohibido):** DesignerNotificationsModule.jsx:477-498 dnm-sound-setting, 632-652 + css 682-985 dnm-list/dnm-item. No RLS/API/Storage, no DB, no transiciones ORDER/PAYMENT, no deploy.
**Allow-list (6):** `src/pages/pages-seller.jsx`, `src/css-components/page-seller.css`, `src/components/designer/DesignerNotificationsModule.jsx`, `src/components/designer/DesignerNotificationsModule.css`, `src/utils/constants.js`, `src/components/ui/Badge.jsx`
**No-goals:** No tocar KPI, no cambiar elegibilidad `isPayment*`, no exponer secrets.

## 3. Analisis comparativo
**Banner Ventas ps-greeting (page-seller.css:355-534, pages-seller.jsx:861):** border 1px #dbe3ef + left 3px #091127 radius14 shadow 0 10 28 .055 padding 24 28 24 32 ::before 200 ::after 160, h2 22/800 #0f1e40, p 13/600 #1E40AF, ps-greeting-count inline-flex gap6 5/12 border #dbe3ef radius20 bg #f8fafc 12/600, variants returned/edited, badges container gap8 mt10
**Banner Notif dnm-hero (DesignerNotificationsModule.jsx:446-473 css:71-260):** casi idéntico pero con dnm-hero-icon 46px #091127, dnm-hero-meta 12px #64748b con icons, dnm-status-pill 7px radius 10px 4/9 #f0fdf4 dot6 glow, small 11px #8899b5 plano
**Tarjetas Ventas ps-card (pages-seller.jsx:131 css:537-588):** grid auto-fill 200 gap14, card padding22 radius14 border #dbe3ef shadow var, ps-card-glow 90 absolute opacity.35, icon radius10 padding10 mb16, value 28/700, label 13 #000 700, sub 11 500
**Tarjetas Notif dnm-summary-card (jsx:499-524 css:263-348):** grid 3x1 gap14, card 118minH flex gap14 padding20/22 horizontal, icon 40 radius10 (info/warning/muted), strong28, small11, misma border/shadow pero estructura horizontal vs vertical
**Badges:** ps-badge 3/10 radius20 11/600 gap5 + dot5, StatusBadge con dot, PaymentBadge SIN dot, PAYMENT_COLORS sin dot

**Patrones a reutilizar:** `--seller-client-*` vars, `ps-badge/ps-badge-dot` 5px, `STATUS_COLORS.dot` → `PAYMENT_COLORS.dot`, `ps-card` padding22 vertical.

## 4. Plan detallado (revalidado — ver TASK_DIR/plan.md §3 para líneas exactas)
| # | Elemento | Diferencia | Referencia | Cambio | Resultado |
|---|---|---|---|---|---|
|1|Banner contenedor|dnm-hero 220/150 gap16 vs ps-greeting 200/160 gap20 min116|page-seller.css:355 + dnm.css:71-101|Unificar a ps-greeting tokens: 24 28 24 32, border 1px+left3, radius14, shadow var, ::before200 ::after160, gap20, vars --seller-client-*|Misma proporcion/bordes/sombra|
|2|Badge Bandeja activa|dnm-status-pill 7px 10px 4/9 dot6 glow vs ps-badge 20px 11px 3/10 gap5 dot5|css:415/721→dnm 178|Migrar a ps-badge: 3/10 radius20 11/600 gap5 border #bbf7d0 bg #f0fdf4 color #166534 dot5 #22c55e|Mismo lenguaje, verde preservado|
|3|Texto secundario|dnm-hero-meta 12 #64748b con 2 icons|jsx:454-457 css:198-217|Reemplazar por `<p class=dnm-hero-subtitle>Bandeja de trabajo · Historial disponible</p>` sin Icons, clon ps-greeting p 13 #1E40AF 600|Linea azul limpia sin iconos|
|4|Contadores|small 11 #8899b5 plano|jsx:460-461 css:219-231|Crear dnm-hero-counts flex gap8 mt10 + 2 badges: pending #fffbeb/#fde68a #92400e dot #D97706, muted #f8fafc/#dbe3ef #4A5E80 dot #64748B|Badges independientes coherentes|
|5|Tarjetas 3 resumen|dnm horizontal 118 20/22 14gap vs ps-card vertical 22 stacked|jsx:499-524 css:263-348 vs css:544|Refactor a ps-card: padding22 block icon mb16 value28/700 label13/700 sub11/500 shadow var, conservar colores semánticos|Mismo sistema que metricas Ventas|
|6|Circulo decorativo|ps-card-glow 90 top-28 right-28 opacity.35 jsx:135 css:559|jsx:135 css:559-564|Borrar JSX glow y regla 559-564, verificar dnm sin glow|Ninguna card con circulo|
|7|Badges Pago|PaymentBadge sin dot PAYMENT_COLORS sin dot|constants:325 Badge:34|Anadir dot a PAYMENT_COLORS (tabla arriba) y renderizar `<span class=ps-badge-dot style=background:cfg.dot>` en PaymentBadge showDot=true|Pago y Estado comparten patron ●|

**Cambios por archivo (resumen líneas):**
- `pages-seller.jsx:135` borrar glow div; `page-seller.css:559-564` borrar regla; `constants.js:325-330` añadir dot 4; `Badge.jsx:34` añadir showDot+dot span; `DesignerNotificationsModule.jsx:454-461` hero meta→subtitle + status-pill→ps-badge + small→2 badges; `DesignerNotificationsModule.jsx:499-524` cards a vertical; `DesignerNotificationsModule.css:71-348` hero/bagdes/cards tokens ps-greeting/ps-card/ps-badge.

## 5. Archivos y verificacion
- `src/pages/pages-seller.jsx:122-143` glow + pago dot (allow)
- `src/css-components/page-seller.css:559` glow (allow)
- `src/components/designer/DesignerNotificationsModule.jsx:446-524` hero+summary (allow, prohibido 477-498/632-652)
- `src/components/designer/DesignerNotificationsModule.css:71-348` hero/pill/cards (allow, prohibido 682+)
- `src/utils/constants.js:325` PAYMENT_COLORS dot (allow)
- `src/components/ui/Badge.jsx:34` PaymentBadge dot (allow)
- No diff en `dnm-sound-setting` / `dnm-list/dnm-item`
- Checks: `grep -R ps-card-glow`→0; subtitle 13 #1E40AF sin svg; pill radius20 11px; contadores 2 badges pending/muted; cards padding22 vertical; `PaymentBadge .ps-badge-dot` con tabla; `npm run lint` + `npm run build` OK; `npm run security:check` OK; visual-qa /seller dashboard/notifications/orders + responsive 920/800/560 sin scroll; contraste dot/bg ≥3:1.

## 6. Riesgos
- Regresion visual KPI/Dashboard por glow global → aislar a ps-card/dnm, visual-qa comparativo obligatorio (capturas antes/después).
- Contraste dot claro → tabla fijada validada.
- Breakpoints 768 vs 800 desalineados → verificar responsive.
- Worktree sucio 40+ M → filtrar `git diff --stat -- <allow-list>`, no `git add -A`.
- No security-auditor (solo visual dot, no RLS/secrets).

## 7. Orden implementacion
1) glow (pages-seller.jsx/css) 2) constants+Badge (constants/Badge) 3) hero Notif (DNM jsx/css hero) 4) summary cards (DNM jsx/css cards) — cada paso testeable, minimiza conflictos, facilita bisect.

## 8. Criterios de aceptación (revalidado)
- `ps-card-glow` 0; `PAYMENT_COLORS` con dot tabla; `PaymentBadge` con `ps-badge-dot` y `border 1px solid ${color}20`; Hero tokens ps-greeting (24 28 24 32, border left3, radius14, shadow var, ::before200 ::after160 gap20) h2 22/800 p 13/600; Subtítulo `<p class=dnm-hero-subtitle>Bandeja de trabajo · Historial disponible</p>` sin svg; Bandeja badge ps-badge 11px 3/10 bg #f0fdf4 border #bbf7d0 color #166534 dot5 #22c55e; Contadores 2 badges pending/muted con dot; 3 cards padding22 vertical icon mb16 value28/700 label13/700 sub11/500 shadow var; No diff sound/list; build/lint OK; visual-qa PASS.

## 9. Revalidación — Veredicto
Plan original metodológicamente completo, referencias ±5 líneas, reutiliza sistema existente, respeta exclusiones, preserva invariantes negocio/seguridad. **READY FOR EXECUTION** tras cerrar gaps copy/dot. Solo Plan Reviewer puede marcar READY; este archivo permanece DRAFT hasta revisión independiente. Ejecución solo tras `ejecuta el plan 20260829-ventas-notificaciones-coherence` con revalidación fresca Analyst+Planner.
