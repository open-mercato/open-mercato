export function sanitizeSearchTerm(value?: string): string {
  if (!value) return ''
  return value.trim().replace(/[%_]/g, '')
}
