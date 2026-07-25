export type ReturnAvailableInput = {
  quantity: number
  returnedQuantity: number
  shippedQuantity?: number
}

export function computeAvailableReturnQuantity(line: ReturnAvailableInput): number {
  const cap =
    typeof line.shippedQuantity === 'number' && Number.isFinite(line.shippedQuantity)
      ? Math.min(line.quantity, line.shippedQuantity)
      : line.quantity
  const raw = cap - line.returnedQuantity
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.max(0, Math.floor(raw + 1e-6))
}

function coerceQuantity(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/**
 * Aggregate shipped quantity per order line from the `/api/sales/shipments`
 * list payload. Mirrors the server-side `loadShippedQuantityByLine` cap so the
 * Return dialog's "Available" figure matches what `sales.returns.create`
 * enforces. Each shipment exposes its lines under `items` (either the
 * persisted snapshot or DB-grouped rows), both carrying `orderLineId` and
 * `quantity`.
 */
export function sumShippedQuantityByLine(
  shipments: ReadonlyArray<Record<string, unknown>> | null | undefined,
): Map<string, number> {
  const shippedByLine = new Map<string, number>()
  if (!Array.isArray(shipments)) return shippedByLine
  for (const shipment of shipments) {
    if (!shipment || typeof shipment !== 'object') continue
    const lineItems = (shipment as Record<string, unknown>).items
    if (!Array.isArray(lineItems)) continue
    for (const lineItem of lineItems) {
      if (!lineItem || typeof lineItem !== 'object') continue
      const record = lineItem as Record<string, unknown>
      const orderLineId =
        typeof record.orderLineId === 'string'
          ? record.orderLineId
          : typeof record.order_line_id === 'string'
            ? record.order_line_id
            : null
      if (!orderLineId) continue
      shippedByLine.set(orderLineId, (shippedByLine.get(orderLineId) ?? 0) + coerceQuantity(record.quantity))
    }
  }
  return shippedByLine
}
