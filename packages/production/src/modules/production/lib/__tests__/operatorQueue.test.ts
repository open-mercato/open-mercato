export {}

import { selectOperatorQueue } from '../operatorQueue.js'

const baseOrder = {
  id: 'order-1',
  number: 100,
  productId: 'product-1',
  variantId: null,
  qtyPlanned: '10',
  status: 'released' as const,
  updatedAt: '2026-07-18T10:00:00.000Z',
}

const baseOperation = {
  id: 'op-1',
  orderId: 'order-1',
  sequence: 10,
  name: 'Cut',
  workCenterId: 'wc-1',
  isReportingPoint: true,
  status: 'pending' as const,
}

describe('selectOperatorQueue', () => {
  it('returns reporting-point pending/in_progress operations for released/in_progress orders on the given work center', () => {
    const result = selectOperatorQueue([baseOrder], [baseOperation], 'wc-1')
    expect(result).toEqual([
      {
        orderId: 'order-1',
        orderNumber: 100,
        productId: 'product-1',
        variantId: null,
        qtyPlanned: '10',
        orderUpdatedAt: '2026-07-18T10:00:00.000Z',
        operationId: 'op-1',
        sequence: 10,
        name: 'Cut',
        operationStatus: 'pending',
      },
    ])
  })

  it('excludes operations for a different work center', () => {
    expect(selectOperatorQueue([baseOrder], [baseOperation], 'wc-2')).toEqual([])
  })

  it('excludes non-reporting-point operations', () => {
    const op = { ...baseOperation, isReportingPoint: false }
    expect(selectOperatorQueue([baseOrder], [op], 'wc-1')).toEqual([])
  })

  it('excludes already-done operations', () => {
    const op = { ...baseOperation, status: 'done' as const }
    expect(selectOperatorQueue([baseOrder], [op], 'wc-1')).toEqual([])
  })

  it('excludes operations whose order is not released/in_progress', () => {
    const order = { ...baseOrder, status: 'draft' as const }
    expect(selectOperatorQueue([order], [baseOperation], 'wc-1')).toEqual([])
  })

  it('includes in_progress operations for in_progress orders', () => {
    const order = { ...baseOrder, status: 'in_progress' as const }
    const op = { ...baseOperation, status: 'in_progress' as const }
    const result = selectOperatorQueue([order], [op], 'wc-1')
    expect(result).toHaveLength(1)
    expect(result[0].operationStatus).toBe('in_progress')
  })

  it('drops operations whose order cannot be found', () => {
    const orphanOp = { ...baseOperation, orderId: 'missing-order' }
    expect(selectOperatorQueue([baseOrder], [orphanOp], 'wc-1')).toEqual([])
  })

  it('sorts by operation sequence, then by order number', () => {
    const orderA = { ...baseOrder, id: 'order-a', number: 200 }
    const orderB = { ...baseOrder, id: 'order-b', number: 100 }
    const opA = { ...baseOperation, id: 'op-a', orderId: 'order-a', sequence: 10 }
    const opB = { ...baseOperation, id: 'op-b', orderId: 'order-b', sequence: 10 }
    const result = selectOperatorQueue([orderA, orderB], [opA, opB], 'wc-1')
    expect(result.map((r) => r.orderNumber)).toEqual([100, 200])
  })
})
