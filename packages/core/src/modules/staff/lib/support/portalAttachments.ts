import { z } from 'zod'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { Attachment as AttachmentEntity } from '@open-mercato/core/modules/attachments/data/entities'
import type { SupportPortalScope } from './portalTickets'
import {
  CUSTOMER_UPLOAD_TAG_PREFIX,
  CUSTOMER_VISIBLE_ATTACHMENT_TAG,
  SUPPORT_TICKET_ATTACHMENT_ENTITY_ID,
  customerUploadTag,
} from './attachments'

const logger = createLogger('staff').child({ component: 'lib/support/portalAttachments' })

export type PortalAttachmentsApi = {
  Attachment: typeof import('@open-mercato/core/modules/attachments/data/entities').Attachment
  AttachmentPartition: typeof import('@open-mercato/core/modules/attachments/data/entities').AttachmentPartition
  StorageDriverFactory: typeof import('@open-mercato/core/modules/attachments/lib/drivers').StorageDriverFactory
  checkAttachmentAccess: typeof import('@open-mercato/core/modules/attachments/lib/access').checkAttachmentAccess
  attachmentCrudEvents: typeof import('@open-mercato/core/modules/attachments/lib/crud').attachmentCrudEvents
  attachmentCrudIndexer: typeof import('@open-mercato/core/modules/attachments/lib/crud').attachmentCrudIndexer
  readAttachmentMetadata: typeof import('@open-mercato/core/modules/attachments/lib/metadata').readAttachmentMetadata
  slugifyAttachmentFileName: typeof import('@open-mercato/core/modules/attachments/lib/imageUrls').slugifyAttachmentFileName
  clearAttachmentThumbnailCache: typeof import('@open-mercato/core/modules/attachments/lib/thumbnailCache').clearAttachmentThumbnailCache
  isMultipartRequestWithinUploadLimit: typeof import('@open-mercato/core/modules/attachments/lib/upload-limits').isMultipartRequestWithinUploadLimit
  resolveAttachmentMaxBytes: typeof import('@open-mercato/core/modules/attachments/lib/upload-limits').resolveAttachmentMaxBytes
  isScopedAttachmentUploadError: typeof import('@open-mercato/core/modules/attachments/lib/scoped-upload-service').isScopedAttachmentUploadError
}

export const portalSupportAttachmentItemSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  fileSize: z.number(),
  mimeType: z.string().nullable(),
  downloadUrl: z.string(),
  uploadedByCustomer: z.boolean(),
  canDelete: z.boolean(),
  createdAt: z.string().nullable(),
})

export type PortalSupportAttachmentItem = z.infer<typeof portalSupportAttachmentItemSchema>

/**
 * Staff keeps no static edge to the attachments module: it is loaded on demand and a
 * deployment without it reads as "attachments unavailable" (`null`).
 */
export async function loadPortalAttachmentsApi(): Promise<PortalAttachmentsApi | null> {
  try {
    const [entities, drivers, access, crud, metadataLib, imageUrls, thumbnails, limits, uploadService] = await Promise.all([
      import('@open-mercato/core/modules/attachments/data/entities'),
      import('@open-mercato/core/modules/attachments/lib/drivers'),
      import('@open-mercato/core/modules/attachments/lib/access'),
      import('@open-mercato/core/modules/attachments/lib/crud'),
      import('@open-mercato/core/modules/attachments/lib/metadata'),
      import('@open-mercato/core/modules/attachments/lib/imageUrls'),
      import('@open-mercato/core/modules/attachments/lib/thumbnailCache'),
      import('@open-mercato/core/modules/attachments/lib/upload-limits'),
      import('@open-mercato/core/modules/attachments/lib/scoped-upload-service'),
    ])
    return {
      Attachment: entities.Attachment,
      AttachmentPartition: entities.AttachmentPartition,
      StorageDriverFactory: drivers.StorageDriverFactory,
      checkAttachmentAccess: access.checkAttachmentAccess,
      attachmentCrudEvents: crud.attachmentCrudEvents,
      attachmentCrudIndexer: crud.attachmentCrudIndexer,
      readAttachmentMetadata: metadataLib.readAttachmentMetadata,
      slugifyAttachmentFileName: imageUrls.slugifyAttachmentFileName,
      clearAttachmentThumbnailCache: thumbnails.clearAttachmentThumbnailCache,
      isMultipartRequestWithinUploadLimit: limits.isMultipartRequestWithinUploadLimit,
      resolveAttachmentMaxBytes: limits.resolveAttachmentMaxBytes,
      isScopedAttachmentUploadError: uploadService.isScopedAttachmentUploadError,
    }
  } catch (err) {
    logger.warn('staff portal support attachments module unavailable', { err })
    return null
  }
}

export function readAttachmentTags(api: PortalAttachmentsApi, attachment: AttachmentEntity): string[] {
  return api.readAttachmentMetadata(attachment.storageMetadata).tags ?? []
}

export function portalAttachmentAuth(scope: SupportPortalScope) {
  return { sub: scope.auth.sub, tenantId: scope.tenantId, orgId: scope.organizationId, email: scope.auth.email }
}

export function serializePortalAttachment(
  api: PortalAttachmentsApi,
  attachment: AttachmentEntity,
  taskId: string,
  customerUserId: string,
  canManage = false,
): PortalSupportAttachmentItem {
  const tags = readAttachmentTags(api, attachment)
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType ?? null,
    downloadUrl: `/api/staff/portal/support-tickets/${encodeURIComponent(taskId)}/attachments?attachmentId=${encodeURIComponent(attachment.id)}`,
    uploadedByCustomer: tags.some((tag) => tag.startsWith(CUSTOMER_UPLOAD_TAG_PREFIX)),
    canDelete: canManage && tags.includes(customerUploadTag(customerUserId)),
    createdAt: attachment.createdAt ? attachment.createdAt.toISOString() : null,
  }
}

/**
 * The files of a ticket the customer may see: tagged `customer-visible` and passing
 * the attachments module's own access check. Internal staff files are never returned.
 * `canManage` is whether the caller holds `portal.support_tickets.manage`; without it
 * no item reports `canDelete`, matching the DELETE route's own feature check.
 */
export async function listCustomerVisibleAttachments(
  api: PortalAttachmentsApi,
  scope: SupportPortalScope,
  taskId: string,
  canManage = false,
): Promise<PortalSupportAttachmentItem[]> {
  const decryptionScope = { tenantId: scope.tenantId, organizationId: scope.organizationId }
  const attachments = await findWithDecryption(
    scope.em,
    api.Attachment,
    { entityId: SUPPORT_TICKET_ATTACHMENT_ENTITY_ID, recordId: taskId, ...decryptionScope },
    { orderBy: { createdAt: 'ASC' } },
    decryptionScope,
  )
  const codes = Array.from(new Set(attachments.map((attachment) => attachment.partitionCode)))
  const partitions = codes.length ? await scope.em.find(api.AttachmentPartition, { code: { $in: codes } }) : []
  const partitionByCode = new Map(partitions.map((partition) => [partition.code, partition]))
  const auth = portalAttachmentAuth(scope)
  return attachments
    .filter((attachment) => {
      const partition = partitionByCode.get(attachment.partitionCode)
      if (!partition) return false
      if (!readAttachmentTags(api, attachment).includes(CUSTOMER_VISIBLE_ATTACHMENT_TAG)) return false
      return api.checkAttachmentAccess(auth, attachment, partition, { requireAuthForPublic: true }).ok
    })
    .map((attachment) => serializePortalAttachment(api, attachment, taskId, scope.auth.sub, canManage))
}
