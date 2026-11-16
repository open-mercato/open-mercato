import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveAttachmentScopePair } from '@open-mercato/core/modules/attachments/lib/scope'
import { withUploadProvenance } from '@open-mercato/core/modules/attachments/lib/uploadProvenance'
import { mergeAttachmentMetadata, readAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { assertMessageAttachmentSource, denyMessageAttachmentAccess, type MessageAttachmentAccess } from './attachmentAccess'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'
const LIBRARY_ATTACHMENT_ENTITY_ID = 'attachments:library'

function buildOrganizationScopeFilter(organizationId: string | null) {
  return { organizationId }
}

export async function linkAttachmentsToMessage(
  em: EntityManager,
  messageId: string,
  attachmentIds: string[],
  organizationId: string | null,
  tenantId: string,
  access?: MessageAttachmentAccess,
): Promise<void> {
  if (attachmentIds.length === 0) return

  await withAtomicFlush(em as PostgreSqlEntityManager, [async () => {
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

    const attachments = await findWithDecryption(em as PostgreSqlEntityManager, Attachment, {
      id: { $in: attachmentIds },
      tenantId,
      ...buildOrganizationScopeFilter(organizationId),
    }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } }, { tenantId, organizationId })

    if (attachments.length !== new Set(attachmentIds).size) return denyMessageAttachmentAccess()
    for (const attachment of attachments) {
      await assertMessageAttachmentSource(em, attachment, organizationId, tenantId, access)
    }

    for (const attachment of attachments) {
      if (attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID && attachment.recordId === messageId) continue
      if (attachment.entityId === LIBRARY_ATTACHMENT_ENTITY_ID) {
        attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
        attachment.recordId = messageId
      } else {
        const { id: _id, createdAt: _createdAt, ...values } = attachment
        em.persist(em.create(Attachment, {
          ...values,
          entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
          recordId: messageId,
          storageMetadata: withUploadProvenance(attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID
            ? attachment.storageMetadata
            : mergeAttachmentMetadata(attachment.storageMetadata, {
              assignments: [
                ...(readAttachmentMetadata(attachment.storageMetadata).assignments ?? []),
                { type: attachment.entityId, id: attachment.recordId },
              ],
            }), access!.auth!),
        }))
      }
    }
  }], { transaction: true })
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
  attachmentId?: string
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
    attachmentId: attachment.id,
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
  access?: MessageAttachmentAccess,
): Promise<void> {
  if (!sourceRecordId.trim()) return

  await withAtomicFlush(em as PostgreSqlEntityManager, [async () => {
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')

    const attachments = await findWithDecryption(em as PostgreSqlEntityManager, Attachment, {
      entityId: LIBRARY_ATTACHMENT_ENTITY_ID,
      recordId: sourceRecordId,
      tenantId,
      ...buildOrganizationScopeFilter(organizationId),
    }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } }, { tenantId, organizationId })

    if (!attachments.length) return

    for (const attachment of attachments) {
      await assertMessageAttachmentSource(em, attachment, organizationId, tenantId, access)
    }

    for (const attachment of attachments) {
      attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
      attachment.recordId = messageId
    }
  }], { transaction: true })
}

export async function copyAttachmentsForForward(
  em: EntityManager,
  sourceMessageId: string,
  targetMessageId: string,
  tenantId: string,
  access?: MessageAttachmentAccess,
): Promise<number> {
  return copyAttachmentsForForwardMessages(
    em,
    [sourceMessageId],
    targetMessageId,
    tenantId,
    access,
  )
}

export async function copyAttachmentsForForwardMessages(
  em: EntityManager,
  sourceMessageIds: string[],
  targetMessageId: string,
  tenantId: string,
  access?: MessageAttachmentAccess,
): Promise<number> {
  if (sourceMessageIds.length === 0) return 0

  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const sourceAttachments = await findWithDecryption(em as PostgreSqlEntityManager, Attachment, {
    entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
    recordId: { $in: sourceMessageIds },
    tenantId,
    organizationId: access?.auth?.orgId ?? null,
  })
  if (sourceAttachments.length === 0) {
    return 0
  }
  for (const attachment of sourceAttachments) {
    await assertMessageAttachmentSource(em, attachment, access?.auth?.orgId ?? null, tenantId, access, 'read')
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
      storageMetadata: withUploadProvenance(sourceAttachment.storageMetadata, access!.auth!),
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

export async function detachMessageAttachments(
  em: EntityManager,
  messageId: string,
  attachmentIds: string[] | undefined,
  organizationId: string | null,
  tenantId: string,
  access?: MessageAttachmentAccess,
): Promise<void> {
  await withAtomicFlush(em as PostgreSqlEntityManager, [async () => {
    const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
    const attachments = await findWithDecryption(em as PostgreSqlEntityManager, Attachment, {
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID, recordId: messageId, tenantId, organizationId,
      ...(attachmentIds ? { id: { $in: attachmentIds } } : {}),
    }, { lockMode: LockMode.PESSIMISTIC_WRITE, orderBy: { id: 'asc' } }, { tenantId, organizationId })
    for (const attachment of attachments) {
      await assertMessageAttachmentSource(em, attachment, organizationId, tenantId, access, 'read')
    }
    for (const attachment of attachments) {
      attachment.entityId = LIBRARY_ATTACHMENT_ENTITY_ID
      attachment.recordId = `messages-detached:${messageId}`
    }
  }], { transaction: true })
}
