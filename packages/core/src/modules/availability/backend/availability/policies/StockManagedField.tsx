import type { CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export const STOCK_MANAGED_INHERIT = 'inherit'
export const STOCK_MANAGED_ON = 'true'
export const STOCK_MANAGED_OFF = 'false'

export type StockManagedChoice = typeof STOCK_MANAGED_INHERIT | typeof STOCK_MANAGED_ON | typeof STOCK_MANAGED_OFF

export function toStockManagedChoice(value: boolean | null | undefined): StockManagedChoice {
  if (value === true) return STOCK_MANAGED_ON
  if (value === false) return STOCK_MANAGED_OFF
  return STOCK_MANAGED_INHERIT
}

export function fromStockManagedChoice(value: unknown): boolean | null {
  if (value === true || value === STOCK_MANAGED_ON) return true
  if (value === false || value === STOCK_MANAGED_OFF) return false
  return null
}

export function buildStockManagedOptions(
  t: TranslateFn,
  resolved: boolean | null = null,
): CrudFieldOption[] {
  const inheritLabel =
    typeof resolved === 'boolean'
      ? t('availability.policies.form.field.isStockManaged.inheritResolved', 'Inherit (currently: {value})', {
          value: resolved ? t('availability.common.yes') : t('availability.common.no'),
        })
      : t('availability.policies.form.field.isStockManaged.inherit')
  return [
    { value: STOCK_MANAGED_INHERIT, label: inheritLabel },
    { value: STOCK_MANAGED_ON, label: t('availability.common.yes') },
    { value: STOCK_MANAGED_OFF, label: t('availability.common.no') },
  ]
}
