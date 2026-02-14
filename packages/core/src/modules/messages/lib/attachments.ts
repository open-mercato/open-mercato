import type { EntityManager } from '@mikro-orm/core'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'
const LIBRARY_ATTACHMENT_ENTITY_ID = 'attachments:library'

function buildOrganizationScopeFilter(organizationId: string | null) {
  if (!organizationId) {
    return { organizationId: null }
  }
  return {
    $or: [
      { organizationId },
      { organizationId: null },
    ],
  }
}

export async function linkAttachmentsToMessage(
  em: EntityManager,
  messageId: string,
  attachmentIds: string[],
  organizationId: string | null,
  tenantId: string,
): Promise<void> {
  if (attachmentIds.length === 0) return

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  const attachments = await em.find(Attachment, {
    id: { $in: attachmentIds },
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  })

  for (const attachment of attachments) {
    attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
    attachment.recordId = messageId
  }

  await em.flush()
}

export async function getMessageAttachments(
  em: EntityManager,
  messageId: string,
  organizationId: string | null,
  tenantId: string,
): Promise<Array<{
  id: string
  fileName: string
  fileSize: number
  mimeType: string
  url: string
}>> {
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  const attachments = await em.find(Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: messageId,
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  })

  return attachments.map((attachment) => ({
    id: attachment.id,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    url: attachment.url,
  }))
}

export async function linkLibraryAttachmentsToMessage(
  em: EntityManager,
  messageId: string,
  sourceRecordId: string,
  organizationId: string | null,
  tenantId: string,
): Promise<void> {
  if (!sourceRecordId.trim()) return

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  const attachments = await em.find(Attachment, {
    entityId: LIBRARY_ATTACHMENT_ENTITY_ID,
    recordId: sourceRecordId,
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  })

  if (!attachments.length) return

  for (const attachment of attachments) {
    attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
    attachment.recordId = messageId
  }

  await em.flush()
}

export async function copyAttachmentsForForward(
  em: EntityManager,
  sourceMessageId: string,
  targetMessageId: string,
  organizationId: string | null,
  tenantId: string,
): Promise<void> {
  const sourceAttachments = await getMessageAttachments(em, sourceMessageId, organizationId, tenantId)
  if (sourceAttachments.length === 0) return

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  for (const source of sourceAttachments) {
    const original = await em.findOne(Attachment, {
      id: source.id,
      tenantId,
      ...buildOrganizationScopeFilter(organizationId),
    })
    if (!original) continue

    const copy = em.create(Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: targetMessageId,
      organizationId,
      tenantId,
      fileName: original.fileName,
      mimeType: original.mimeType,
      fileSize: original.fileSize,
      storageDriver: original.storageDriver,
      storagePath: original.storagePath,
      storageMetadata: original.storageMetadata,
      url: original.url,
      partitionCode: original.partitionCode,
    })

    em.persist(copy)
  }

  await em.flush()
}
