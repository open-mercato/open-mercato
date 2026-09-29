import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
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
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandScope,
  type DocumentsCommandScope,
} from './shared'

export const DOCUMENT_ATTACHMENT_PARTITION_CODE = 'privateAttachments'
const ATTACHMENT_ENTITY_ID = 'attachments:attachment'
const logger = createLogger('documents').child({ component: 'attachments' })

export const DOCUMENT_ATTACHMENT_UPLOAD_CONTEXT = Symbol.for(
  'open-mercato.documents.attachment-upload-context',
)

type DocumentAttachmentUploadRuntimeContext = CommandRuntimeContext & {
  [DOCUMENT_ATTACHMENT_UPLOAD_CONTEXT]?: {
    buffer: Buffer
  }
}

export const documentAttachmentCreateCommandSchema = documentsScopedCommandSchema.extend({
  documentId: z.string().uuid(),
  fileName: z.string().trim().min(1),
  fileType: z.string().nullable(),
  fileSize: z.number().int().nonnegative(),
})

export type DocumentAttachmentCreateCommandInput = z.infer<typeof documentAttachmentCreateCommandSchema>

export type DocumentAttachmentCreateCommandResult = {
  id: string
  attachmentId: string
  linkId: string
  updatedAt: string
}

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

function resolveUploadBuffer(ctx: CommandRuntimeContext): Buffer {
  const payload = (ctx as DocumentAttachmentUploadRuntimeContext)[DOCUMENT_ATTACHMENT_UPLOAD_CONTEXT]
  if (!payload || !Buffer.isBuffer(payload.buffer)) {
    throw new CrudHttpError(400, { error: 'Attachment upload payload is required' })
  }
  return payload.buffer
}

const createDocumentAttachmentCommand: CommandHandler<
  DocumentAttachmentCreateCommandInput,
  DocumentAttachmentCreateCommandResult
> = {
  id: 'documents.attachment.create',
  // Upload bytes are intentionally excluded from the durable command payload.
  // Replaying the command could not recreate provider bytes safely, so creation
  // is audited but exposes deletion as the explicit compensating operation.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = documentAttachmentCreateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const attachmentService = resolveAttachmentServicePort(ctx.container)
    const buffer = resolveUploadBuffer(ctx)
    if (buffer.byteLength !== input.fileSize) {
      throw new CrudHttpError(400, { error: 'Attachment upload size does not match the command metadata' })
    }
    attachmentService.validateUpload({
      fileName: input.fileName,
      fileSize: input.fileSize,
    })

    const linkState: { value: DocumentAttachment | null } = { value: null }
    const created = await attachmentService.createScoped({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: input.documentId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      partitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
      fileName: input.fileName,
      declaredMimeType: input.fileType,
      buffer,
      assignments: [{ type: DOCUMENTS_ENTITY_IDS.document, id: input.documentId }],
      persistLink: async (tx, attachmentId) => {
        const transactionalContext: CommandRuntimeContext = {
          ...ctx,
          transactionalEm: tx,
        }
        // Provider I/O may finish after a grant was revoked. Re-lock the
        // document and resolve the current capability inside the attachment
        // service transaction before either row can commit.
        await lockDocumentAggregateRoot(tx, input.documentId, scope)
        await assertDocumentCommandCapability(
          transactionalContext,
          tx,
          input.documentId,
          scope,
          'canEdit',
        )
        const link = tx.create(DocumentAttachment, {
          id: randomUUID(),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          documentId: input.documentId,
          attachmentId,
          createdByUserId: actorUserId,
        })
        tx.persist(link)
        linkState.value = link
      },
    })

    const link = linkState.value
    if (!link) throw new Error('[internal] document attachment link was not persisted')
    return {
      id: created.id,
      attachmentId: created.id,
      linkId: link.id,
      updatedAt: link.updatedAt.toISOString(),
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.attachmentCreated', 'Attachment uploaded'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: result.linkId,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      relatedResourceKind: ATTACHMENT_ENTITY_ID,
      relatedResourceId: result.attachmentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: null,
      snapshotAfter: {
        id: result.linkId,
        documentId: input.documentId,
        attachmentId: result.attachmentId,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize,
      },
    }
  },
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

registerCommand(createDocumentAttachmentCommand)
registerCommand(deleteDocumentAttachmentCommand)

export { createDocumentAttachmentCommand, deleteDocumentAttachmentCommand }
