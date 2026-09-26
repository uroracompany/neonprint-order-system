/* global process */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('desglose de origen de diseño en materiales (fallback transitorio)', () => {
  const handler = () => readProjectFile('server/kpi-data-handler.js')

  it('el resumen transitorio consulta y desglosa el origen del diseño', () => {
    const source = handler()

    expect(source).toContain("'order_design_type'")
    expect(source).toContain("isInternalDesign = designType === 'INTERNAL_DESING'")
    expect(source).toContain("isExternalDesign = designType === 'EXTERNAL_DESING'")
    expect(source).toContain('internal_design_orders: m.internal')
    expect(source).toContain('external_design_orders: m.external')
  })

  it('el resumen de comparación transitorio mantiene el mismo desglose', () => {
    const source = handler()

    expect(source).toContain("internal_design_orders: m.internal,")
    expect(source).toContain("external_design_orders: m.external,")
    expect(source).toContain("normal_orders: m.normal,")
    expect(source).toContain("urgent_orders: m.urgent,")
  })

  it('la migración habilita el RPC verificado para llamadas proxyadas por el servidor', () => {
    const migration = readProjectFile('supabase/migrations/20260819000000_allow_service_role_admin_kpi_rpcs.sql')

    expect(migration).toContain('create or replace function public.current_profile_is_admin()')
    expect(migration).toContain("auth.jwt() ->> 'role'")
    expect(migration).toContain("'service_role'")
  })

  it('la interfaz señala la fuente transitoria en lugar de ocultarla', () => {
    const component = readProjectFile('src/components/kpi/KPIMaterialsAnalytics.jsx')

    expect(component).toContain('kpi-materials-legacy-notice')
    expect(component).toContain('Fuente de datos transitoria activa')
  })
})
