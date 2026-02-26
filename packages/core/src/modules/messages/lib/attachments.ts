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

export type MessageEmailAttachment = {
  fileName: string
  fileSize: number
  mimeType: string
  partitionCode: string
  storagePath: string
  storageDriver: string
}

export async function getMessageEmailAttachments(
  em: EntityManager,
  messageId: string,
  organizationId: string | null,
  tenantId: string,
): Promise<MessageEmailAttachment[]> {
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

  const attachments = await em.find(Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: messageId,
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  })

  return attachments.map((attachment) => ({
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    partitionCode: attachment.partitionCode,
    storagePath: attachment.storagePath,
    storageDriver: attachment.storageDriver,
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
): Promise<number> {
  return copyAttachmentsForForwardMessages(
    em,
    [sourceMessageId],
    targetMessageId,
    organizationId,
    tenantId,
  )
}

export async function copyAttachmentsForForwardMessages(
  em: EntityManager,
  sourceMessageIds: string[],
  targetMessageId: string,
  targetOrganizationId: string | null,
  tenantId: string,
): Promise<number> {
  if (sourceMessageIds.length === 0) return 0

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const sourceAttachments = await em.find(Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: { $in: sourceMessageIds },
    tenantId,
  })
  if (sourceAttachments.length === 0) {
    return 0
  }

  const dedupedById = new Map<string, typeof sourceAttachments[number]>()
  for (const sourceAttachment of sourceAttachments) {
    if (!dedupedById.has(sourceAttachment.id)) {
      dedupedById.set(sourceAttachment.id, sourceAttachment)
    }
  }

  for (const sourceAttachment of dedupedById.values()) {
    const copy = em.create(Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: targetMessageId,
      organizationId: targetOrganizationId,
      tenantId,
      fileName: sourceAttachment.fileName,
      mimeType: sourceAttachment.mimeType,
      fileSize: sourceAttachment.fileSize,
      storageDriver: sourceAttachment.storageDriver,
      storagePath: sourceAttachment.storagePath,
      storageMetadata: sourceAttachment.storageMetadata,
      url: sourceAttachment.url,
      partitionCode: sourceAttachment.partitionCode,
    })

    em.persist(copy)
  }

  await em.flush()
  return dedupedById.size
}
