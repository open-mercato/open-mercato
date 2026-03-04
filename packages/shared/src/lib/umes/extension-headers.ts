const EXTENSION_HEADER_PREFIX = 'x-om-ext-'

export function buildExtensionHeader(moduleId: string, key: string): string {
  return `${EXTENSION_HEADER_PREFIX}${moduleId}-${key}`
}

export interface ParsedExtensionHeaders {
  [moduleId: string]: Record<string, string>
}

/**
 * Parse extension headers from a request. Module IDs use snake_case per convention,
 * so the first dash after the prefix reliably separates moduleId from key.
 * E.g. `x-om-ext-record_locks-token` → moduleId=`record_locks`, key=`token`.
 */
export function parseExtensionHeaders(
  headers: Record<string, string | string[] | undefined>,
): ParsedExtensionHeaders {
  const result: ParsedExtensionHeaders = {}

  for (const [headerName, value] of Object.entries(headers)) {
    const lower = headerName.toLowerCase()
    if (!lower.startsWith(EXTENSION_HEADER_PREFIX)) continue

    const suffix = lower.slice(EXTENSION_HEADER_PREFIX.length)
    const dashIdx = suffix.indexOf('-')
    if (dashIdx === -1) continue

    const moduleId = suffix.slice(0, dashIdx)
    const key = suffix.slice(dashIdx + 1)
    const headerValue = Array.isArray(value) ? value[0] : value

    if (!headerValue) continue

    if (!result[moduleId]) {
      result[moduleId] = {}
    }
    result[moduleId][key] = headerValue
  }

  return result
}

export function getExtensionHeaderValue(
  headers: Record<string, string | string[] | undefined>,
  moduleId: string,
  key: string,
): string | undefined {
  const headerName = buildExtensionHeader(moduleId, key)

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === headerName) {
      return Array.isArray(value) ? value[0] : value
    }
  }

  return undefined
}
