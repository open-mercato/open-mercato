export function parseInventoryQuantity(value: string | number | null | undefined): number {
  if (value == null || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function computeCycleCountVariance(systemOnHand: number, countedQuantity: number): number {
  return countedQuantity - systemOnHand
}

export function formatSignedQuantity(value: number): string {
  if (value > 0) return `+${value}`
  return String(value)
}

export function buildInventoryMutationReferenceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`
}
