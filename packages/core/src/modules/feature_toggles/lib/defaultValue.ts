function toNumberDefault(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

/**
 * The single reading of a default value for its toggle type, shared by the default-value field and
 * the submit payload, so what the operator sees is what is persisted — including a value left over
 * after switching the type, which the typed resolver would otherwise reject as `INVALID_VALUE`.
 */
export function normalizeDefaultValueForType(type: unknown, value: unknown): unknown {
  switch (type) {
    case 'boolean':
      return value === true || value === 'true'
    case 'string':
      return typeof value === 'string' ? value : ''
    case 'number':
      return toNumberDefault(value)
    default:
      return value
  }
}
