# Plan: Unificar Diseño Visual — Producción & Entrega con Caja como Referencia

## Contexto
Los tres paneles de inteligencia (Caja, Producción, Entrega) deben compartir exactamente el mismo lenguaje visual. Caja es el estándar de referencia. Se encontraron **diferencias estructurales y visuales** que impiden que los paneles pertenezcan a la misma familia de componentes.

## Diferencias Clave Encontradas

### 1. GlobalView — Patrón de Tarjetas Resumen (CRÍTICO)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Grid wrapper | `kpi-leader-grid` (5 cols default) | `kpi-hero-grid kpi-hero-grid--4` | `kpi-hero-grid kpi-hero-grid--4` |
| Card class | `kpi-leader-card` | `kpi-seller-hero-card` | `kpi-seller-hero-card` |
| Card background | `var(--surface)` (white) | `linear-gradient(145deg, #fff, #f4f7fb)` | `linear-gradient(145deg, #fff, #f4f7fb)` |
| Card border | `1px solid var(--border)` (#DDE3EF) | `1px solid #e2e8f0` | `1px solid #e2e8f0` |
| Hover effect | `translateY(-2px)` + shadow + `::before` opacity | `box-shadow` + `border-color` only | `box-shadow` + `border-color` only |
| Internal structure | icon(32px) + category + name + value | label(11px) + icon(38px) + value + footer | label(11px) + icon(38px) + value + footer |
| Icon size | 16px | 18px | 18px |
| Icon bg opacity | `${color}15` | `${color}18` | `${color}18` |

**Producción y Entrega usan un patrón de tarjetas diferente al de Caja en su GlobalView.**

### 2. ComparisonCard — Layout Interno (CRÍTICO)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Border izquierdo | `3px solid ${borderColor}` (dinámico) | Ninguno | Ninguno |
| Layout | `textAlign: left` | `textAlign: center` (default CSS) | `textAlign: center` (default CSS) |
| Fila superior | Label + flecha + % change en una línea | Label arriba, value abajo | Label arriba, value abajo |
| Value row | `value → previous` lado a lado | Value + "Anterior: prev" + badge separados | Value + "Anterior: prev" + badge separados |
| Summary line | Texto con icono + resumen "Mejoró en X de Y métricas" | No tiene | No tiene |
| Change display | Flecha + % inline con color | ChangeBadge componente | ChangeBadge componente |

**El ComparisonCard de Caja es significativamente más rico visualmente.**

### 3. LoadingState / ErrorState (MODERADO)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Wrapper | `kpi-seller-page` (con fade-in animation) | `kpi-card` (card plana) | `kpi-card` (card plana) |
| Layout | Flex centrado con `minHeight: 400` | `padding: 40, textAlign: center` | `padding: 40, textAlign: center` |
| Error icon | Círculo rojo 48px de fondo + icono dentro | Icono suelto | Icono suelto |
| Error title | h3 con estilo definido | Div con inline styles | Div con inline styles |

### 4. Alert Placement en Detail View (MODERADO)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Position | Después de `kpi-seller-page-body`, antes de hero grid | Dentro del body, después de charts/before comparison | Dentro del body, después de lists |

### 5. HeroCard — Icon Opacity (MENOR)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Icon bg | `${color}15` | `${color}18` | `${color}18` |

### 6. Chart Header — Date Filter Margins (MENOR)
| Aspecto | Caja (Referencia) | Producción | Entrega |
|---------|-------------------|------------|---------|
| Filter row margin | `marginTop: 8, marginBottom: 8` | `marginTop: 12` | `marginTop: 12` |

---

## Plan de Cambios

### Archivos a modificar
1. `src/components/kpi/KPIProductionIntelligence.jsx`
2. `src/components/kpi/KPIDeliveryIntelligence.jsx`

---

### Paso 1: Unificar GlobalView — Tarjetas Resumen

**Producción (KPIProductionIntelligence.jsx)**

Cambiar el GlobalView para usar `kpi-leader-grid` + `kpi-leader-card` en lugar de `kpi-hero-grid` + `kpi-seller-hero-card`:

```jsx
// Línea ~193: Cambiar wrapper
- <div className="kpi-hero-grid kpi-hero-grid--4" style={{ marginBottom: 24 }}>
+ <div className="kpi-leader-grid" style={{ marginBottom: 24, gridTemplateColumns: 'repeat(4, 1fr)' }}>

// Línea ~126-142: Reemplazar componente HeroCard por estructura kpi-leader-card
// Cada tarjeta debe usar:
//   className="kpi-leader-card"
//   <div className="kpi-leader-header">
//     <div className="kpi-leader-icon" style={{ background: `${color}15`, color }}><Icon size={16} /></div>
//     <div className="kpi-leader-category">{label}</div>
//   </div>
//   <div className="kpi-leader-value" style={{ color }}>{value}</div>
//   {subtitle && <div className="kpi-seller-list-sub" style={{ marginTop: 8 }}>{subtitle}</div>}
```

**Entrega (KPIDeliveryIntelligence.jsx)** — Mismo cambio.

---

### Paso 2: Unificar ComparisonCard

Ambos archivos comparten el mismo `ComparisonCard`. Reemplazarlo con el patrón de Caja:

```jsx
function ComparisonCard({ label, value, prev, change, color = '#091127', inverse = false }) {
  const num = Number(change) || 0
  const isPositive = inverse ? num < 0 : num > 0
  const isNegative = inverse ? num > 0 : num < 0
  const borderColor = isPositive ? '#10B981' : isNegative ? '#EF4444' : '#94A3B8'
  const arrow = num > 0 ? '↑' : num < 0 ? '↓' : '→'
  return (
    <div className="kpi-seller-comparison-card" style={{ borderLeft: `3px solid ${borderColor}`, textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="kpi-seller-comparison-label" style={{ margin: 0 }}>{label}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: borderColor, display: 'flex', alignItems: 'center', gap: 3 }}>
          {arrow} {isPositive ? '+' : ''}{num.toFixed(1)}%
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="kpi-seller-comparison-value">{value}</span>
        <span style={{ fontSize: 13, color: '#94A3B8' }}>→</span>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#94A3B8' }}>{prev}</span>
      </div>
    </div>
  )
}
```

**Producción:** Reemplazar `ComparisonCard` (línea ~265) y agregar summary line antes del grid de comparación.
**Entrega:** Reemplazar `ComparisonCard` (línea ~150) y agregar summary line.

---

### Paso 3: Unificar LoadingState / ErrorState

Ambos archivos tienen LoadingState/ErrorState idénticos. Reemplazarlos con el patrón de Caja:

```jsx
function LoadingState() {
  return (
    <div className="kpi-seller-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div className="kpi-spinner" />
          <p style={{ color: '#4A5E80', fontSize: 14, fontWeight: 500, marginTop: 12 }}>Cargando datos...</p>
        </div>
      </div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className="kpi-seller-page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <div className="kpi-card" style={{ textAlign: 'center', padding: 60 }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 16px', borderRadius: '50%', background: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icons.AlertCircle style={{ color: '#EF4444' }} />
          </div>
          <h3 style={{ fontSize: 16, fontWeight: 600, color: '#991B1B', marginBottom: 8 }}>Error al cargar datos</h3>
          <p style={{ fontSize: 13, color: '#8899B5', marginBottom: 20 }}>{message}</p>
        </div>
      </div>
    </div>
  )
}
```

---

### Paso 4: Unificar HeroCard Icon Opacity

En ambos archivos, el componente `HeroCard` usa `${color}18` para el icon background. Cambiar a `${color}15` para coincidir con Caja:

```jsx
// HeroCard en ambos archivos:
- {Icon && <div className="kpi-seller-hero-icon" style={{ background: `${color}18`, color }}><Icon size={18} /></div>}
+ {Icon && <div className="kpi-seller-hero-icon" style={{ background: `${color}15`, color }}><Icon size={16} /></div>}
```

---

### Paso 5: Unificar Date Filter Margins

En ambos archivos, el `ChartControls` usa `marginTop: 12` para el filtro de fechas. Cambiar a `marginTop: 8, marginBottom: 8`:

```jsx
// ChartControls en ambos archivos:
- <div className="kpi-filter-row" style={{ marginTop: 12 }}>
+ <div className="kpi-filter-row" style={{ marginTop: 8, marginBottom: 8 }}>
```

---

### Paso 6: Mover Alerts en Detail Views (Producción y Entrega)

En Caja, los alerts están **después de `kpi-seller-page-body` y antes del hero grid**. En Producción y Entrega, están dentro del body después de otros contenidos.

**Producción (ProductionAreaDetailView):**
- Mover la sección de bottlenecks/alerts (línea ~473-485) para que aparezca **antes** de los charts, justo después del hero grid.

**Entrega (DeliveryDetailView):**
- Mover la sección de alerts (línea ~453-465) para que aparezca **antes** del primer chart card, justo después del hero grid.

---

## Verificación
1. Ejecutar lint después de cada cambio
2. Verificar que no hay errores de JSX
3. Revisar que los imports no tengan elementos no usados
