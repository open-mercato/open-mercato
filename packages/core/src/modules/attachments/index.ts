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
  type ReleaseOwnedScopedAttachmentsInput,
  type ReleaseOwnedScopedAttachmentsResult,
  type ReleaseScopedAttachmentInput,
} from './lib/attachment-service'
export type {
  AttachmentPersistLink,
  AttachmentPersistLinkExtras,
  AttachmentTextExtractionMode,
} from './lib/scoped-upload-service'

export {
  AttachmentStorageConfigurationError,
  getAttachmentStoragePolicy,
  isAttachmentStorageConfigurationError,
  registerStorageDriverValidator,
  type AttachmentStoragePolicy,
  type AttachmentStorageScope,
  type AttachmentStorageValidationStage,
  type AttachmentStorageValidationContext,
  type AttachmentStorageValidator,
  type AttachmentStorageConfigurationReason,
} from './lib/drivers/storageValidation'
export type {
  AttachmentAccessAction,
  AttachmentAccessDecision,
  AttachmentAccessInput,
  AttachmentAccessPartition,
  AttachmentAccessRecord,
  AttachmentAccessRequirement,
  AttachmentAccessResolver,
  AttachmentAccessResolverEntry,
  AttachmentAccessSubject,
  AttachmentAccessTarget,
  ProtectedAttachmentTarget,
} from './lib/access-types'
export { registerAttachmentAccessResolvers } from './lib/access-registry'
export {
  ATTACHMENT_ACCESS_REGISTRY_INVALID_MESSAGE,
  isAttachmentAccessRegistryInvalidError,
  syncAttachmentAccessProtection,
} from './lib/access-protection'
export { createAttachmentAccessContext, evaluateAttachmentAccess } from './lib/access-runner'
export type { AttachmentAccessContext, AttachmentAccessResult } from './lib/access-runner'
export { buildAttachmentAccessAuth, evaluateAttachmentRowAccess } from './lib/access-rows'
export {
  isAttachmentAccessRegistryInvalid,
  KNOWN_DIRECT_ATTACHMENT_READER_MODULES,
  listUnguardedAttachmentReaders,
} from './lib/access-readers'
export type {
  AttachmentAccessDestination,
  AttachmentAccessPrincipal,
  EvaluateAttachmentRowAccessInput,
  EvaluateAttachmentRowAccessResult,
} from './lib/access-rows'
