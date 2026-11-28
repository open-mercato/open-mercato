import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { CrudFormProps } from '@open-mercato/ui/backend/CrudForm'
import englishCheckout from '../i18n/en.json'
import { CHECKOUT_ENTITY_IDS } from './constants'

export function createCheckoutCustomFieldTextResolver(
  translate: TranslateFn,
): NonNullable<CrudFormProps<Record<string, unknown>>['resolveCustomFieldText']> {
  return (text, { entityId, path }) => {
    if (entityId !== CHECKOUT_ENTITY_IDS.link && entityId !== CHECKOUT_ENTITY_IDS.template) return text
    const translationKey = `checkout.customFields.${path}`
    const defaults: Record<string, string> = englishCheckout
    if (!Object.prototype.hasOwnProperty.call(defaults, translationKey) || defaults[translationKey] !== text) return text
    return translate(translationKey, text)
  }
}
