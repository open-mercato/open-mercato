import { getTranslatableFields } from '@open-mercato/shared/lib/localization/translatable-fields'
import { getEntityFields } from '#generated/entity-fields-registry'
import { isTranslatableField } from './translatable-fields'
import { formatFieldLabel } from './helpers'

export type ResolvedField = { key: string; label: string; multiline: boolean }

function isMultiline(key: string): boolean {
  return key === 'description' || key.includes('description') || key.includes('content')
}

export function resolveFieldList(
  entityType: string,
  explicitFields: string[] | undefined,
  customFieldDefs: Array<{ key: string; kind: string; label?: string }>,
): ResolvedField[] {
  if (explicitFields?.length) {
    return explicitFields.map((key) => ({
      key,
      label: formatFieldLabel(key),
      multiline: isMultiline(key),
    }))
  }

  const registered = getTranslatableFields(entityType)
  const fields: ResolvedField[] = []

  if (registered) {
    for (const key of registered) {
      fields.push({
        key,
        label: formatFieldLabel(key),
        multiline: isMultiline(key),
      })
    }
  } else {
    const parts = entityType.split(':')
    const entitySlug = parts[1]
    if (entitySlug) {
      const mod = getEntityFields(entitySlug)
      if (mod) {
        for (const raw of Object.values(mod)) {
          if (typeof raw !== 'string' || !raw.trim()) continue
          const value = raw.trim()
          if (isTranslatableField(value) && !fields.some((f) => f.key === value)) {
            fields.push({
              key: value,
              label: formatFieldLabel(value),
              multiline: isMultiline(value),
            })
          }
        }
      }
    }
  }

  for (const def of customFieldDefs) {
    const key = typeof def.key === 'string' ? def.key.trim() : ''
    if (!key) continue
    if (def.kind !== 'text' && def.kind !== 'multiline' && def.kind !== 'richtext') continue
    if (fields.some((f) => f.key === key)) continue
    const label = typeof def.label === 'string' && def.label.trim().length ? def.label : formatFieldLabel(key)
    fields.push({ key, label, multiline: def.kind === 'multiline' || def.kind === 'richtext' })
  }

  return fields
}
