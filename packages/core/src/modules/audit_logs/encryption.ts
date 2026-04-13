import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'audit_logs:action_log',
    fields: [
      { field: 'command_id' },
      { field: 'action_label' },
      { field: 'command_payload' },
      { field: 'snapshot_before' },
      { field: 'snapshot_after' },
      { field: 'changes_json' },
      { field: 'context_json' },
    ],
  },
  {
    entityId: 'audit_logs:access_log',
    fields: [
      { field: 'resource_id' },
      { field: 'fields_json' },
      { field: 'context_json' },
    ],
  },
]

export default defaultEncryptionMaps
