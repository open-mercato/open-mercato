import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'customer_accounts:customer_user',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'display_name' },
    ],
  },
  {
    entityId: 'customer_accounts:customer_user_session',
    fields: [
      { field: 'ip_address' },
      { field: 'user_agent' },
    ],
  },
  {
    entityId: 'customer_accounts:customer_user_invitation',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'display_name' },
    ],
  },
]

export default defaultEncryptionMaps
