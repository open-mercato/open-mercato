const FORBIDDEN_MAPPING_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

export function isSafeMappingTargetPath(path: string): boolean {
  return !path.split('.').some((segment) => FORBIDDEN_MAPPING_PATH_SEGMENTS.has(segment))
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function safeSetNestedValue(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): boolean {
  const segments = path.split('.')
  if (!isSafeMappingTargetPath(path)) return false

  const lastSegment = segments.pop()
  if (lastSegment === undefined) return false

  let current = target
  for (const segment of segments) {
    const existing = Object.hasOwn(current, segment) ? current[segment] : undefined
    if (!isObjectRecord(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  current[lastSegment] = value
  return true
}
