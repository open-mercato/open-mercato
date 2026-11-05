export type CollectCustomFieldOptions = {
  prefixes?: string[]
  stripPrefix?: boolean
  transform?: (value: unknown, fieldId: string, rawKey: string) => unknown
  accept?: (fieldId: string, rawKey: string, value: unknown) => boolean
  omitUndefined?: boolean
}

const DEFAULT_PREFIXES = ['cf_', 'cf:']

export function collectCustomFieldValues(
  values: Record<string, unknown>,
  options: CollectCustomFieldOptions = {},
): Record<string, unknown> {
  const {
    prefixes = DEFAULT_PREFIXES,
    stripPrefix = true,
    transform,
    accept,
    omitUndefined = true,
  } = options

  const result: Record<string, unknown> = {}

  for (const [rawKey, rawValue] of Object.entries(values)) {
    const prefix = prefixes.find((candidate) => rawKey.startsWith(candidate))
    if (!prefix) continue

    const fieldId = stripPrefix ? rawKey.slice(prefix.length) : rawKey
    if (!fieldId) continue

    if (accept && !accept(fieldId, rawKey, rawValue)) continue

    const nextValue = transform ? transform(rawValue, fieldId, rawKey) : rawValue
    if (omitUndefined && nextValue === undefined) continue

    result[fieldId] = nextValue
  }

  return result
}
