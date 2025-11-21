export function sanitizeSearchTerm(value?: string): string {
  if (!value) return ''
  return value.trim().replace(/[%_]/g, '')
}

export function parseBooleanFlag(raw?: string): boolean | undefined {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return undefined
}
