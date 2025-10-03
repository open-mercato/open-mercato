export const CUSTOM_FIELD_KINDS = [
  'text',
  'multiline',
  'integer',
  'float',
  'boolean',
  'select',
  'relation',
] as const

export type CustomFieldKind = typeof CUSTOM_FIELD_KINDS[number]

export function isCustomFieldKind(x: string): x is CustomFieldKind {
  return (CUSTOM_FIELD_KINDS as readonly string[]).includes(x)
}

