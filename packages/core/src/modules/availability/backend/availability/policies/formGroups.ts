import type { CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'

/**
 * Shared field groups for the create and edit policy forms. Scope fields
 * (productId/variantId/storeId) live outside this list — see `ScopeFields`.
 */
export function buildPolicyFieldGroups(t: (key: string) => string): CrudFormGroup[] {
  return [
    {
      id: 'sell-policy',
      column: 1,
      title: t('availability.policies.form.group.sellPolicy'),
      fields: [
        {
          id: 'isStockManaged',
          type: 'checkbox',
          label: t('availability.policies.form.field.isStockManaged'),
          description: t('availability.policies.form.field.isStockManaged.help'),
        },
        {
          id: 'allowBackorder',
          type: 'checkbox',
          label: t('availability.policies.form.field.allowBackorder'),
        },
        {
          id: 'backorderLeadTimeDays',
          type: 'number',
          label: t('availability.policies.form.field.backorderLeadTimeDays'),
          description: t('availability.policies.form.field.backorderLeadTimeDays.help'),
        },
        {
          id: 'preorderReleaseAt',
          type: 'datetime-local',
          label: t('availability.policies.form.field.preorderReleaseAt'),
        },
      ],
    },
    {
      id: 'thresholds',
      column: 2,
      title: t('availability.policies.form.group.thresholds'),
      fields: [
        {
          id: 'lowStockThreshold',
          type: 'number',
          label: t('availability.policies.form.field.lowStockThreshold'),
        },
        {
          id: 'minOrderQuantity',
          type: 'number',
          label: t('availability.policies.form.field.minOrderQuantity'),
        },
        {
          id: 'maxOrderQuantity',
          type: 'number',
          label: t('availability.policies.form.field.maxOrderQuantity'),
        },
        {
          id: 'quantityIncrement',
          type: 'number',
          label: t('availability.policies.form.field.quantityIncrement'),
        },
        {
          id: 'hideWhenOutOfStock',
          type: 'checkbox',
          label: t('availability.policies.form.field.hideWhenOutOfStock'),
        },
        {
          id: 'isActive',
          type: 'checkbox',
          label: t('availability.policies.form.field.isActive'),
          defaultValue: true,
        },
      ],
    },
  ]
}
