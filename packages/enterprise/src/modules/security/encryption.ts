import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'security:user_mfa_method',
    fields: [
      { field: 'secret', hashField: 'secret_hash' },
      { field: 'provider_metadata' },
    ],
  },
]

export default defaultEncryptionMaps
