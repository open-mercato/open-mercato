import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { defaultFieldTypeRegistry } from '../../../../schema/field-type-registry'

export function resolveTypeLabel(typeKey: string | undefined, t: TranslateFn): string {
  const key = typeKey || 'text'
  const spec = defaultFieldTypeRegistry.get(key)
  if (spec?.displayNameKey) return t(spec.displayNameKey)
  return key
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
