import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'checkout:checkout_link_template',
    fields: [
      { field: 'gateway_settings' },
    ],
  },
  {
    entityId: 'checkout:checkout_link',
    fields: [
      { field: 'gateway_settings' },
    ],
  },
  {
    entityId: 'checkout:checkout_transaction',
    fields: [
      { field: 'customer_data' },
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'email' },
      { field: 'phone' },
      { field: 'accepted_legal_consents' },
      { field: 'ip_address' },
    ],
  },
]

export default defaultEncryptionMaps
