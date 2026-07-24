import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'eudr:eudr_evidence_submission',
    fields: [
      { field: 'producer_name' },
      { field: 'notes' },
    ],
  },
  {
    entityId: 'eudr:eudr_plot',
    fields: [
      { field: 'producer_name' },
    ],
  },
  {
    entityId: 'eudr:eudr_risk_assessment',
    fields: [
      { field: 'notes' },
    ],
  },
  {
    entityId: 'eudr:eudr_mitigation_action',
    fields: [
      { field: 'notes' },
    ],
  },
]

export default defaultEncryptionMaps
