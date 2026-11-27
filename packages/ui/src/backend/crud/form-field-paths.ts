export function readByDotPath(source: Record<string, unknown> | undefined, path: string, ownOnly = false): unknown {
  if (!source || !path) return undefined
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path]
  const segments = path.split('.').filter(Boolean)
  let current: unknown = source
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || (ownOnly && !Object.hasOwn(current, segment))) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

// Keys that would mutate the prototype chain if used as dot-path segments.
// Guard against them so a declared field id such as `__proto__.polluted` can
// never reach into Object.prototype (prototype-pollution hardening).
const PROTO_POLLUTING_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

export function isProtoPollutingKey(key: string): boolean {
  return PROTO_POLLUTING_KEYS.has(key)
}

export function writeByDotPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) return
  if (segments.some(isProtoPollutingKey)) return
  let current: Record<string, unknown> = target
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]
    const existing = current[segment]
    const isSafeObject =
      !!existing &&
      typeof existing === 'object' &&
      !Array.isArray(existing) &&
      (Object.getPrototypeOf(existing) === Object.prototype || Object.getPrototypeOf(existing) === null)

    if (!isSafeObject) {
      const created = Object.create(null) as Record<string, unknown>
      current[segment] = created
      current = created
    } else {
      current = existing as Record<string, unknown>
    }
  }
  const finalSegment = segments[segments.length - 1]
  if (isProtoPollutingKey(finalSegment)) return
  current[finalSegment] = value
}

export function readInitialCustomFieldValue(
  source: Record<string, unknown> | undefined,
  key: string,
): unknown {
  if (!source || !key) return undefined
  const candidates = [`cf_${key}`, `cf:${key}`, key]
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(source, candidate)) {
      return source[candidate]
    }
  }
  return undefined
}

export function readRenderedFieldValue(
  source: Record<string, unknown>,
  fieldId: string,
): unknown {
  if (Object.prototype.hasOwnProperty.call(source, fieldId)) {
    return source[fieldId]
  }
  if (fieldId.startsWith('cf_')) {
    return readInitialCustomFieldValue(source, fieldId.slice(3))
  }
  if (fieldId.startsWith('cf:')) {
    return readInitialCustomFieldValue(source, fieldId.slice(3))
  }
  return fieldId.includes('.') ? readByDotPath(source, fieldId) : undefined
}

export function parseCrudFormOwnedPath(path: string): string[] | null {
  const parts = path.split('.')
  return parts.every((part) => part && !isProtoPollutingKey(part)) ? parts : null
}
