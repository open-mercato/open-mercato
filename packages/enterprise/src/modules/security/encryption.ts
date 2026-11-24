import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'security:sign_in_attempt',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'ip_address', hashField: 'ip_hash' },
      { field: 'user_agent' },
    ],
  },
]

export default defaultEncryptionMaps
