import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('selector de período del banner KPI', () => {
  it('permite que el menú se muestre fuera del banner y por encima del contenido posterior', () => {
    const styles = readProjectFile('src/css-components/page-kpi.css')

    expect(styles).toContain('.kpi-banner {\n  position: relative;\n  z-index: 2;\n  overflow: visible;')
    expect(styles).toContain('.kpi-banner-period-control { position: relative; z-index: 3;')
    expect(styles).toContain('.kpi-banner-period-control .pp-filter-dropdown { z-index: 4; }')
  })
})
