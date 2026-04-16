export type ReturnAvailableInput = {
  quantity: number
  returnedQuantity: number
}

export function computeAvailableReturnQuantity(line: ReturnAvailableInput): number {
  const raw = line.quantity - line.returnedQuantity
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.max(0, Math.floor(raw + 1e-6))
}
