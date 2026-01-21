export const CUSTOM_FIELD_KINDS = [
  'text',
  'multiline',
  'integer',
  'float',
  'boolean',
  'select',
  'currency',
  'relation',
  'attachment',
  'dictionary',
] as const

export type CustomFieldKind = typeof CUSTOM_FIELD_KINDS[number]

export function isCustomFieldKind(x: string): x is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(x)
}

export const CURRENCY_OPTIONS_URL = '/api/currencies/currencies/options'
