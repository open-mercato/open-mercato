import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'ai_assistant:ai_pending_action',
    fields: [
      { field: 'normalized_input' },
      { field: 'field_diff' },
      { field: 'records' },
      { field: 'failed_records' },
      { field: 'side_effects_summary' },
      { field: 'execution_result' },
    ],
  },
]

export default defaultEncryptionMaps
