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
