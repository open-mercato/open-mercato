import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'messages:message',
    fields: [
      { field: 'subject' },
      { field: 'body' },
      { field: 'external_email', hashField: 'external_email_hash' },
      { field: 'external_name' },
      { field: 'action_data' },
      { field: 'action_result' },
    ],
  },
]

export default defaultEncryptionMaps
