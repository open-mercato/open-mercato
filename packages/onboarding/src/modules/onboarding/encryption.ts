import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'onboarding:onboarding_request',
    keyScope: 'system',
    fields: [
      { field: 'email', hashField: 'email_hash' },
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'organization_name' },
      { field: 'password_hash' },
    ],
  },
]

export default defaultEncryptionMaps
