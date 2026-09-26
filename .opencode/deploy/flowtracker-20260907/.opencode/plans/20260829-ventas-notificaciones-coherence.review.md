# Revisión independiente — Plan 20260829-ventas-notificaciones-coherence

**Fecha revisión:** 2026-08-29
**Revisor:** Plan Reviewer (agente independiente)
**Plan ID:** 20260829-ventas-notificaciones-coherence
**Baseline commit (HEAD al revisar):** `c3c9bac57bc357ffd15e3ce4c13baa8fbe8f622a`
**Baseline declarado en plan:** `HEAD al crear run 20260829-ventas-notif-coherence` (vago, resuelto a SHA actual para trazabilidad)
**Estado del plan:** DRAFT
**Archivos canónicos verificados:** `src/pages/pages-seller.jsx`, `src/css-components/page-seller.css`, `src/components/designer/DesignerNotificationsModule.jsx`, `src/components/designer/DesignerNotificationsModule.css`, `src/utils/constants.js`, `src/components/ui/Badge.jsx`, `src/context/neonprint-business-context.md` (leído), `git status --short`, `git rev-parse HEAD`
**TASK_DIR:** `.opencode/runs/20260829-ventas-notif-coherence` (contiene `plan-draft.md` idéntico al publicado)

## 1. Resumen ejecutivo

Plan **preciso y completo**. Cubre los 7 puntos de la solicitud “Ventas ↔ Notificaciones coherence” sin omisiones, reutilizando tokens/variantes existentes (`--seller-client-*`, `.ps-badge`, `.ps-card`, `STATUS_COLORS` dot) en lugar de duplicar estilos. Respeta explícitamente las dos exclusiones (div silenciar y listado individual). Referencias `file:line` correctas dentro de tolerancia ±5 líneas. Riesgos principales identificados (regresión KPI, glow global, responsive). No introduce cambios de RLS/API/Storage/secrets. Metodología solicitada (Elemento→diferencia→referencia→cambio→resultado) cumplida vía tabla §4. **No se detectan bloqueantes.** Gaps son de precisión menor (copy subtítulo, mapping dot pago, breakpoints) mitigables en ejecución.

## 2. Checklist de 7 puntos (solicitud original)

