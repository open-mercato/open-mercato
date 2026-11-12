import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'ai_assistant:ai_chat_message',
    fields: [
      { field: 'content' },
      { field: 'ui_parts' },
      { field: 'files_metadata' },
      { field: 'metadata' },
    ],
  },
  {
    entityId: 'ai_assistant:ai_chat_conversation',
    fields: [
      { field: 'title' },
    ],
  },
  {
    entityId: 'ai_assistant:ai_pending_action',
    fields: [
      { field: 'normalized_input' },
      { field: 'field_diff' },
      { field: 'records' },
    ],
  },
]

export default defaultEncryptionMaps
