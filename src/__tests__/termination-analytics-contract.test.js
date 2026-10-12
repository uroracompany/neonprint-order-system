import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const read = file => readFileSync(resolve(process.cwd(), file), 'utf8')
const migration = read('supabase/migrations/20261011170000_kpi_terminations_analytics.sql')
const handler = read('server/kpi-data-handler.js')
const modal = read('src/components/kpi/TerminationDetailModal.jsx')

describe('Analítica de terminaciones', () => {
  it('expone la RPC administrativa con el contrato de períodos', () => {
    expect(handler).toContain("case 'terminations_analytics'")
    expect(handler).toContain("supabase.rpc('kpi_terminations_analytics'")
    expect(handler).toContain('p_termination_id: termination_id')
    expect(handler).toContain('p_production_area_code: production_area_code')
    expect(migration).toContain('create or replace function public.kpi_terminations_analytics(')
    expect(migration).toContain('if not public.current_profile_is_admin() then')
    expect(migration).toContain('security invoker')
    expect(migration).toContain('revoke all on function public.kpi_terminations_analytics')
    expect(migration).toContain('grant execute on function public.kpi_terminations_analytics')
  })

  it('mantiene file-first, fallback histórico y deduplicación por orden-terminación', () => {
    expect(migration).toContain('public.order_production_files f on f.order_id = so.order_id')
    expect(migration).toContain('f.termination_name')
    expect(migration).toContain('not exists (')
    expect(migration).toContain('public.orders o')
    expect(migration).toContain("regexp_split_to_table(coalesce(so.termination_type, ''), '[,;/|]+'")
    expect(migration).toContain('distinct on (scope, order_id, termination_identity)')
    expect(migration).toContain('catalog_match')
    expect(migration).toContain('public.clients c on c.id = r2.client_id')
    expect(migration).toContain('having count(*) = 1')
  })

  it('conecta el adaptador con la acción y la identidad correctas', () => {
    expect(modal).toContain('analyticsAction="terminations_analytics"')
    expect(modal).toContain('entityIdField="termination_id"')
    expect(modal).toContain('entityType="termination"')
  })
})
