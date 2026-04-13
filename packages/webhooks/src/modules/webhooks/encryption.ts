import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'webhooks:webhook_entity',
    fields: [
      { field: 'secret' },
      { field: 'previous_secret' },
    ],
  },
]

export default defaultEncryptionMaps
