import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'property_management:lease_proposal',
    fields: [{ field: 'message' }],
  },
  {
    entityId: 'property_management:booking',
    fields: [{ field: 'notes' }],
  },
]

export default defaultEncryptionMaps
