import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as SqlEntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveAttachmentScopePair } from '@open-mercato/core/modules/attachments/lib/scope'
import type { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { MESSAGE_ATTACHMENT_ENTITY_ID } from './constants'
import type { MessageAttachmentLinkAccess } from './attachmentLinkAccess'
import { isAttachmentsModuleAvailable } from './optionalModules'
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
    em: em as unknown as SqlEntityManager,
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
  scope: { tenantId: string; organizationId: string | null },
  messageId: string,
  access: MessageAttachmentLinkAccess | undefined,
): Promise<void> {
  const { Attachment } = await import('@open-mercato/core/modules/attachments/data/entities')
  const { ATTACHMENT_ROW_WRITE_LOCK } = await import('@open-mercato/core/modules/attachments/lib/access-rows')
  const move = async (tx: EntityManager) => {
    const attachments = await findWithDecryption(
      tx as unknown as SqlEntityManager,
      Attachment,
      filter,
      ATTACHMENT_ROW_WRITE_LOCK,
      scope,
    )
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
  if (!(await isAttachmentsModuleAvailable(em))) return

  await moveAttachmentsToMessage(em, {
    id: { $in: attachmentIds },
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  }, { tenantId, organizationId }, messageId, access)
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
  em: SqlEntityManager,
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
  const sqlEm = em as unknown as SqlEntityManager
  if (!(await isAttachmentsModuleAvailable(em))) return { deletedCount: 0, purgedSections: [] }
  const run = async (target: SqlEntityManager): Promise<DeletedMessageAttachmentRows> => {
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
  if (!(await isAttachmentsModuleAvailable(em))) return []
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
  if (!(await isAttachmentsModuleAvailable(em))) return []
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
  if (!(await isAttachmentsModuleAvailable(em))) return

  await moveAttachmentsToMessage(em, {
    entityId: LIBRARY_ATTACHMENT_ENTITY_ID,
    recordId: sourceRecordId,
    tenantId,
    ...buildOrganizationScopeFilter(organizationId),
  }, { tenantId, organizationId }, messageId, access)
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
  if (!(await isAttachmentsModuleAvailable(em))) return 0

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
