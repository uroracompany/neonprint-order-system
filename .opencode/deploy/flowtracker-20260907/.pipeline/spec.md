# Spec: Fix Evolución de Materiales — Comparación Mensual

## Objetivo

Corregir la gráfica "Evolución de Materiales" en el panel KPI para que muestre **comparación mensual** (mes actual vs mes anterior) en vez de datos diarios. La gráfica debe generar exactamente 2 data points: "Mes anterior" y "Mes actual", con la serie del período anterior en gris y la actual en azul.

## Archivos a modificar

### 1. `src/components/kpi/KPIMaterialsAnalytics.jsx`

**Cambios en `evoData` useMemo (líneas 212-430):**

- Eliminar la lógica condicional `isDaily`/`isWeekly` que genera puntos diarios/semanales
- Siempre usar la lógica de agregación mensual (`buildMonthMap`)
- Generar exactamente 2 data points:
  - `{ name: 'Mes anterior', Materiales: <suma del mes previo> }`
  - `{ name: 'Mes actual', Materiales: <suma del mes actual> }`
- Mantener soporte para filtro de material específico (un solo material)
- Mantener soporte para "Materiales diferentes" (conteo de materiales únicos)
- Mantener la serie `Período anterior` cuando `hasComp` es true
- Usar `evoSummary` y `evoComparison` como fuentes de datos (ya implementado)
- Mantener el chart type toggle (area/line/bar) funcionando con 2 puntos

**Cambios en `evoSubtitle` useMemo (líneas 432-455):**

- Simplificar el texto a: "Referencias de materiales: mes actual vs mes anterior."
- Incluir nombre del material si se filtra por uno específico

### 2. `src/__tests__\kpi-materials-analytics.test.jsx`

**Agregar tests:**
- Verificar que la gráfica de evolución genera data mensual con 2 puntos
- Verificar que con monthly_trend de 2 meses, los data points son "Mes anterior" y "Mes actual"
- Verificar que el toggle de chart type sigue funcionando

## Lo que NO cambia

- Summary cards del banner (usan el período global)
- Ranking (usa `rankingGlobalQuery` independiente)
- MaterialsComparisonPanel (panel de comparación separado)
- MaterialDetailModal
- Filtros de material en el dropdown del toolbar
- Otros archivos del proyecto

## Criterios de aceptación

1. La gráfica muestra exactamente 2 barras/puntos: "Mes anterior" (gris) y "Mes actual" (azul)
2. El toggle area/line/bar funciona correctamente con 2 puntos
3. El filtro de material individual muestra solo ese material en ambos meses
4. El filtro "Materiales diferentes" cuenta materiales únicos por mes
5. El subtitle muestra el rango correcto de meses
6. Todos los tests existentes pasan
7. No hay errores de consola

## Verificación

```bash
npx vitest run src/__tests__/kpi-materials-analytics.test.jsx
```