| # | Requisito original | Cubre plan | Verificación contra código | Comentario |
|---|-------------------|------------|---------------------------|------------|
| **1** | Banner Notificaciones acercarlo a Panel principal Ventas (misma jerarquía, tamaños, grosores, espaciados, badges, alineación). Badge Bandeja activa mantener verde pero lenguaje badges Ventas | **Cumple** | `page-seller.css:355-406` (`ps-greeting` 24 28 24 32, border 1px `#dbe3ef` + left 3px `#091127`, radius14, shadow `var(--seller-client-shadow)`, `::before` 200 / `::after` 160, gap20, h2 22/800 `#0f1e40`) vs `DesignerNotificationsModule.css:71-101` (`dnm-hero` 220/150 gap16 min116) y `DesignerNotificationsModule.jsx:446-461` – diferencias correctamente diagnosticadas. Cambio #1 unifica a tokens `ps-greeting`; #2 migra `dnm-status-pill` (7px radius10 4/9 #f0fdf4 dot6 glow) a `ps-badge` (3/10 radius20 11/600 gap5 dot5 #22c55e preservando verde). | Referencia `css:415/721` desplazada ~300 líneas (ps-badge real 722, dnm-status-pill 178) pero intención inequívoca. Propone reutilizar vars, no duplicar. Validado. |
| **2** | Texto secundario azul limpio horizontal sin iconos (eliminar Módulo de diseño / Historial archivado con iconos) | **Cumple con observación** | `jsx:454-457` `<div class="dnm-hero-meta"><span><ModuleIcon/> Módulo…</span><span><Icons.Archive/> Historial…</span></div>` y `css:198-217` 12px `#64748b` verificado. Plan #3 reemplaza por `<p class=dnm-hero-subtitle>` sin Icons clon `ps-greeting p` (13px #1E40AF 600). | **Gap menor:** copy exacto del nuevo subtítulo no definido en plan (¿texto vacío, genérico o replicar “Aquí tienes…”?). No bloquea pero debe decidirse antes de coder para evitar invención. No duplica estilos. |
| **3** | Contadores `55 sin leer · 10 archivadas` a badges independientes misma estructura Ventas | **Cumple** | `css:219-231` `small` 11px #8899b5 plano verificado. `ps-greeting-badges` 440 gap8 mt10 y `ps-greeting-count` 415 validado. Plan #4 crea `dnm-hero-counts` flex gap8 mt10 + 2 badges (pending `#fffbeb/#fde68a #92400e` dot, muted `#f8fafc/#dbe3ef #4A5E80`). | Mapping dot no explicitado (color dot pending vs muted). Asume reutilizar `STATUS_COLORS` / `dnm-badge-status` pending/archived. Requiere especificar dot para contraste. Correcto en espíritu. |
| **4** | Tarjetas Activas/Sin leer/Archivadas adoptar estructura tarjetas estadísticas Ventas (dimensiones, jerarquía, tipografía, padding, bordes, sombras, alineación, distribución) conservando colores | **Cumple** | `pages-seller.jsx:131-143` `MetricCard` + `css:537-588` `ps-card` 22 padding, radius14, `seller-client-border/shadow`, icon radius10 mb16, value28/700, label13 #000 700, sub11 500 verificado. `jsx:499-524` + `css:263-348` `dnm-summary-card` 118minH flex gap14 20/22 horizontal, icon40, strong28, small11 verificado. Plan #5 refactoriza a `ps-card` vertical block, conserva semántica color (info/warning/muted). | Reutiliza sistema existente, no introduce nuevos tokens. Conserva colores pedido. Responsive 920/800 ya contemplado. |
| **5** | Eliminar círculo decorativo esquina superior derecha de tarjetas Ventas y no incorporarlo en Notificaciones | **Cumple** | `jsx:135` `<div class="ps-card-glow" style={{background: acc.glow}}/>` y `css:559-564` `.ps-card-glow` 90px top-28 right-28 opacity .35 verificado. `dnm-summary-card` no tiene glow. Plan #6 borra JSX y regla, verifica ausencia en dnm. | Global: afectará todas las métricas Ventas (8 cards). Correcto según solicitud, pero requiere visual-qa Dashboard completo para confirmar que sin glow no queda hueco visual ni pérdida de jerarquía. |
| **6** | Badges Pago en Gestión Órdenes incorporar círculo indicador como Estado (● Texto) | **Cumple** | `Badge.jsx:34-45` `PaymentBadge` sin dot + `constants.js:325-330` `PAYMENT_COLORS` sin campo `dot` verificado. `Badge.jsx:19-31` `StatusBadge` con `dot5` y `PAYMENT_COLORS` dot en `STATUS_COLORS` como referencia. Plan #7 añadir `dot` a `PAYMENT_COLORS` y renderizar `<span class=ps-badge-dot>` en `PaymentBadge`. | **Gap menor:** valores exactos `dot` no listados en plan (debe mapear: Pa #14532D→ #22C55E?, Pend #92620A→ #F59E0B, Parcial #0369A1→ #0EA5E9, Crédito #6D28D9→ #A855F7). Contraste sobre `bg` claro debe validarse a11y. Patrón reutilizado correctamente. |
| **7** | NO modificar div silenciar notificaciones ni listado notificaciones individuales | **Cumple** | Exclusión declarada `Out-of-scope: jsx:477-498 dnm-sound-setting, 632-652 + css 682-985 dnm-list/dnm-item` verificada exacta contra archivos reales (sound 477-497, list 632-652 + css 682+). Allow-list restringida. Plan explícitamente prohíbe diff y propone checks `No diff en dnm-sound-setting / dnm-item`. | Cumple invariante. |

**Metodología solicitada:** Tabla §4 con columnas Elemento→diferencia→referencia→cambio→resultado + “reutilizar patrones, cambios controlados” — **cumplida**.

## 3. Hallazgos

