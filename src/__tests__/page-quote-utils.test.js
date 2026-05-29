import { describe, it, expect } from 'vitest'
import { ORDER_STATUS } from '../utils/constants'

const normalizeText = (value) => String(value || "").trim().toLowerCase()

const getOrderFiles = (order) => {
  if (!order?.order_file_url) return []
  try {
    const parsed = JSON.parse(order.order_file_url)
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return [order.order_file_url]
  }
}

const isReturnedOrder = (order, statuses) =>
  statuses?.some(s => order?.status === s) && Boolean(String(order?.return_reason || "").trim())

const isQuoteEditable = (order, targetStatus) =>
  order?.status === targetStatus && order?.payment_status !== "pagado" && !order?.is_archived_quote

const canArchiveQuoteOrder = (order) =>
  order?.payment_status === "pagado" && !order?.is_archived_quote

const resolveSellerName = (order, sellerDirectory) =>
  order?.seller_name || sellerDirectory?.[resolveSellerId(order)] || "No definido"

const resolveSellerId = (order) => order?.seller_id || order?.created_by || null

describe('normalizeText', () => {
  it('normaliza a minúsculas y sin espacios', () => {
    expect(normalizeText('  Hello World  ')).toBe('hello world')
  })
  it('maneja valores nulos/undefined', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
  })
  it('maneja strings vacíos', () => {
    expect(normalizeText('')).toBe('')
  })
})

describe('getOrderFiles', () => {
  it('retorna array vacío si no hay order_file_url', () => {
    expect(getOrderFiles({})).toEqual([])
    expect(getOrderFiles({ order_file_url: null })).toEqual([])
  })
  it('parsea JSON array correctamente', () => {
    const order = { order_file_url: JSON.stringify(['file1.pdf', 'file2.pdf']) }
    expect(getOrderFiles(order)).toEqual(['file1.pdf', 'file2.pdf'])
  })
  it('envuelve objeto único en array', () => {
    const order = { order_file_url: JSON.stringify({ url: 'file.pdf' }) }
    expect(getOrderFiles(order)).toEqual([{ url: 'file.pdf' }])
  })
  it('retorna URL directa si no es JSON válido', () => {
    const order = { order_file_url: 'https://example.com/file.pdf' }
    expect(getOrderFiles(order)).toEqual(['https://example.com/file.pdf'])
  })
})

describe('isReturnedOrder', () => {
  const returnStatuses = [ORDER_STATUS.IN_DESIGN, ORDER_STATUS.PENDING]
  it('detecta orden devuelta correctamente', () => {
    const order = { status: ORDER_STATUS.IN_DESIGN, return_reason: 'Corregir color' }
    expect(isReturnedOrder(order, returnStatuses)).toBe(true)
  })
  it('retorna false si no tiene return_reason', () => {
    const order = { status: ORDER_STATUS.IN_DESIGN, return_reason: '' }
    expect(isReturnedOrder(order, returnStatuses)).toBe(false)
  })
  it('retorna false si el status no coincide', () => {
    const order = { status: ORDER_STATUS.IN_QUOTE, return_reason: 'Razón' }
    expect(isReturnedOrder(order, returnStatuses)).toBe(false)
  })
})

describe('isQuoteEditable', () => {
  it('retorna true si está en cotización, no pagada, no archivada', () => {
    const order = { status: ORDER_STATUS.IN_QUOTE, payment_status: 'pendiente', is_archived_quote: false }
    expect(isQuoteEditable(order, ORDER_STATUS.IN_QUOTE)).toBe(true)
  })
  it('retorna false si está pagada', () => {
    const order = { status: ORDER_STATUS.IN_QUOTE, payment_status: 'pagado', is_archived_quote: false }
    expect(isQuoteEditable(order, ORDER_STATUS.IN_QUOTE)).toBe(false)
  })
  it('retorna false si está archivada', () => {
    const order = { status: ORDER_STATUS.IN_QUOTE, payment_status: 'pendiente', is_archived_quote: true }
    expect(isQuoteEditable(order, ORDER_STATUS.IN_QUOTE)).toBe(false)
  })
})

describe('canArchiveQuoteOrder', () => {
  it('retorna true si está pagada y no archivada', () => {
    expect(canArchiveQuoteOrder({ payment_status: 'pagado', is_archived_quote: false })).toBe(true)
  })
  it('retorna false si no está pagada', () => {
    expect(canArchiveQuoteOrder({ payment_status: 'pendiente', is_archived_quote: false })).toBe(false)
  })
  it('retorna false si ya está archivada', () => {
    expect(canArchiveQuoteOrder({ payment_status: 'pagado', is_archived_quote: true })).toBe(false)
  })
})

describe('resolveSellerName', () => {
  it('usa seller_name si existe', () => {
    expect(resolveSellerName({ seller_name: 'Juan' }, {})).toBe('Juan')
  })
  it('busca en el directorio por defecto', () => {
    const sellerDirectory = { 'user123': 'Maria' }
    expect(resolveSellerName({ seller_id: 'user123' }, sellerDirectory)).toBe('Maria')
  })
  it('retorna valor por defecto si no encuentra', () => {
    expect(resolveSellerName({}, {})).toBe('No definido')
  })
})
