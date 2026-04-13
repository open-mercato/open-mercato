import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'staff:staff_leave_request',
    fields: [
      { field: 'note' },
      { field: 'decision_comment' },
      { field: 'unavailability_reason_value' },
    ],
  },
]

export default defaultEncryptionMaps
