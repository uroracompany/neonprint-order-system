/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('modal de material: rendimiento global por defecto con períodos selectivos', () => {
  const modal = () => readProjectFile('src/components/kpi/MaterialDetailModal.jsx')
  const panel = () => readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')

  it('consulta el contrato verificado con el rango del período activo', () => {
    expect(modal()).toContain("useKPISingle('materials_analytics'")
    expect(modal()).toContain("getModeBounds(periodMode, periodMeta, dayValue, rangeFrom, rangeTo)")
    expect(modal()).toContain('getMaterialGlobalBounds()')
    expect(modal()).toContain('MATERIAL_GLOBAL_START')
  })

  it('expone el rendimiento global como vista predeterminada y los períodos opcionales', () => {
    expect(modal()).toContain("useState('global')")
    expect(modal()).toContain("{ value: 'global', label: 'Rendimiento global' }")
    expect(modal()).toContain("{ value: 'current', label: 'Período actual' }")
    expect(modal()).toContain("{ value: 'previous', label: 'Período anterior' }")
    expect(modal()).toContain("{ value: 'day', label: 'Fecha específica' }")
    expect(modal()).toContain("{ value: 'range', label: 'Rango de fechas' }")
    expect(modal()).toContain("label=\"Cancelación\"")
    expect(modal()).toContain('Rendimiento global del material: todo el historial registrado.')
  })

  it('no mezcla el total del banner con el total del período consultado', () => {
    expect(modal()).toContain('detailQuery.data?.period?.material_references')
    expect(modal()).toContain("periodMode === 'current' || !requestBounds")
  })

  it('calcula Cancelación con órdenes únicas del mismo rango del detalle', () => {
    const sql = readProjectFile('supabase/migrations/20260820010000_material_cancellation_stats.sql')
    const handler = readProjectFile('server/kpi-data-handler.js')

    expect(modal()).toContain("useKPISingle('material_cancellation_stats'")
    expect(sql).toContain('SELECT DISTINCT')
    expect(sql).toContain("count(*) FILTER (WHERE status = 'cancelled')")
    expect(sql).toContain("coalesce(o.is_archived, false) = false")
    expect(handler).toContain("case 'material_cancellation_stats'")
    expect(handler).toContain("supabase.rpc('kpi_material_cancellation_stats'")
  })

  it('recibe el usuario y el meta del período desde el panel de materiales', () => {
    expect(panel()).toContain('periodMeta={rankingAnalytics?.meta || materialMeta}')
    expect(modal()).toContain('periodMeta,')
    expect(modal()).toContain('userId,')
  })
})
