import { isProtoPollutingKey, writeByDotPath } from './form-field-paths'

type FormRecord = Record<string, unknown>

function isPlainRecord(value: unknown): value is FormRecord {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function isPayloadValue(value: unknown, ancestors: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (value instanceof Date) return Number.isFinite(value.getTime())
  if (!(Array.isArray(value) || isPlainRecord(value)) || ancestors.has(value)) return false
  ancestors.add(value)
  const valid = Object.entries(value).every(([key, child]) => !isProtoPollutingKey(key) && isPayloadValue(child, ancestors))
  ancestors.delete(value)
  return valid
}

export function readPayloadLeaves(value: unknown): Map<string, unknown> | null {
  if (!isPlainRecord(value)) return null
  const leaves = new Map<string, unknown>()
  const ancestors = new Set<object>()
  function visit(record: FormRecord, prefix: string): boolean {
    if (ancestors.has(record)) return false
    ancestors.add(record)
    for (const [key, child] of Object.entries(record)) {
      if (!key || key.includes('.') || isProtoPollutingKey(key)) return false
      if (child === undefined) continue
      const path = prefix ? `${prefix}.${key}` : key
      if (prefix !== 'customFields' && isPlainRecord(child) && Object.keys(child).length) {
        if (!visit(child, path)) return false
      } else if (isPayloadValue(child, ancestors)) {
        leaves.set(path, child)
      } else return false
    }
    ancestors.delete(record)
    return true
  }
  return visit(value, '') ? leaves : null
}

export function appendLeaves(
  payload: FormRecord, fragment: ReadonlyMap<string, unknown>, claimed: Set<string>, branches: Set<string>,
): boolean {
  for (const [path, value] of fragment) {
    if (claimed.has(path) || branches.has(path)) return false
    let boundary = path.indexOf('.')
    while (boundary !== -1) {
      const prefix = path.slice(0, boundary)
      if (claimed.has(prefix)) return false
      branches.add(prefix)
      boundary = path.indexOf('.', boundary + 1)
    }
    claimed.add(path)
    writeByDotPath(payload, path, value)
  }
  return true
}

export function mergeCrudFormSectionFragments(
  fragments: readonly { fragment: Readonly<FormRecord>; owned: ReadonlySet<string> }[],
): FormRecord | null {
  const payload: FormRecord = {}
  const paths = new Set<string>()
  const branches = new Set<string>()
  for (const { fragment, owned } of fragments) {
    const leaves = readPayloadLeaves(fragment)
    if (!leaves || [...leaves.keys()].some((path) => !owned.has(path)) || !appendLeaves(payload, leaves, paths, branches)) return null
  }
  return payload
}
