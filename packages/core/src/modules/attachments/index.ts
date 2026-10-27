import type { ModuleInfo } from '@open-mercato/shared/modules/registry'

export const metadata: ModuleInfo = {
  name: 'attachments',
  title: 'Attachments',
  version: '0.1.0',
  description: 'File attachments and media management.',
  author: 'Open Mercato Team',
  license: 'MIT',
}

export {
  type AttachmentOwner,
  type AttachmentProviderCleanup,
  type AttachmentService,
  type CreatedScopedAttachment,
  type CreateScopedAttachmentInput,
  type ReadScopedAttachmentInput,
  type ReadScopedAttachmentResult,
  type ReleaseScopedAttachmentInput,
} from './lib/attachment-service'
