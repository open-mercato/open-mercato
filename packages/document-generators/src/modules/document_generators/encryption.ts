import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'document_generators:generated_document',
    fields: [{ field: 'resource_label' }],
  },
]

export default defaultEncryptionMaps
