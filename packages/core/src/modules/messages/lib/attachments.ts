import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgresEntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveAttachmentScopePair } from '@open-mercato/core/modules/attachments/lib/scope'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'
import type { MessageAttachmentLinkAccess } from './attachmentLinkAccess'
const LIBRARY_ATTACHMENT_ENTITY_ID = 'attachments:library'

async function assertAttachmentsLinkable(
  em: EntityManager,
  attachments: Attachment[],
  messageId: string,
  access: MessageAttachmentLinkAccess | undefined,
): Promise<void> {
  const moving = attachments.filter((attachment) => (
    attachment.entityId !== MESSAGE_ATTACHMENT_ENTITY_ID || attachment.recordId !== messageId
  ))
  if (moving.length === 0) return
  const { evaluateAttachmentRowAccess } = await import('@open-mercato/core/modules/attachments/lib/access-rows')
  const { denied } = await evaluateAttachmentRowAccess({
    container: access?.container,
    em: em as unknown as PostgresEntityManager,
    auth: access?.auth ?? undefined,
    rows: moving,
    action: 'reassign',
    destination: { entityId: MESSAGE_ATTACHMENT_ENTITY_ID, recordId: messageId },
  })
  if (denied.length === 0) return
  const { t } = await resolveTranslations()
  throw new CrudHttpError(403, {
    error: t('messages.errors.attachmentAccessDenied', 'You cannot attach one or more of these files.'),
  })
}

async function moveAttachmentsToMessage(
  em: EntityManager,
  filter: Record<string, unknown>,
  messageId: string,
  access: MessageAttachmentLinkAccess | undefined,
): Promise<void> {
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const { ATTACHMENT_ROW_WRITE_LOCK } = await import('@open-mercato/core/modules/attachments/lib/access-rows')
  const move = async (tx: EntityManager) => {
    const attachments = await tx.find(Attachment, filter, ATTACHMENT_ROW_WRITE_LOCK)
    if (!attachments.length) return
    await assertAttachmentsLinkable(tx, attachments, messageId, access)
    for (const attachment of attachments) {
      attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
      attachment.recordId = messageId
    }
    await tx.flush()
  }
  if (em.isInTransaction()) await move(em)
  else await em.transactional(move)
}

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
  access?: MessageAttachmentLinkAccess,
): Promise<void> {
  if (attachmentIds.length === 0) return

  await moveAttachmentsToMessage(em, {
    id: { $in: attachmentIds },
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  }, messageId, access)
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
  access?: MessageAttachmentLinkAccess,
): Promise<void> {
  if (!sourceRecordId.trim()) return

  await moveAttachmentsToMessage(em, {
    entityId: LIBRARY_ATTACHMENT_ENTITY_ID,
    recordId: sourceRecordId,
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  }, messageId, access)
}

export async function copyAttachmentsForForward(
  em: EntityManager,
  sourceMessageId: string,
  targetMessageId: string,
  tenantId: string,
): Promise<number> {
  return copyAttachmentsForForwardMessages(
    em,
    [sourceMessageId],
    targetMessageId,
    tenantId,
  )
}

export async function copyAttachmentsForForwardMessages(
  em: EntityManager,
  sourceMessageIds: string[],
  targetMessageId: string,
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

  let copied = 0
  for (const sourceAttachment of dedupedById.values()) {
    // Carry the source attachment's scope across as a unit so a forwarded copy
    // can never become a partial-null row. Source rows that are themselves
    // partial-null are unreadable dead data; skip rather than propagate them.
    const scope = resolveAttachmentScopePair(sourceAttachment)
    if (!scope) continue

    const copy = em.create(Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: targetMessageId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
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
    copied += 1
  }

  if (copied > 0) {
    await em.flush()
  }
  return copied
}
