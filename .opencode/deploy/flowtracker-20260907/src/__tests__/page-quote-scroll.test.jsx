import '../css-components/page-quote.css'

function findCssRule(selectorText) {
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText === selectorText) {
          return rule.style
        }
      }
    } catch {
      // skip cross-origin sheets
    }
  }
  return null
}

describe('page-quote.css - reglas de scroll', () => {
  test('.pq-root tiene height: 100vh para contener el viewport', () => {
    const style = findCssRule('.pq-root')
    expect(style).not.toBeNull()
    expect(style.height).toBe('100vh')
  })

  test('.pq-root NO debe tener min-height: 100vh (debe ser height)', () => {
    const style = findCssRule('.pq-root')
    expect(style.minHeight).toBe('')
  })

  test('.pq-main tiene overflow-y: auto para scroll vertical', () => {
    const style = findCssRule('.pq-main')
    expect(style).not.toBeNull()
    expect(style.overflowY).toBe('auto')
  })

  test('.pq-section tiene display: flex y flex-direction: column', () => {
    const style = findCssRule('.pq-section')
    expect(style).not.toBeNull()
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('column')
  })

  test('.pq-orders-grid NO tiene max-height ni overflow-y', () => {
    const style = findCssRule('.pq-orders-grid')
    expect(style).not.toBeNull()
    expect(style.maxHeight).toBe('')
    expect(style.overflowY).toBe('')
  })

  test('scrollbar global usa estilo del seller: gradiente en el thumb', () => {
    const style = findCssRule('.pq-root ::-webkit-scrollbar-thumb')
    expect(style).not.toBeNull()
    expect(style.background).toContain('linear-gradient')
    expect(style.borderRadius).toBe('4px')
  })
})
