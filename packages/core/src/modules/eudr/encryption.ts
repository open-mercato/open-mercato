import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'eudr:eudr_evidence_submission',
    fields: [
      { field: 'producer_name' },
      { field: 'notes' },
    ],
  },
]

export default defaultEncryptionMaps
