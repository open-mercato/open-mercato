export type CustomFieldOptionInput =
  | string
  | {
      value?: string | null
      label?: string | null
    }
  | null
  | undefined

export type CustomFieldOptionDto = {
  value: string
  label: string
}

export function normalizeCustomFieldOption(option: CustomFieldOptionInput): CustomFieldOptionDto | null {
  if (typeof option === 'string') {
    const value = option.trim()
    if (!value) return null
    return { value, label: value }
  }
  if (!option || typeof option !== 'object') return null
  const rawValue = typeof option.value === 'string' ? option.value.trim() : ''
  if (!rawValue) return null
  const rawLabel = typeof option.label === 'string' ? option.label.trim() : ''
  return { value: rawValue, label: rawLabel || rawValue }
}

export function normalizeCustomFieldOptions(options: unknown): CustomFieldOptionDto[] {
  if (!Array.isArray(options)) return []
  const normalized: CustomFieldOptionDto[] = []
  for (const entry of options) {
    const item = normalizeCustomFieldOption(entry as CustomFieldOptionInput)
    if (item) normalized.push(item)
  }
  return normalized
}
