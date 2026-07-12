import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { DocumentAttachment } from '../data/entities'
import {
  releaseScopedAttachment,
  resolveAttachmentServicePort,
  type AttachmentProviderCleanupPort,
} from '../lib/attachmentServicePort'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { lockDocumentAggregateRoot } from './aggregate'
import { documentsScopedCommandSchema, nextDocumentVersion } from './mutation-helpers'
import {
  assertDocumentCommandCapability,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandScope,
  type DocumentsCommandScope,
} from './shared'

const DOCUMENT_ATTACHMENT_PARTITION_CODE = 'privateAttachments'
const logger = createLogger('documents').child({ component: 'attachments' })

export const documentAttachmentDeleteCommandSchema = documentsScopedCommandSchema.extend({
  documentId: z.string().uuid(),
  attachmentId: z.string().uuid(),
})

export type DocumentAttachmentDeleteCommandInput = z.infer<typeof documentAttachmentDeleteCommandSchema>

type DocumentAttachmentDeleteCommandResult = {
  id: string
  attachmentId: string
  updatedAt: string
}

async function loadLockedAttachmentLink(
  em: EntityManager,
  scope: DocumentsCommandScope,
  documentId: string,
  attachmentId: string,
): Promise<DocumentAttachment> {
  const link = await findOneWithDecryption(
    em,
    DocumentAttachment,
    {
      documentId,
      attachmentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  if (!link) throw new CrudHttpError(404, { error: 'Attachment not found' })
  return link
}

async function releaseAttachmentLink(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: DocumentsCommandScope,
  link: DocumentAttachment,
): Promise<AttachmentProviderCleanupPort | null> {
  const attachmentService = resolveAttachmentServicePort(ctx.container)
  const cleanup = await releaseScopedAttachment(attachmentService, {
    attachmentId: link.attachmentId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    expectedOwner: { entityId: DOCUMENTS_ENTITY_IDS.document, recordId: link.documentId },
    expectedAssignment: { type: DOCUMENTS_ENTITY_IDS.document, id: link.documentId },
    expectedPartitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
  }, { em, flush: false })
  const now = nextDocumentVersion(link.updatedAt)
  link.deletedAt = now
  link.updatedAt = now
  return cleanup ?? null
}

export async function runAttachmentProviderCleanups(
  cleanups: readonly AttachmentProviderCleanupPort[],
): Promise<void> {
  for (const cleanup of cleanups) {
    try {
      await cleanup()
    } catch (error) {
      logger.error('Failed to delete committed document attachment bytes', { err: error })
    }
  }
}

export async function releaseAllDocumentAttachments(
  ctx: CommandRuntimeContext,
  em: EntityManager,
  scope: DocumentsCommandScope,
  documentId: string,
): Promise<AttachmentProviderCleanupPort[]> {
  const links = await findWithDecryption(
    em,
    DocumentAttachment,
    {
      documentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  const cleanups: AttachmentProviderCleanupPort[] = []
  for (const link of links) {
    const cleanup = await releaseAttachmentLink(ctx, em, scope, link)
    if (cleanup) cleanups.push(cleanup)
  }
  return cleanups
}

const deleteDocumentAttachmentCommand: CommandHandler<
  DocumentAttachmentDeleteCommandInput,
  DocumentAttachmentDeleteCommandResult
> = {
  id: 'documents.attachment.delete',
  // Provider bytes are permanently removed to release tenant quota, so the
  // operation is audited but cannot offer a misleading undo action.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = documentAttachmentDeleteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let link!: DocumentAttachment
    let providerCleanup: AttachmentProviderCleanupPort | null = null
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.documentId, scope)
      await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canEdit')
      link = await loadLockedAttachmentLink(em, scope, input.documentId, input.attachmentId)
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
        resourceId: link.id,
        current: link.updatedAt,
        request: ctx.request ?? null,
      })
      providerCleanup = await releaseAttachmentLink(ctx, em, scope, link)
    }], { transaction: true, label: 'documents.attachment.delete' })
    if (providerCleanup) await runAttachmentProviderCleanups([providerCleanup])
    return { id: link.id, attachmentId: link.attachmentId, updatedAt: link.updatedAt.toISOString() }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.attachmentDeleted', 'Attachment permanently deleted'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: {
        id: result.id,
        documentId: input.documentId,
        attachmentId: result.attachmentId,
      },
      snapshotAfter: null,
    }
  },
}

registerCommand(deleteDocumentAttachmentCommand)

export { deleteDocumentAttachmentCommand }
