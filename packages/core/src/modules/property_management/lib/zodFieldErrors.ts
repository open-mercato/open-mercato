import type { z } from 'zod'

const MODULE_MESSAGE_PREFIX = 'property_management.'

export function translateZodFieldErrors(err: z.ZodError, translate: (key: string, fallback?: string) => string): Record<string, string> {
  const generic = translate('property_management.errors.invalidInput', 'Invalid input')
  const fieldErrors: Record<string, string> = {}
  const specific = new Set<string>()
  for (const issue of err.issues) {
    const field = issue.path.length ? String(issue.path[0]) : 'form'
    const isModuleMessage = issue.message.startsWith(MODULE_MESSAGE_PREFIX)
    if (specific.has(field) || (field in fieldErrors && !isModuleMessage)) continue
    fieldErrors[field] = isModuleMessage ? translate(issue.message, generic) : generic
    if (isModuleMessage) specific.add(field)
  }
  return fieldErrors
}
