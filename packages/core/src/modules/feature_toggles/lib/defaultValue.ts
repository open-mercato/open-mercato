/**
 * The default-value field renders an unset value as the type's empty value (False, '', 0), so the
 * submitted value is coerced to what the operator saw instead of persisting a `null` they never chose.
 */
export function normalizeDefaultValueForType(type: unknown, value: unknown): unknown {
  switch (type) {
    case 'boolean':
      return value === true || value === 'true'
    case 'string':
      return value ?? ''
    case 'number':
      return value ?? 0
    default:
      return value
  }
}
