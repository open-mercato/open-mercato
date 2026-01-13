import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

export function sanitizeSearchTerm(value?: string): string {
  if (!value) return ''
  return value.trim().replace(/[%_]/g, '')
}

export function parseBooleanFlag(raw?: string): boolean | undefined {
  const parsed = parseBooleanToken(raw)
  return parsed === null ? undefined : parsed
}
