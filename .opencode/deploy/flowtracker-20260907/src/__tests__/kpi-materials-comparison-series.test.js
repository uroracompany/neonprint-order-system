/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('serie comparativa exacta de materiales', () => {
  const migration = () => readProjectFile('supabase/migrations/20260816010000_materials_comparison_series.sql')
  const recoveryMigration = () => readProjectFile('supabase/migrations/20260816011000_recover_materials_comparison_series.sql')
  const scopeFixMigration = () => readProjectFile('supabase/migrations/20260816012000_fix_materials_comparison_cte_scope.sql')

  it('cuenta órdenes únicas y variedad después de aplicar filtros', () => {
    const sql = migration()

    expect(sql).toContain('filtered_refs AS')
    expect(sql).toContain('count(DISTINCT order_id) AS orders_with_material')
    expect(sql).toContain('count(DISTINCT material_key) AS materials_used')
    expect(sql).toContain("p_order_type = 'urgent'")
    expect(sql).toContain("p_design_type = 'internal'")
  })

  it('devuelve series de ambos períodos y exige duración equivalente', () => {
    const sql = migration()

    expect(sql).toContain("'timeline'")
    expect(sql).toContain("to_char(created_at AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD')")
    expect(sql).toContain("'Los períodos comparados deben tener la misma duración.'")
  })

  it('expone una acción autenticada con filtros validados', () => {
    const handler = readProjectFile('server/kpi-data-handler.js')

    expect(handler).toContain("case 'materials_comparison_series'")
    expect(handler).toContain("supabase.rpc('kpi_materials_comparison_series'")
    expect(handler).toContain("['normal', 'urgent'].includes(orderType)")
    expect(handler).toContain("['internal', 'external'].includes(designType)")
  })

  it('recupera el RPC, recarga su caché y calcula variedad por bloque', () => {
    const sql = recoveryMigration()

    expect(sql).toContain('DROP FUNCTION IF EXISTS public.kpi_materials_comparison_series')
    expect(sql).toContain("p_granularity text DEFAULT 'day'")
    expect(sql).toContain("count(DISTINCT material_key) AS materials_used")
    expect(sql).toContain("'bucket_index', bucket_index")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
    expect(sql).toContain('reference_count')
    expect(sql).not.toContain("'references', references")
  })

  it('envía granularidad y diferencia una fuente no disponible', () => {
    const handler = readProjectFile('server/kpi-data-handler.js')
    const component = readProjectFile('src/components/kpi/MaterialsComparisonPanel.jsx')

    expect(handler).toContain("p_granularity: granularity")
    expect(handler).toContain('MATERIALS_COMPARISON_SOURCE_UNAVAILABLE')
    expect(component).toContain('granularity: granularity.key')
    expect(component).toContain('Datos de comparación no disponibles')
    expect(component).toContain('isPlaceholderData')
  })

  it('construye el resultado del RPC dentro de una sola sentencia CTE', () => {
    const sql = scopeFixMigration()

    expect(sql).toContain('materials_json AS')
    expect(sql).toContain('period_json AS')
    expect(sql).toContain('comparison_json AS')
    expect(sql).toContain('FROM materials_json CROSS JOIN period_json CROSS JOIN comparison_json')
    expect(sql).toContain("'bucket_index', bucket_index")
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'")
  })
})
