const FORBIDDEN_MAPPING_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isSafeMappingPath(path: string): boolean {
  return !path.split('.').some((segment) => FORBIDDEN_MAPPING_PATH_SEGMENTS.has(segment))
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function safeGetNestedValue(source: unknown, path: string): unknown {
  if (!isSafeMappingPath(path)) return undefined

  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isObjectRecord(current) || !Object.hasOwn(current, segment)) return undefined
    return current[segment]
  }, source)
}

function cloneMappingContainer(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return [...value] as unknown as Record<string, unknown>
  if (isObjectRecord(value)) return { ...value }
  return {}
}

export function safeSetNestedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): boolean {
  const segments = path.split('.')
  if (!isSafeMappingPath(path)) return false

  const lastSegment = segments.pop()
  if (lastSegment === undefined) return false

  let current = target
  for (const segment of segments) {
    const existing = Object.hasOwn(current, segment) ? current[segment] : undefined
    current[segment] = cloneMappingContainer(existing)
    current = current[segment] as Record<string, unknown>
  }

  current[lastSegment] = value
  return true
}
