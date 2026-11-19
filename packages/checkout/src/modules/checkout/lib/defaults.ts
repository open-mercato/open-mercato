import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'

export type DefaultCheckoutCustomerField = {
  key: string
  label: string
  kind: 'text' | 'multiline' | 'boolean' | 'select' | 'radio'
  required: boolean
  fixed: boolean
  placeholder?: string
  sortOrder: number
}

export const DEFAULT_CHECKOUT_CUSTOMER_FIELDS: DefaultCheckoutCustomerField[] = [
  { key: 'firstName', label: 'First name', kind: 'text', required: true, fixed: false, placeholder: 'Jane', sortOrder: 0 },
  { key: 'lastName', label: 'Last name', kind: 'text', required: true, fixed: false, placeholder: 'Doe', sortOrder: 1 },
  { key: 'email', label: 'Email', kind: 'text', required: true, fixed: false, placeholder: 'jane@company.com', sortOrder: 2 },
  { key: 'phone', label: 'Phone', kind: 'text', required: false, fixed: false, placeholder: '+1 555 123 4567', sortOrder: 3 },
  { key: 'companyName', label: 'Company name', kind: 'text', required: false, fixed: false, placeholder: 'Acme Inc.', sortOrder: 4 },
  { key: 'companyId', label: 'Company ID', kind: 'text', required: false, fixed: false, placeholder: 'VAT / registration number', sortOrder: 5 },
  { key: 'address', label: 'Address', kind: 'multiline', required: false, fixed: false, placeholder: 'Street, city, postal code', sortOrder: 6 },
]

export function getLocalizedDefaultCheckoutCustomerFields(t?: TranslateFn): DefaultCheckoutCustomerField[] {
  return DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({
    ...field,
    label: t ? t(`checkout.defaultCustomerFields.${field.key}.label`, field.label) : field.label,
    placeholder: typeof field.placeholder === 'string'
      ? (t ? t(`checkout.defaultCustomerFields.${field.key}.placeholder`, field.placeholder) : field.placeholder)
      : field.placeholder,
  }))
}

// Stored field definitions snapshot a built-in field's label in whatever locale was active when
// the link/template was created (or last edited), so the public pay page cannot tell "operator
// customized this label" apart from "this is just the default text" without a comparison. A
// stored label that still matches the untranslated default for its key is treated as untouched
// and re-rendered through the viewer's active locale; anything else is an explicit customization
// and is preserved verbatim.
export function localizeStoredCheckoutCustomerFieldLabel(key: string, label: string, t?: TranslateFn): string {
  if (!t) return label
  const defaultField = DEFAULT_CHECKOUT_CUSTOMER_FIELDS.find((candidate) => candidate.key === key)
  if (!defaultField || defaultField.label !== label) return label
  return t(`checkout.defaultCustomerFields.${key}.label`, defaultField.label)
}

export function localizeStoredCheckoutCustomerFields<T extends { key: string; label: string }>(
  fields: T[],
  t?: TranslateFn,
): T[] {
  if (!t) return fields
  return fields.map((field) => {
    const label = localizeStoredCheckoutCustomerFieldLabel(field.key, field.label, t)
    return label === field.label ? field : { ...field, label }
  })
}
