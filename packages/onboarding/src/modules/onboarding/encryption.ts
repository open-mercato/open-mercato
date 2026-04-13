import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'onboarding:onboarding_request',
    fields: [
      { field: 'email' },
      { field: 'first_name' },
      { field: 'last_name' },
      { field: 'organization_name' },
    ],
  },
]

export default defaultEncryptionMaps
