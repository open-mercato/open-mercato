import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'auth:user',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'name' },
    ],
  },
  {
    entityId: 'auth:user_consent',
    fields: [
      { field: 'ip_address' },
      { field: 'source' },
    ],
  },
]

export default defaultEncryptionMaps
