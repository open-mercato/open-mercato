import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'attachments:attachment_document_extraction',
    fields: [{ field: 'normalized_text' }, { field: 'failure_reason' }],
  },
  {
    entityId: 'attachments:attachment_document_section',
    fields: [{ field: 'heading' }, { field: 'heading_path' }, { field: 'text' }],
  },
]

export default defaultEncryptionMaps
