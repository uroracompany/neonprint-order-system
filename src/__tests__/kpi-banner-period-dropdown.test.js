import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const readProjectFile = path => readFileSync(join(process.cwd(), path), 'utf8')

describe('selector de período del banner KPI', () => {
  it('permite que el menú se muestre fuera del banner y por encima del contenido posterior', () => {
    const styles = readProjectFile('src/css-components/page-kpi.css').replace(/\r\n/g, '\n')
    const bannerRules = [...styles.matchAll(/\.kpi-banner\s*\{([^}]*)\}/g)]
    const effectiveBannerRule = bannerRules.at(-1)?.[1] || ''

    expect(effectiveBannerRule).toMatch(/position:\s*relative;/)
    expect(effectiveBannerRule).toMatch(/z-index:\s*2;/)
    expect(effectiveBannerRule).toMatch(/overflow:\s*visible;/)
    expect(styles).toContain('.kpi-banner-period-control { position: relative; z-index: 3;')
    expect(styles).toContain('.kpi-banner-period-control .pp-filter-dropdown { z-index: 4; }')
  })
})