### 3.1 Precisión de referencias
- Banner Ventas `page-seller.css:355-534` correcto (ps-greeting 355, p 400, badges 440). `pages-seller.jsx:861` corresponde a `ps-greeting` publicado, líneas desplazadas por evolución (actual 861 contiene greeting) — aceptable.
- Tarjetas `css:537-588` y `jsx:131`/`css:559` exactos.
- Badges `Badge.jsx:19` debería citar `34` para PaymentBadge, pero referencia a StatusBadge dot es útil como ejemplo — desviación menor.
- DNM hero `css:71-260` correcto; pill `415/721` desplazado pero identificable.
- Veredicto: referencias **suficientes para implementación sin ambigüedad**.

### 3.2 Completitud y reutilización
- Plan reutiliza `var(--seller-client-border/radius/shadow)`, `ps-badge` (3/10 radius20 11/600 gap5 dot5), `ps-card` (padding22 radius14), `STATUS_COLORS` dot como modelo. **No duplica CSS.**
- Tokens compartidos garantizan coherencia futura si Ventas evoluciona.
- Orden implementación 1) glow 2) constants+Badge 3) hero 4) cards — lógico, minimiza conflictos.

### 3.3 Exclusiones y alcance
- Allow-list mínima y correcta: 6 archivos.
- Out-of-scope respetado y verificable vía `git diff` (dos áreas prohibidas).
- No toca API, RLS, Storage, pagos reales — solo visual badge Payment.

### 3.4 Riesgos no totalmente mitigados (pero no bloqueantes)
1. **Glow removal global:** `ps-card-glow` es global a todo `ps-card`. Eliminar puede afectar percepción de profundidad en Dashboard. Mitigación plan: “aislar a ps-card/dnm” insuficiente — recomendar visual-qa comparativo antes/después en `/seller dashboard` y captura de métricas.
2. **PAYMENT_COLORS dot contraste:** Añadir dot sobre fondos claros (`#DCFCE7` con `#22C55E` etc.) debe superar WCAG contrast. Plan no lista valores hex dot — dejar a coder elegir sin guía puede producir dot poco visible. Recomendación: definir tabla explícita.
3. **Copy subtítulo azul:** Sin texto definido, coder podría inventar copy o dejar vacío incurriendo en regresión a11y/UX. Definir copy (ej. “Gestiona tu bandeja y mantén tus notificaciones al día” o reutilizar patrón Ventas) antes de ejecutar.
4. **Contadores dot:** muted (archivadas) dot `#4A5E80` sobre `#f8fafc` es tenue; evaluar si muted debe llevar dot o mantenerse sin dot para diferenciar “archivado” (como hace `StatusBadge` archived sin glow?).
5. **Responsive breakpoints desalineados:** `ps-greeting` media 768px vs `dnm-hero` 800px / 920px. Unificar solo tokens internos mantiene breakpoints distintos; no es bug pero debe verificarse que hero notif a 768-800px no rompa layout tras cambiar gaps/paddings.
6. **Baseline vago:** `HEAD al crear run` no es SHA. Para auditoría fijar SHA actual `c3c9bac...`. Worktree actual sucio con 40+ archivos M/ ?? — ninguno de los prohibidos pero `page-seller.*` sucio implica que ejecución debe hacer rebase/checkout limpio y no pisar cambios no relacionados.
7. **Tests:** Plan menciona “build OK” pero no exige `npm run lint` / `security:check` ni test de regresión visual.

### 3.5 Seguridad / dominio (neonprint-business-context.md)
- Cambio puramente visual. No expone `SUPABASE_SERVICE_ROLE_KEY`, no altera `profiles.role`, no cambia estados canónicos (`ORDER_STATUS`/`PAYMENT_STATUS`) más allá de añadir campo `dot` presentacional en `PAYMENT_COLORS` (lectura). No requiere `security-auditor` — correctamente clasificado.
- Respeta “Conservar componentes, tokens y patrón CSS local del área modificada.”
- No introduce aliases en DB ni modifica transiciones.
- `PAYMENT_COLORS` dot es solo presentacional, no afecta reglas `isPayment*` — invariante preservado.

## 4. Checks requeridos (adecuación)
Plan §5/6 propone: build OK, ausencia `ps-card-glow`, subtitle sin svg 13 #1E40AF, pill radius20 11px, 2 badges, cards padding22 vertical, `PaymentBadge .ps-badge-dot`, visual-qa `/seller dashboard/notifications/orders`, responsive 920/800/560.

