import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import { LockMode } from '@mikro-orm/core'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { resolveAttachmentScopePair } from '@open-mercato/core/modules/attachments/lib/scope'
import { assertAttachmentScopeInvariant } from '@open-mercato/core/modules/attachments/lib/access'
import { withUploadProvenance } from '@open-mercato/core/modules/attachments/lib/uploadProvenance'
import { mergeAttachmentMetadata, readAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { assertMessageAttachmentSources, denyMessageAttachmentAccess, type MessageAttachmentAccess } from './attachmentAccess'
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
    await assertMessageAttachmentSources(em, attachments, organizationId, tenantId, access)

    for (const attachment of attachments) {
      if (attachment.entityId === MESSAGE_ATTACHMENT_ENTITY_ID && attachment.recordId === messageId) continue
      if (attachment.entityId === LIBRARY_ATTACHMENT_ENTITY_ID) {
        attachment.entityId = MESSAGE_ATTACHMENT_ENTITY_ID
        attachment.recordId = messageId
      } else {
        assertAttachmentScopeInvariant({ tenantId: attachment.tenantId, organizationId: attachment.organizationId })
        const { id: _id, createdAt: _createdAt, ...values } = attachment
        const attachmentId = randomUUID()
        em.persist(em.create(Attachment, {
          ...values,
          id: attachmentId,
          url: buildAttachmentFileUrl(attachmentId),
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

type MessageAttachmentRowsDatabase = {
  attachments: {
    id: string
    entity_id: string
    record_id: string
    tenant_id: string | null
    organization_id: string | null
  }
}

export type MessageAttachmentRowsFilter = {
  messageId: string
  tenantId: string
  organizationId: string | null
  includeIds?: readonly string[]
  excludeIds?: readonly string[]
}

type AttachmentRowScope = { tenantId: string | null; organizationId: string | null }

export type DeletedMessageAttachmentRows = {
  deletedCount: number
  purgedSections: Array<{ scope: AttachmentRowScope; sectionIds: string[] }>
}

async function selectMessageAttachmentRows(
  em: PostgreSqlEntityManager,
  filter: MessageAttachmentRowsFilter,
): Promise<Array<{ id: string } & AttachmentRowScope>> {
  if (filter.includeIds && filter.includeIds.length === 0) return []
  let query = em
    .getKysely<MessageAttachmentRowsDatabase>()
    .selectFrom('attachments')
    .select(['id', 'tenant_id', 'organization_id'])
    .where('entity_id', '=', MESSAGE_ATTACHMENT_ENTITY_ID)
    .where('record_id', '=', filter.messageId)
    .where('tenant_id', '=', filter.tenantId)
  query = filter.organizationId === null
    ? query.where('organization_id', 'is', null)
    : query.where('organization_id', '=', filter.organizationId)
  if (filter.includeIds) query = query.where('id', 'in', [...filter.includeIds])
  if (filter.excludeIds && filter.excludeIds.length > 0) query = query.where('id', 'not in', [...filter.excludeIds])
  const rows = await query.execute()
  return rows.map((row) => ({
    id: String(row.id),
    tenantId: row.tenant_id ?? null,
    organizationId: row.organization_id ?? null,
  }))
}

/**
 * Deletes message attachment rows together with their document structure (extractions and
 * sections). Joins the caller's transaction when one is open, otherwise opens its own. The search
 * records of purged sections are NOT cleaned here: pass the result to
 * `enqueueMessageAttachmentSectionCleanup` once the surrounding transaction has committed.
 */
export async function deleteMessageAttachmentRows(
  em: EntityManager,
  filter: MessageAttachmentRowsFilter,
): Promise<DeletedMessageAttachmentRows> {
  const sqlEm = em as unknown as PostgreSqlEntityManager
  const run = async (target: PostgreSqlEntityManager): Promise<DeletedMessageAttachmentRows> => {
    const rows = await selectMessageAttachmentRows(target, filter)
    if (rows.length === 0) return { deletedCount: 0, purgedSections: [] }
    const [{ Attachment }, { purgeDocumentStructure }] = await Promise.all([
      import('@open-mercato/core/modules/attachments/data/entities'),
      import('@open-mercato/core/modules/attachments/lib/documentStructure/purge'),
    ])
    const purgedSections: DeletedMessageAttachmentRows['purgedSections'] = []
    for (const row of rows) {
      const scope = { tenantId: row.tenantId, organizationId: row.organizationId }
      if ((scope.tenantId === null) !== (scope.organizationId === null)) continue
      const purge = await purgeDocumentStructure(target, { attachmentId: row.id, ...scope }, { flush: false })
      if (purge.indexedSectionIds.length > 0) purgedSections.push({ scope, sectionIds: purge.indexedSectionIds })
    }
    const deletedCount = await target.nativeDelete(Attachment, {
      id: { $in: rows.map((row) => row.id) },
      entityId: MESSAGE_ATTACHMENT_ENTITY_ID,
      recordId: filter.messageId,
      tenantId: filter.tenantId,
      organizationId: filter.organizationId,
    })
    return { deletedCount, purgedSections }
  }
  const isInTransaction = (sqlEm as { isInTransaction?: () => boolean }).isInTransaction
  if (typeof isInTransaction === 'function' && isInTransaction.call(sqlEm)) return run(sqlEm)
  return sqlEm.transactional((tx) => run(tx))
}

export async function enqueueMessageAttachmentSectionCleanup(deleted: DeletedMessageAttachmentRows): Promise<void> {
  if (deleted.purgedSections.length === 0) return
  const { enqueuePurgedSectionSearchDelete } = await import('@open-mercato/core/modules/attachments/lib/documentStructure/purge')
  for (const entry of deleted.purgedSections) await enqueuePurgedSectionSearchDelete(entry.scope, entry.sectionIds)
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

    await assertMessageAttachmentSources(em, attachments, organizationId, tenantId, access)

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
  await assertMessageAttachmentSources(em, sourceAttachments, access?.auth?.orgId ?? null, tenantId, access, 'read')

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

    const attachmentId = randomUUID()
    const copy = em.create(Attachment, {
      id: attachmentId,
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
      url: buildAttachmentFileUrl(attachmentId),
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
    await assertMessageAttachmentSources(em, attachments, organizationId, tenantId, access, 'read')
    for (const attachment of attachments) {
      attachment.entityId = LIBRARY_ATTACHMENT_ENTITY_ID
      attachment.recordId = `messages-detached:${messageId}`
    }
  }], { transaction: true })
}
