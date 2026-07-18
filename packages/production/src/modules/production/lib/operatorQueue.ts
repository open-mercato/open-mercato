/**
 * Pure work-queue filtering logic for the operator "lite" panel (task 4.3,
 * spec § API Contracts: `production.operator.view`). Joins released/
 * in_progress order header rows with their reporting-point operations for a
 * single work center, matching only pending/in_progress operations.
 *
 * Kept pure/unit-testable on purpose (no ORM/em access) so both the API
 * route (real query result rows) and unit tests (fixture rows) can exercise
 * the exact same join/filter/sort logic.
 */

export type OperatorQueueOrder = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  status: 'released' | 'in_progress' | string
  updatedAt: string
}

export type OperatorQueueOperation = {
  id: string
  orderId: string
  sequence: number
  name: string
  workCenterId: string
  isReportingPoint: boolean
  status: 'pending' | 'in_progress' | 'done' | string
}

export type OperatorQueueItem = {
  orderId: string
  orderNumber: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  orderUpdatedAt: string
  operationId: string
  sequence: number
  name: string
  operationStatus: 'pending' | 'in_progress'
}

const ELIGIBLE_ORDER_STATUSES = new Set(['released', 'in_progress'])
const ELIGIBLE_OPERATION_STATUSES = new Set(['pending', 'in_progress'])

export function selectOperatorQueue(
  orders: OperatorQueueOrder[],
  operations: OperatorQueueOperation[],
  workCenterId: string,
): OperatorQueueItem[] {
  const orderById = new Map(orders.map((order) => [order.id, order]))

  const items = operations
    .filter((operation) => operation.workCenterId === workCenterId)
    .filter((operation) => operation.isReportingPoint)
    .filter((operation) => ELIGIBLE_OPERATION_STATUSES.has(operation.status))
    .map((operation): OperatorQueueItem | null => {
      const order = orderById.get(operation.orderId)
      if (!order) return null
      if (!ELIGIBLE_ORDER_STATUSES.has(order.status)) return null
      return {
        orderId: order.id,
        orderNumber: order.number,
        productId: order.productId,
        variantId: order.variantId,
        qtyPlanned: order.qtyPlanned,
        orderUpdatedAt: order.updatedAt,
        operationId: operation.id,
        sequence: operation.sequence,
        name: operation.name,
        operationStatus: operation.status as 'pending' | 'in_progress',
      }
    })
    .filter((item): item is OperatorQueueItem => item !== null)

  return items.sort((a, b) => a.sequence - b.sequence || a.orderNumber - b.orderNumber)
}
