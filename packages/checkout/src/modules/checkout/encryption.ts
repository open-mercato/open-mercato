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
  // Release 5, Step 2.12 (B.1, §13 — C14's security minimum): the session's own PII
  // columns, shipped with the entity rather than deferred to B.6.
  {
    entityId: 'checkout:checkout_session',
    fields: [
      { field: 'email' },
      { field: 'phone' },
      { field: 'shipping_address' },
      { field: 'billing_address' },
    ],
  },
]

export default defaultEncryptionMaps
