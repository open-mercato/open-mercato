import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import {
  Document,
  DocumentAttachment,
  DocumentContent,
  DocumentEntityLink,
  DocumentFolder,
} from '../data/entities'
import {
  documentEntityLinkSourceSchema,
  documentEntityTypeSchema,
  documentTitleSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { materializeDocumentHtml } from '../lib/collabMaterializer'
import {
  advanceDocumentCollaborationGeneration,
  mutateDocumentContentState,
} from '../lib/contentService'
import { createDocumentEntityLinkData } from '../lib/entityLinks'
import {
  rewriteDuplicateAttachmentUrls,
  type DuplicateAttachmentIdMap,
} from '../lib/duplicateContent'
import {
  resolveAttachmentServicePort,
  type AttachmentProviderCleanupPort,
} from '../lib/attachmentServicePort'
import { DOCUMENT_ATTACHMENT_PARTITION_CODE, releaseAllDocumentAttachments } from './attachments'
import {
  assertNoPostCreateDocumentDependents,
  lockDocumentAggregateRoot,
} from './aggregate'
import { bufferDocumentMutationSideEffects, bufferLinkMutationSideEffects } from './side-effects'
import {
  assertCommandFeature,
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
} from './shared'
import { nextDocumentVersion } from './mutation-helpers'
import type { DocumentsProjectionDescriptor } from './projection-types'

const logger = createLogger('documents').child({ component: 'duplicate-command' })

export const DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS = 50
export const DOCUMENTS_DUPLICATE_MAX_LINKS = 100

const duplicateVerifiedLinkSchema = z.object({
  entityType: documentEntityTypeSchema,
  entityId: z.string().uuid(),
  labelSnapshot: z.string().min(1),
  hrefSnapshot: z.string().min(1),
  source: documentEntityLinkSourceSchema,
})

export type DuplicateVerifiedLink = z.infer<typeof duplicateVerifiedLinkSchema>

export const duplicateDocumentCommandSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  newDocumentId: z.string().uuid(),
  newContentId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  title: documentTitleSchema.optional(),
  localizedCopyTitle: z.string().min(1),
  verifiedLinks: z.array(duplicateVerifiedLinkSchema).max(DOCUMENTS_DUPLICATE_MAX_LINKS),
})

export type DuplicateDocumentCommandInput = z.infer<typeof duplicateDocumentCommandSchema>

type DuplicateSnapshot = {
  documentUpdatedAt: string | null
  documentDeletedAt: string | null
  contentUpdatedAt: string | null
  contentDeletedAt: string | null
  linkIds: string[]
  attachmentIds: string[]
}

export type DuplicateDocumentCommandResult = {
  id: string
  updatedAt: string
  copiedAttachments: number
  copiedLinks: number
  droppedLinks: number
  after: DuplicateSnapshot
  projections?: DocumentsProjectionDescriptor[]
}

type DuplicateUndoPayload = {
  after?: DuplicateSnapshot | null
}

function readContentDispositionFileName(contentDisposition: string): string | null {
  const encodedMatch = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)
  if (encodedMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(encodedMatch[1]).trim()
      if (decoded.length > 0) return decoded
    } catch {
      return null
    }
  }
  const plainMatch = /filename="?([^";]+)"?/i.exec(contentDisposition)
  const plain = plainMatch?.[1]?.trim()
  return plain && plain.length > 0 ? plain : null
}

function buildDuplicateTitle(input: DuplicateDocumentCommandInput, sourceTitle: string): string {
  if (input.title) return Array.from(input.title).slice(0, 512).join('')
  const rendered = input.localizedCopyTitle.includes('{title}')
    ? input.localizedCopyTitle.replaceAll('{title}', sourceTitle)
    : `${sourceTitle} ${input.localizedCopyTitle}`
  return Array.from(rendered).slice(0, 512).join('')
}

