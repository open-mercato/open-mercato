import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  { entityId: 'incidents:incident', fields: [{ field: 'customer_impact_summary' }] },
  { entityId: 'incidents:incident_timeline_entry', fields: [{ field: 'body' }] },
  {
    entityId: 'incidents:incident_postmortem',
    fields: [
      { field: 'summary' },
      { field: 'root_cause' },
      { field: 'impact' },
      { field: 'contributing_factors' },
      { field: 'lessons' },
    ],
  },
]

export default defaultEncryptionMaps
