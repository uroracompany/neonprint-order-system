import { describe, expect, it, vi } from 'vitest'
import handler from '../../api/kpi-data.js'

function createResponse() {
  return {
    status: vi.fn(),
    json: vi.fn(),
  }
}

describe('API de datos KPI', () => {
  it('carga la función y rechaza métodos no permitidos sin invocar el handler', async () => {
    const response = createResponse()
    response.status.mockReturnValue(response)

    await handler({ method: 'GET', headers: {} }, response)

    expect(response.status).toHaveBeenCalledWith(405)
    expect(response.json).toHaveBeenCalledWith({ error: 'Método no permitido' })
  })
})
