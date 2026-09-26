import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260921000000_admin_orders_statistics.sql'),
  'utf8',
)

describe('admin order statistics RPC contract', () => {
  it('uses exclusive Asunción civil-day bounds and keeps zero-activity days', () => {
    expect(migration).toContain("'America/Asuncion'")
    expect(migration).toContain("v_period_end - interval '1 microsecond'")
    expect(migration).toContain('o.created_at >= v_period_start')
    expect(migration).toContain('o.created_at < v_period_end')
    expect(migration).toContain("(o.created_at AT TIME ZONE 'America/Asuncion')::date = d.day")
  })

  it('deduplicates file references and only falls back to legacy order material', () => {
    expect(migration).toContain('SELECT DISTINCT ON (order_id, material_key)')
    expect(migration).toContain('NOT EXISTS (')
    expect(migration).toContain('FROM file_materials_per_order')
    expect(migration).toContain("regexp_split_to_table(coalesce(po.material, ''), '[,;/|]+')")
  })

  it('does not classify delivered orders as active and limits RPC execution', () => {
    const activeSection = migration.slice(migration.indexOf('-- 2. Órdenes activas'), migration.indexOf('-- 3. Órdenes canceladas'))
    const creditSection = migration.slice(migration.indexOf('-- 6. Órdenes activas a crédito'), migration.indexOf('-- 7. Prioridad'))
    expect(activeSection).not.toContain("'in_delivered'")
    expect(creditSection).not.toContain("'in_delivered'")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.kpi_admin_orders_statistics')
    expect(migration).toContain('TO authenticated')
  })
})
