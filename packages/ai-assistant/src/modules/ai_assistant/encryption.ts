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
  {
    entityId: 'ai_assistant:ai_agent_run',
    fields: [
      { field: 'input_text' },
      { field: 'output_text' },
      { field: 'system_prompt' },
      { field: 'citations' },
      { field: 'error_message' },
    ],
  },
  {
    entityId: 'ai_assistant:ai_agent_run_step',
    fields: [
      { field: 'text' },
    ],
  },
  {
    entityId: 'ai_assistant:ai_agent_run_tool_call',
    fields: [
      { field: 'args' },
      { field: 'result' },
      { field: 'error_message' },
    ],
  },
]

export default defaultEncryptionMaps
