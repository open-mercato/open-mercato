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
  {
    entityId: 'staff:staff_support_ticket',
    fields: [
      { field: 'customer_request_snapshot' },
    ],
  },
]

export default defaultEncryptionMaps
