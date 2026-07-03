import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'warranty_claims:warranty_claim',
    fields: [{ field: 'notes' }, { field: 'resolution_summary' }],
  },
  {
    entityId: 'warranty_claims:warranty_claim_line',
    fields: [{ field: 'fault_description' }, { field: 'inspection_notes' }],
  },
  {
    entityId: 'warranty_claims:warranty_claim_event',
    fields: [{ field: 'body' }],
  },
]

export default defaultEncryptionMaps
