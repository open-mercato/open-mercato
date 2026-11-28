import type { AddressCustomFieldStructure } from '@open-mercato/ui/backend/detail/AddressCustomFields'
import { validateValuesAgainstDefs } from '@open-mercato/shared/modules/entities/validation'
import { acceptsAddressCustomFieldValue } from '@open-mercato/core/modules/entities/lib/addressCustomFieldPolicy'

export function asAddressValues(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export function selectAddressValuesForCopy(
  values: Record<string, unknown> | null | undefined,
  source: AddressCustomFieldStructure,
  target: AddressCustomFieldStructure,
): Record<string, unknown> | null {
  if (!values || source.status !== 'ready' || target.status !== 'ready') return null
  const sourceByKey = new Map(source.definitions.map((definition) => [definition.key, definition]))
  const compatible = target.definitions.flatMap((definition) => {
    const original = sourceByKey.get(definition.key)
    if (!original || original.kind !== definition.kind || original.optionsUrl !== definition.optionsUrl) return []
    if (original.formEditable === false || definition.formEditable === false) return []
    if (original.dictionaryId !== definition.dictionaryId || original.relatedEntityId !== definition.relatedEntityId) return []
    const value = values[definition.key]
    if (value == null || !acceptsAddressCustomFieldValue(definition.kind, definition, value)) return []
    const validation = validateValuesAgainstDefs({ [definition.key]: value }, [{
      key: definition.key,
      kind: definition.kind,
      configJson: { validation: definition.validation },
    }])
    if (!validation.ok) return []
    return [[definition.key, value] as const]
  })
  return compatible.length ? Object.fromEntries(compatible) : null
}
