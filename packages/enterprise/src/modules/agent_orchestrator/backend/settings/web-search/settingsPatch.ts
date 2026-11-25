function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function equalValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalValues(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const keys = Object.keys(left).filter((key) => left[key] !== undefined)
  const otherKeys = Object.keys(right).filter((key) => right[key] !== undefined)
  return keys.length === otherKeys.length && keys.every((key) => equalValues(left[key], right[key]))
}

export function buildWebSearchSettingsPatch(current: Record<string, unknown>, baseline: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(current).flatMap(([key, value]) => {
    let previous = baseline[key]
    if (key === 'guardrails' && isRecord(previous)) {
      previous = Object.fromEntries(Object.entries(previous).filter(([name]) => name !== 'allowPrivateHosts'))
    }
    if (key === 'adapterOptions' && isRecord(value)) {
      const saved = isRecord(previous) ? previous : {}
      const changed = Object.fromEntries(Object.entries(value).filter(([adapter, options]) => !equalValues(options, saved[adapter])))
      return Object.keys(changed).length ? [[key, changed]] : []
    }
    return equalValues(value, previous) ? [] : [[key, value]]
  }))
}
