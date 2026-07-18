import { classifyLateAtRiskOrders, type LateAtRiskOrderRow } from '../lateOrders.js'

function makeOrder(overrides: Partial<LateAtRiskOrderRow> = {}): LateAtRiskOrderRow {
  return {
    id: 'order-1',
    number: 1,
    productId: 'product-1',
    variantId: null,
    qtyPlanned: '100',
    qtyCompleted: '0',
    dueDate: '2026-07-19T00:00:00.000Z',
    status: 'released',
    ...overrides,
  }
}

const NOW = new Date('2026-07-19T12:00:00.000Z')

describe('classifyLateAtRiskOrders', () => {
  it('classifies a due date strictly in the past as late, with correct daysLate', () => {
    const order = makeOrder({ dueDate: '2026-07-16T00:00:00.000Z' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(1)
    expect(result[0].classification).toBe('late')
    expect(result[0].daysLate).toBe(3)
  })

  it('boundary: a due date exactly today (regardless of time-of-day) is at_risk, never late', () => {
    const order = makeOrder({ dueDate: '2026-07-19T23:59:00.000Z' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(1)
    expect(result[0].classification).toBe('at_risk')
    expect(result[0].daysUntilDue).toBe(0)
  })

  it('boundary: a due date exactly atRiskDays away is included as at_risk (inclusive upper bound)', () => {
    const order = makeOrder({ dueDate: '2026-07-26T00:00:00.000Z' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(1)
    expect(result[0].classification).toBe('at_risk')
    expect(result[0].daysUntilDue).toBe(7)
  })

  it('boundary: a due date one day beyond atRiskDays window is excluded entirely', () => {
    const order = makeOrder({ dueDate: '2026-07-27T00:00:00.000Z' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(0)
  })

  it('excludes completed orders even when overdue (status filter, defensive re-assertion)', () => {
    const order = makeOrder({ dueDate: '2026-07-01T00:00:00.000Z', status: 'completed' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(0)
  })

  it('excludes closed and cancelled orders', () => {
    const closed = makeOrder({ id: 'order-closed', dueDate: '2026-07-01T00:00:00.000Z', status: 'closed' })
    const cancelled = makeOrder({ id: 'order-cancelled', dueDate: '2026-07-01T00:00:00.000Z', status: 'cancelled' })
    const result = classifyLateAtRiskOrders([closed, cancelled], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(0)
  })

  it('excludes orders with no remaining quantity (qtyCompleted >= qtyPlanned) even if overdue', () => {
    const order = makeOrder({ dueDate: '2026-07-01T00:00:00.000Z', qtyPlanned: '50', qtyCompleted: '50' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(0)
  })

  it('excludes orders with no due date', () => {
    const order = makeOrder({ dueDate: null })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(0)
  })

  it('includes in_progress orders with a future due date within the window', () => {
    const order = makeOrder({ status: 'in_progress', dueDate: '2026-07-22T00:00:00.000Z' })
    const result = classifyLateAtRiskOrders([order], { now: NOW, atRiskDays: 7 })
    expect(result).toHaveLength(1)
    expect(result[0].classification).toBe('at_risk')
  })
})