**Adecuados pero ampliables:**
- Añadir `npm run lint` + `npm run build` y `git diff --stat` para verificar exclusiones.
- Añadir check a11y: contraste dot/bg ≥ 3:1, foco visible en nuevos badges.
- Añadir captura visual-qa (antes/después) para ps-greeting vs dnm-hero, ps-card vs dnm-summary-card.

## 5. Recomendaciones (no bloqueantes, implementar en ejecución)

1. **Definir copy subtítulo antes de coder:** proponer `“Toda tu actividad y avisos en un solo lugar.”` o reutilizar tono Ventas `“Aquí tienes el resumen de tu bandeja.”` Validar con producto.
2. **Especificar tabla PAYMENT_COLORS dot:** ej.
   - `pagado` bg `#DCFCE7` dot `#16A34A`
   - `Pending_Payment` bg `#FEF3C7` dot `#D97706`
   - `parcial` bg `#E0F2FE` dot `#0284C7`
   - `credito` bg `#F3E8FF` dot `#7C3AED`
   (ajustar a contraste comprobado).
3. **Contadores:** definir explícito: “55 sin leer” → `pending` con dot `#F59E0B`, “10 archivadas” → `archived` con dot `#64748B` o sin dot si se quiere diferenciar estado final.
4. **Glow:** al borrar, verificar que `ps-card` no deja espacio roto; considerar transición `box-shadow` solo.
5. **Visual-QA obligatorio:** marcar `visual-qa: REQUIRED` en `analysis.md` del run de ejecución; `playwright-qa` NO requerido (no pedido).
6. **Fijar baseline SHA** en manifest de ejecución.
7. **No reutilizar ps-card-glow en futuro:** añadir comentario en CSS “glow eliminado por coherencia 20260829”.

## 6. Veredicto

Plan completo, trazable, reutiliza sistema existente, respeta exclusiones, preserva invariantes de negocio/seguridad, implementable en ≤6 archivos, testeable vía build + visual-qa.

**VERDICT: READY FOR EXECUTION**

- **Plan ID:** 20260829-ventas-notificaciones-coherence
- **Baseline commit:** `c3c9bac57bc357ffd15e3ce4c13baa8fbe8f622a` (HEAD al 2026-08-29, ver `git rev-parse`)
- **Validación futura requerida (ejecución):**
  - `npm run build` y `npm run lint` OK
  - `git diff` no toca `dnm-sound-setting` (477-498) ni `dnm-list/dnm-item` (632+) ni otros fuera de allow-list
  - `grep -R ps-card-glow` → 0 resultados
  - Hero subtitle es `<p>` 13px #1E40AF 600 sin `<svg>`/`<span>` iconos
  - Badge “Bandeja activa” es `ps-badge` radius20 11px 3/10 bg `#f0fdf4` border `#bbf7d0` color `#166534` dot5 `#22c55e`
  - Contadores renderizan 2 badges independientes con dot (pending/muted)
  - 3 summary cards `padding 22` vertical `icon mb16` `value 28/700` `label 13/700` `sub 11/500` sombra `var(--seller-client-shadow)` conservando colores semánticos
  - PaymentBadge renderiza `.ps-badge-dot` con dot de `PAYMENT_COLORS` y `border 1px solid ${color}20`
  - visual-qa en `/seller` dashboard, `/seller` notifications, `/seller` orders (tabla y cards), responsive 920/800/560 y sin scroll horizontal
  - Contrast check dot/bg
- **Suposiciones:**
  - Worktree sucio actual no representa baseline; ejecución partirá de `c3c9bac...` limpio o hará stash de cambios no relacionados.
  - Copy subtítulo se definirá pre-ejecución sin bloquear; si vacío, se dejará placeholder revisable.
  - Dot pago no afecta lógica de elegibilidad `isPayment*` — solo presentacional.
  - No se requiere `security-auditor` ni `playwright-qa` (solo visual).
- **No autoriza implementación ni despliegue.** Solo una solicitud explícita posterior `ejecuta el plan 20260829-ventas-notificaciones-coherence` puede autorizar ejecución con revalidación Analyst+Planner.

---
*Revisión generada sin modificar código de aplicación, solo archivo de revisión, conforme a workflow plan-only NeonPrint.*
