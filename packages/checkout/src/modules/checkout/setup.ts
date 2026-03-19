import type { ModuleSetupConfig } from '@open-mercato/shared/modules/setup'

export const DEFAULT_CHECKOUT_CUSTOMER_FIELDS = [
  { key: 'firstName', label: 'checkout.fields.firstName', kind: 'text', required: true, fixed: true, sortOrder: 0 },
  { key: 'lastName', label: 'checkout.fields.lastName', kind: 'text', required: true, fixed: true, sortOrder: 1 },
  { key: 'email', label: 'checkout.fields.email', kind: 'text', required: true, fixed: true, sortOrder: 2 },
  { key: 'phone', label: 'checkout.fields.phone', kind: 'text', required: false, fixed: true, sortOrder: 3 },
  { key: 'companyName', label: 'checkout.fields.companyName', kind: 'text', required: false, fixed: false, sortOrder: 4 },
  { key: 'companyId', label: 'checkout.fields.companyId', kind: 'text', required: false, fixed: false, sortOrder: 5 },
  { key: 'address', label: 'checkout.fields.address', kind: 'multiline', required: false, fixed: false, sortOrder: 6 },
] as const

export const setup: ModuleSetupConfig = {
  defaultRoleFeatures: {
    superadmin: ['checkout.*'],
    admin: ['checkout.view', 'checkout.create', 'checkout.edit', 'checkout.delete', 'checkout.viewPii', 'checkout.export'],
    employee: ['checkout.view'],
  },
}

export default setup
