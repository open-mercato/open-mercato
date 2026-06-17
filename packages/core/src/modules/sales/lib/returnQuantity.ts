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