function assertHumanActor(input: DuplicateDocumentCommandInput, ctx: CommandRuntimeContext): void {
  const auth = ctx.auth as (AuthContext & { isApiKey?: boolean }) | null | undefined
  if (!auth || auth.isApiKey === true || auth.sub.startsWith('api_key:')) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function assertDuplicateEntityUnchanged(
  entity: { updatedAt: Date; deletedAt?: Date | null } | null,
  expected: { updatedAt: string | null; deletedAt: string | null },
  resourceKind: string,
  resourceId: string,
): void {
  if (!entity || !expected.updatedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind,
    resourceId,
    current: entity.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  const deletedAt = entity.deletedAt?.toISOString() ?? null
  if (deletedAt !== expected.deletedAt) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      entity.updatedAt.toISOString(),
      expected.updatedAt,
    ))
  }
}

async function loadSourceAggregate(
  em: EntityManager,
  input: DuplicateDocumentCommandInput,
  scope: { tenantId: string; organizationId: string },
): Promise<{ source: Document; content: DocumentContent | null; attachments: DocumentAttachment[] }> {
  const source = await findOneWithDecryption(
    em,
    Document,
    {
      id: input.sourceDocumentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  if (!source) throw new CrudHttpError(404, { error: 'documents.documents.notFound' })
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    {
      documentId: input.sourceDocumentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    undefined,
    scope,
  )
  const attachments = await findWithDecryption(
    em,
    DocumentAttachment,
    {
      documentId: input.sourceDocumentId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'ASC', id: 'ASC' } },
    scope,
  )
  return { source, content, attachments }
}

type DuplicateTargetAggregate = {
  document: Document | null
  content: DocumentContent | null
}

async function loadDuplicateTargetAggregate(
  em: EntityManager,
  input: DuplicateDocumentCommandInput,
  scope: { tenantId: string; organizationId: string },
): Promise<DuplicateTargetAggregate> {
  const document = await findOneWithDecryption(
    em,
    Document,
    { id: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    { documentId: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  return { document, content }
}

/**
 * Redo replays this command with the identities the first run allocated, so the
 * rows undo (or compensation) soft-deleted still occupy those primary keys.
 * Resurrect exactly those rows instead of inserting colliding ones, and refuse
 * anything that is not this actor's own retired copy.
 */
function assertResumableDuplicateTarget(
  target: DuplicateTargetAggregate,
  input: DuplicateDocumentCommandInput,
): void {
  const documentResumable = !target.document || (
    target.document.deletedAt != null
    && target.document.ownerUserId === input.actorUserId
    && target.document.createdByUserId === input.actorUserId
  )
  const contentResumable = !target.content || (
    target.content.deletedAt != null
    && target.content.id === input.newContentId
  )
  if (!documentResumable || !contentResumable) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}

/**
 * The copy inherits the source folder only when the actor may place documents
 * there. Create and update enforce the same owner-or-`documents.manage` rule;
 * duplicating a document shared out of somebody else's folder therefore lands
 * the copy in the actor's root rather than writing into a foreign folder.
 */
async function resolveDuplicateFolderId(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  sourceFolderId: string | null,
  actorUserId: string,
  features: readonly string[],
): Promise<string | null> {
  if (!sourceFolderId) return null
  const folder = await findOneWithDecryption(
    em,
    DocumentFolder,
    {
      id: sourceFolderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_READ },
    scope,
  )
  if (!folder) return null
  if (folder.ownerUserId === actorUserId) return folder.id
  return hasAllFeatures(['documents.manage'], Array.from(features)) ? folder.id : null
}

async function compensateHiddenCopy(
  ctx: CommandRuntimeContext,
  sourceEm: EntityManager,
  scope: { tenantId: string; organizationId: string },
  input: DuplicateDocumentCommandInput,
  cleanups: AttachmentProviderCleanupPort[],
): Promise<void> {
  // Compensation runs after a failed flush; a fork isolates it from any
  // dirty identity-map state the aborted transaction left behind.
  const em = sourceEm.fork()
  await withAtomicFlush(em, [async () => {
    const attachmentCleanups = await releaseAllDocumentAttachments(ctx, em, scope, input.newDocumentId)
    cleanups.push(...attachmentCleanups)
    const links = await findWithDecryption(
      em,
      DocumentEntityLink,
      {
        documentId: input.newDocumentId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )
    for (const link of links) {
      const now = nextDocumentVersion(link.updatedAt)
      link.deletedAt = now
      link.updatedAt = now
    }
    const content = await findOneWithDecryption(
      em,
      DocumentContent,
      { documentId: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { filters: false },
      scope,
    )
    if (content && !content.deletedAt) {
      const now = nextDocumentVersion(content.updatedAt)
      content.deletedAt = now
      content.updatedAt = now
    }
    const copyDocument = await findOneWithDecryption(
      em,
      Document,
      { id: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { filters: false },
      scope,
    )
    if (copyDocument && !copyDocument.deletedAt) {
      const now = nextDocumentVersion(copyDocument.updatedAt)
      copyDocument.deletedAt = now
      copyDocument.updatedAt = now
    }
  }], { transaction: true, label: 'documents.document.duplicate.compensate' })
}

const duplicateDocumentCommand: CommandHandler<DuplicateDocumentCommandInput, DuplicateDocumentCommandResult> = {
  id: 'documents.document.duplicate',
  async execute(rawInput, ctx) {
    const input = duplicateDocumentCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    assertHumanActor(input, ctx)
    const features = await resolveDocumentsCommandFeatures(ctx, scope)
    assertCommandFeature(features, 'documents.create')
    assertCommandFeature(features, 'documents.edit')

    let copyDocument: Document | null = null
    let sourceAttachments: DocumentAttachment[] = []
    let sourceTitleForLog = ''
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.sourceDocumentId, scope)
      const sourceFeatures = await assertDocumentCommandCapability(
        ctx,
        em,
        input.sourceDocumentId,
        scope,
        'canView',
      )
      const aggregate = await loadSourceAggregate(em, input, scope)
      sourceTitleForLog = aggregate.source.title
      sourceAttachments = aggregate.attachments
      if (aggregate.attachments.length > DOCUMENTS_DUPLICATE_MAX_ATTACHMENTS) {
        throw new CrudHttpError(422, { error: 'documents.errors.duplicateSourceTooLarge' })
      }
      const target = await loadDuplicateTargetAggregate(em, input, scope)
      assertResumableDuplicateTarget(target, input)
      const folderId = await resolveDuplicateFolderId(
        em,
        scope,
        aggregate.source.folderId ?? null,
        input.actorUserId,
        sourceFeatures,
      )

      const hiddenAt = new Date()
      const title = buildDuplicateTitle(input, aggregate.source.title)
      if (target.document) {
        const hiddenVersion = nextDocumentVersion(target.document.updatedAt, hiddenAt)
        copyDocument = target.document
        copyDocument.title = title
        copyDocument.folderId = folderId
        copyDocument.ownerUserId = input.actorUserId
        copyDocument.createdByUserId = input.actorUserId
        copyDocument.isActive = true
        copyDocument.deletedAt = hiddenVersion
        copyDocument.updatedAt = hiddenVersion
      } else {
        copyDocument = em.create(Document, {
          id: input.newDocumentId,
          title,
          folderId,
          ownerUserId: input.actorUserId,
          createdByUserId: input.actorUserId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: hiddenAt,
        })
        em.persist(copyDocument)
      }

      const sourceHtml = aggregate.content?.contentHtml ?? ''
      const materialized = sourceHtml.trim().length > 0 ? materializeDocumentHtml(sourceHtml) : null
      const copyContent = await mutateDocumentContentState(em, input.newDocumentId, scope, {
        yjsState: materialized?.yjsState ?? null,
        contentHtml: materialized?.html ?? sourceHtml,
        contentText: materialized?.text ?? (aggregate.content?.contentText ?? ''),
      }, { id: input.newContentId, existingContent: target.content })
      // Resurrecting a retired copy replaces its content wholesale, so any room
      // still holding the pre-undo Yjs state has to be forced to reload.
      if (target.content) advanceDocumentCollaborationGeneration(copyContent)

      for (const verifiedLink of input.verifiedLinks) {
        const linkData = createDocumentEntityLinkData({
          id: randomUUID(),
          documentId: input.newDocumentId,
          scope,
          actorUserId: input.actorUserId,
          link: {
            entityType: verifiedLink.entityType,
            entityId: verifiedLink.entityId,
            label: verifiedLink.labelSnapshot,
            href: verifiedLink.hrefSnapshot,
            source: verifiedLink.source,
          },
        })
        em.persist(em.create(DocumentEntityLink, linkData))
      }
    }], { transaction: true, label: 'documents.document.duplicate' })

    const createdDocument = copyDocument as Document | null
    if (!createdDocument) throw new Error('[internal] duplicate produced no document row')

    const attachmentService = resolveAttachmentServicePort(ctx.container)
    const attachmentIdMap = new Map<string, string>()
    const failureCleanups: AttachmentProviderCleanupPort[] = []
    let revealedUpdatedAt = ''
    // Compensation may only reach state the caller has never seen. It runs
    // strictly between the hidden insert and the reveal commit; once that
    // transaction commits, the copy is durable and visible, and a later failure
    // must be reported rather than soft-deleting the user's document.
    try {
      for (const sourceAttachment of sourceAttachments) {
        const bytes = await attachmentService.readScoped({
          attachmentId: sourceAttachment.attachmentId,
          auth: ctx.auth as NonNullable<AuthContext>,
          expectedOwner: { entityId: DOCUMENTS_ENTITY_IDS.document, recordId: input.sourceDocumentId },
          expectedAssignment: { type: DOCUMENTS_ENTITY_IDS.document, id: input.sourceDocumentId },
          expectedPartitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
          requirePrivatePartition: true,
        })
        const created = await attachmentService.createScoped({
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          entityId: DOCUMENTS_ENTITY_IDS.document,
          recordId: input.newDocumentId,
          partitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
          fileName: readContentDispositionFileName(bytes.contentDisposition) ?? sourceAttachment.attachmentId,
          declaredMimeType: bytes.contentType,
          buffer: bytes.buffer,
          assignments: [{ type: DOCUMENTS_ENTITY_IDS.document, id: input.newDocumentId }],
          persistLink: (tx, attachmentId) => {
            tx.persist(tx.create(DocumentAttachment, {
              id: randomUUID(),
              documentId: input.newDocumentId,
              attachmentId,
              createdByUserId: input.actorUserId,
              tenantId: scope.tenantId,
              organizationId: scope.organizationId,
            }))
          },
        })
        attachmentIdMap.set(sourceAttachment.attachmentId, created.id)
      }

      await withAtomicFlush(em, [async () => {
        // Attachment bytes are copied outside the aggregate lock, so the reveal
        // must re-derive authorization rather than trust the pre-copy snapshot.
        // A share revoked while the copy was building therefore leaves the copy
        // hidden and the catch below compensates it away.
        await lockDocumentAggregateRoot(em, input.sourceDocumentId, scope)
        const revealFeatures = await assertDocumentCommandCapability(
          ctx,
          em,
          input.sourceDocumentId,
          scope,
          'canView',
        )
        assertCommandFeature(revealFeatures, 'documents.create')
        assertCommandFeature(revealFeatures, 'documents.edit')
        const content = await findOneWithDecryption(
          em,
          DocumentContent,
          { documentId: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
          { filters: false },
          scope,
        )
        if (!content) throw new Error('[internal] duplicate produced no content row')
        if (attachmentIdMap.size > 0) {
          const rewrittenHtml = rewriteDuplicateAttachmentUrls(content.contentHtml ?? '', {
            sourceDocumentId: input.sourceDocumentId,
            copyDocumentId: input.newDocumentId,
            attachmentIds: attachmentIdMap as DuplicateAttachmentIdMap,
          })
          // The copy's Yjs state was materialized from the pre-rewrite HTML in
          // step 1; rebuild it from the rewritten HTML or the first collab load
          // would resurrect source-document attachment URLs.
          const rematerialized = rewrittenHtml.trim().length > 0 ? materializeDocumentHtml(rewrittenHtml) : null
          content.contentHtml = rematerialized?.html ?? rewrittenHtml
          content.contentText = rematerialized?.text ?? content.contentText
          content.yjsState = rematerialized?.yjsState ?? null
        }
        const revealVersion = nextDocumentVersion(createdDocument.updatedAt)
        createdDocument.deletedAt = null
        createdDocument.updatedAt = revealVersion
        content.updatedAt = nextDocumentVersion(content.updatedAt)
        revealedUpdatedAt = revealVersion.toISOString()
      }], { transaction: true, label: 'documents.document.duplicate.reveal' })
    } catch (error) {
      logger.error('Document duplicate failed before the copy became visible', {
        sourceDocumentId: input.sourceDocumentId,
        newDocumentId: input.newDocumentId,
        err: error,
      })
      try {
        await compensateHiddenCopy(ctx, em, scope, input, failureCleanups)
        const { runAttachmentProviderCleanups } = await import('./attachments')
        await runAttachmentProviderCleanups(failureCleanups)
      } catch (compensationError) {
        // The partial copy stays hidden (deleted_at was never cleared); leave
        // the residue for operations exactly like a failed upload cleanup.
        logger.error('Document duplicate compensation failed; hidden partial copy retained', {
          newDocumentId: input.newDocumentId,
          err: compensationError,
        })
      }
      throw error instanceof CrudHttpError
        ? error
        : new CrudHttpError(500, { error: 'documents.errors.duplicateFailed' })
    }

    try {
      const copiedLinkRows = await findWithDecryption(
        em,
        DocumentEntityLink,
        {
          documentId: input.newDocumentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      const copiedAttachmentRows = await findWithDecryption(
        em,
        DocumentAttachment,
        {
          documentId: input.newDocumentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      const revealedContent = await findOneWithDecryption(
        em,
        DocumentContent,
        { documentId: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { filters: false },
        scope,
      )
      const finalSnapshot: DuplicateSnapshot = {
        documentUpdatedAt: revealedUpdatedAt,
        documentDeletedAt: null,
        contentUpdatedAt: revealedContent?.updatedAt.toISOString() ?? null,
        contentDeletedAt: null,
        linkIds: copiedLinkRows.map((link) => link.id),
        attachmentIds: copiedAttachmentRows.map((attachment) => attachment.id),
      }

      await bufferDocumentMutationSideEffects(ctx, 'created', createdDocument)
      await Promise.all(copiedLinkRows.map((link) => bufferLinkMutationSideEffects(ctx, 'created', link)))

      return {
        id: createdDocument.id,
        updatedAt: revealedUpdatedAt,
        copiedAttachments: attachmentIdMap.size,
        copiedLinks: copiedLinkRows.length,
        droppedLinks: 0,
        after: finalSnapshot,
        projections: [{
          kind: 'event',
          eventId: 'documents.document.duplicated',
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          payload: {
            id: input.newDocumentId,
            sourceDocumentId: input.sourceDocumentId,
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            userId: input.actorUserId,
          },
        }],
      }
    } catch (error) {
      // The copy is committed and visible; report the failure and leave it in
      // place rather than deleting a document the caller successfully created.
      logger.error('Document duplicate failed after the copy became visible; copy retained', {
        sourceDocumentId: input.sourceDocumentId,
        newDocumentId: input.newDocumentId,
        err: error,
      })
      throw error instanceof CrudHttpError
        ? error
        : new CrudHttpError(500, { error: 'documents.errors.duplicateFailed' })
    }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.documentDuplicated', 'Duplicate document'),
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotAfter: result.after,
      payload: {
        undo: { after: result.after } satisfies DuplicateUndoPayload,
        __redoInput: input,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<DuplicateUndoPayload>(logEntry)?.after
    if (!after) return
    const redoInput = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
      ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
      : null
    const input = duplicateDocumentCommandSchema.parse(redoInput)
    const em = resolveDocumentsCommandEntityManager(ctx)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const attachmentService = resolveAttachmentServicePort(ctx.container)
    const cleanups: AttachmentProviderCleanupPort[] = []
    let deletedDocument: Document | null = null
    let deletedLinks: DocumentEntityLink[] = []
    await withAtomicFlush(em, [async () => {
      await lockDocumentAggregateRoot(em, input.newDocumentId, scope)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.create')
      assertCommandFeature(features, 'documents.edit')
      await assertDocumentCommandCapability(ctx, em, input.newDocumentId, scope, 'canDelete')
      const copyDocument = await findOneWithDecryption(
        em,
        Document,
        { id: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { filters: false },
        scope,
      )
      const content = await findOneWithDecryption(
        em,
        DocumentContent,
        { documentId: input.newDocumentId, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { filters: false },
        scope,
      )
      assertDuplicateEntityUnchanged(
        copyDocument,
        { updatedAt: after.documentUpdatedAt, deletedAt: after.documentDeletedAt },
        DOCUMENTS_ENTITY_IDS.document,
        input.newDocumentId,
      )
      assertDuplicateEntityUnchanged(
        content,
        { updatedAt: after.contentUpdatedAt, deletedAt: after.contentDeletedAt },
        DOCUMENTS_ENTITY_IDS.documentContent,
        input.newContentId,
      )
      await assertNoPostCreateDocumentDependents(em, input.newDocumentId, scope, {
        allowedLinkIds: after.linkIds,
        allowedAttachmentIds: after.attachmentIds,
      })

      const attachmentRows = await findWithDecryption(
        em,
        DocumentAttachment,
        {
          documentId: input.newDocumentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      for (const attachmentRow of attachmentRows) {
        const cleanup = await attachmentService.releaseScoped?.({
          attachmentId: attachmentRow.attachmentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          expectedOwner: { entityId: DOCUMENTS_ENTITY_IDS.document, recordId: input.newDocumentId },
          expectedAssignment: { type: DOCUMENTS_ENTITY_IDS.document, id: input.newDocumentId },
          expectedPartitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
        }, { em, flush: false })
        if (cleanup) cleanups.push(cleanup)
        const attachmentVersion = nextDocumentVersion(attachmentRow.updatedAt)
        attachmentRow.deletedAt = attachmentVersion
        attachmentRow.updatedAt = attachmentVersion
      }
      deletedLinks = await findWithDecryption(
        em,
        DocumentEntityLink,
        {
          documentId: input.newDocumentId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      for (const link of deletedLinks) {
        const linkVersion = nextDocumentVersion(link.updatedAt)
        link.deletedAt = linkVersion
        link.updatedAt = linkVersion
      }
      if (content) {
        const contentVersion = nextDocumentVersion(content.updatedAt)
        content.deletedAt = contentVersion
        content.updatedAt = contentVersion
      }
      if (copyDocument) {
        deletedDocument = copyDocument
        const documentVersion = nextDocumentVersion(copyDocument.updatedAt)
        copyDocument.deletedAt = documentVersion
        copyDocument.updatedAt = documentVersion
      }
    }], { transaction: true, label: 'documents.document.duplicate.undo' })
    const { runAttachmentProviderCleanups } = await import('./attachments')
    await runAttachmentProviderCleanups(cleanups)
    for (const link of deletedLinks) {
      await bufferLinkMutationSideEffects(ctx, 'deleted', link, { undo: true })
    }
    if (deletedDocument) {
      await bufferDocumentMutationSideEffects(ctx, 'deleted', deletedDocument, { undo: true })
    }
  },
}

registerCommand(duplicateDocumentCommand)

export { duplicateDocumentCommand }
