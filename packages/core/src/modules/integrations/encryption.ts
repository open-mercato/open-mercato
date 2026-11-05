import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'integrations:integration_credentials',
    fields: [{ field: 'credentials' }],
  },
]

export default defaultEncryptionMaps
