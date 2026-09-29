import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import {
  registerCommand,
  type CommandHandler,
  type CommandRuntimeContext,
} from '@open-mercato/shared/lib/commands'
import {
  emitCrudSideEffects,
  emitCrudUndoSideEffects,
} from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  findOneWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { Document, DocumentContent, DocumentFolder } from '../data/entities'
import { documentCreateSchema, documentUpdateSchema } from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { advanceDocumentCollaborationGeneration } from '../lib/contentService'
import {
  assertNoPostCreateDocumentDependents,
  loadLockedDocumentContent,
  lockDocumentAggregateRoot,
} from './aggregate'
import {
  assertCommandFeature,
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandEntityManager,
  resolveDocumentsCommandFeatures,
  resolveDocumentsCommandScope,
  type DocumentsCommandScope,
} from './shared'
import {
  assertVersionedSnapshot,
  documentsScopedCommandSchema,
  nextDocumentVersion,
  readCommandRedoInput,
} from './mutation-helpers'
import {
  releaseAllDocumentAttachments,
  runAttachmentProviderCleanups,
} from './attachments'
import type { AttachmentProviderCleanupPort } from '../lib/attachmentServicePort'

const documentStateSnapshotSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  title: z.string(),
  folderId: z.string().uuid().nullable(),
  ownerUserId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
})

const documentContentStateSnapshotSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
})

const documentUpdateRedoExpectationSchema = z.object({
  kind: z.literal('document-update-post-undo'),
  document: documentStateSnapshotSchema,
})

export const documentCreateCommandSchema = documentsScopedCommandSchema
  .merge(documentCreateSchema)
  .extend({
    documentId: z.string().uuid(),
    contentId: z.string().uuid(),
  })

export const documentUpdateCommandSchema = documentsScopedCommandSchema
  .merge(documentUpdateSchema)
  .extend({ redoExpectation: documentUpdateRedoExpectationSchema.optional() })

export const documentDeleteCommandSchema = documentsScopedCommandSchema.extend({
  id: z.string().uuid(),
})

export type DocumentCreateCommandInput = z.infer<typeof documentCreateCommandSchema>
export type DocumentUpdateCommandInput = z.infer<typeof documentUpdateCommandSchema>
export type DocumentDeleteCommandInput = z.infer<typeof documentDeleteCommandSchema>

type DocumentStateSnapshot = z.infer<typeof documentStateSnapshotSchema>
type DocumentContentStateSnapshot = z.infer<typeof documentContentStateSnapshotSchema>

type DocumentMutationSnapshot = {
  document: DocumentStateSnapshot | null
  content: DocumentContentStateSnapshot | null
}

type DocumentMutationUndoPayload = {
  before?: DocumentMutationSnapshot | null
  after?: DocumentMutationSnapshot | null
}

type DocumentCommandResult = {
  id: string
  updatedAt: string
  before: DocumentMutationSnapshot
  after: DocumentMutationSnapshot
}

function snapshotDocument(document: Document | null): DocumentStateSnapshot | null {
  if (!document) return null
  return {
    id: document.id,
    tenantId: document.tenantId,
    organizationId: document.organizationId,
    title: document.title,
    folderId: document.folderId ?? null,
    ownerUserId: document.ownerUserId,
    createdByUserId: document.createdByUserId,
    isActive: document.isActive,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
    deletedAt: document.deletedAt?.toISOString() ?? null,
  }
}

function snapshotContent(content: DocumentContent | null): DocumentContentStateSnapshot | null {
  if (!content) return null
  return {
    id: content.id,
    documentId: content.documentId,
    updatedAt: content.updatedAt.toISOString(),
    deletedAt: content.deletedAt?.toISOString() ?? null,
  }
}

function mutationSnapshot(
  document: Document | null,
  content: DocumentContent | null,
): DocumentMutationSnapshot {
  return { document: snapshotDocument(document), content: snapshotContent(content) }
}

function changedError(): CrudHttpError {
  return new CrudHttpError(409, { error: 'Record changed by another user' })
}

function nextSnapshotVersion(updatedAt: string): string {
  return nextDocumentVersion(new Date(updatedAt), new Date(0)).toISOString()
}

function assertDocumentStateMatches(
  document: Document,
  expected: DocumentStateSnapshot,
): void {
  if (!isDeepStrictEqual(snapshotDocument(document), expected)) throw changedError()
}

function resolveExactUndoVersion(current: Date, expectedUpdatedAt?: string): Date {
  if (!expectedUpdatedAt) return nextDocumentVersion(current)
  const expected = new Date(expectedUpdatedAt)
  if (!Number.isFinite(expected.getTime()) || expected.getTime() <= current.getTime()) {
    throw changedError()
  }
  return expected
}

function buildUpdateRedoExpectation(
  before: DocumentMutationSnapshot,
  after: DocumentMutationSnapshot,
): z.infer<typeof documentUpdateRedoExpectationSchema> {
  if (!before.document || !after.document) {
    throw new Error('[internal] document update redo expectation requires document snapshots')
  }
  return {
    kind: 'document-update-post-undo',
    document: {
      ...before.document,
      updatedAt: nextSnapshotVersion(after.document.updatedAt),
    },
  }
}

async function loadExistingDocumentForCreate(
  em: EntityManager,
  input: DocumentCreateCommandInput,
): Promise<{ document: Document | null; content: DocumentContent | null }> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const document = await findOneWithDecryption(
    em,
    Document,
    { id: input.documentId, ...scope },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  const content = await findOneWithDecryption(
    em,
    DocumentContent,
    { documentId: input.documentId, ...scope },
    { filters: false, lockMode: LockMode.PESSIMISTIC_WRITE },
    scope,
  )
  return { document, content }
}

async function assertWritableFolder(
  em: EntityManager,
  scope: DocumentsCommandScope,
  folderId: string | null | undefined,
  actorUserId: string,
  features: readonly string[],
): Promise<void> {
  if (!folderId) return
  const folder = await findOneWithDecryption(
    em,
    DocumentFolder,
    { id: folderId, ...scope, deletedAt: null },
    { lockMode: LockMode.PESSIMISTIC_READ },
    scope,
  )
  if (!folder) throw new CrudHttpError(404, { error: 'documents.folders.notFound' })
  if (folder.ownerUserId !== actorUserId) assertCommandFeature(features, 'documents.manage')
}

function restoreDocumentFields(
  document: Document,
  snapshot: DocumentStateSnapshot,
  expectedUpdatedAt?: string,
): void {
  document.title = snapshot.title
  document.folderId = snapshot.folderId
  document.ownerUserId = snapshot.ownerUserId
  document.createdByUserId = snapshot.createdByUserId
  document.isActive = snapshot.isActive
  document.deletedAt = snapshot.deletedAt ? new Date(snapshot.deletedAt) : null
  document.updatedAt = resolveExactUndoVersion(document.updatedAt, expectedUpdatedAt)
}

function restoreContentState(
  content: DocumentContent,
  snapshot: DocumentContentStateSnapshot | null,
): void {
  content.deletedAt = snapshot?.deletedAt ? new Date(snapshot.deletedAt) : new Date()
  content.updatedAt = nextDocumentVersion(content.updatedAt)
}

async function authorizeSnapshotOwnerAction(
  ctx: CommandRuntimeContext,
  scope: DocumentsCommandScope,
  snapshot: DocumentStateSnapshot,
  feature: string,
): Promise<{ actorUserId: string; features: string[] }> {
  const features = await resolveDocumentsCommandFeatures(ctx, scope)
  assertCommandFeature(features, feature)
  const actorUserId = resolveDocumentsCommandActor(ctx)
  if (snapshot.ownerUserId !== actorUserId && !hasAllFeatures(['documents.manage'], features)) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
  return { actorUserId, features }
}

async function bufferDocumentSideEffect(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  document: Document,
): Promise<void> {
  const actorUserId = resolveDocumentsCommandActor(ctx)
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: document,
    identifiers: {
      id: document.id,
      tenantId: document.tenantId,
      organizationId: document.organizationId,
    },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.document },
    events: {
      module: 'documents',
      entity: 'document',
      buildPayload: () => ({
        id: document.id,
        tenantId: document.tenantId,
        organizationId: document.organizationId,
        userId: actorUserId,
      }),
    },
  })
}

async function bufferDocumentUndoSideEffect(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  document: Document,
): Promise<void> {
  const actorUserId = resolveDocumentsCommandActor(ctx)
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: document,
    identifiers: {
      id: document.id,
      tenantId: document.tenantId,
      organizationId: document.organizationId,
    },
    indexer: { entityType: DOCUMENTS_ENTITY_IDS.document },
    events: {
      module: 'documents',
      entity: 'document',
      buildPayload: () => ({
        id: document.id,
        tenantId: document.tenantId,
        organizationId: document.organizationId,
        userId: actorUserId,
      }),
    },
  })
}

function documentLogPayload(
  before: DocumentMutationSnapshot,
  after: DocumentMutationSnapshot,
): DocumentMutationUndoPayload {
  return { before, after }
}

const createDocumentCommand: CommandHandler<DocumentCreateCommandInput, DocumentCommandResult> = {
  id: 'documents.document.create',
  async execute(rawInput, ctx) {
    const input = documentCreateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let document!: Document
    let content!: DocumentContent
    let before!: DocumentMutationSnapshot

    await withAtomicFlush(em, [async () => {
      const existing = await loadExistingDocumentForCreate(em, input)
      const features = await resolveDocumentsCommandFeatures(ctx, scope)
      assertCommandFeature(features, 'documents.create')
      before = mutationSnapshot(existing.document, existing.content)
      if (existing.document && !existing.document.deletedAt) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      if (existing.content && !existing.content.deletedAt) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      await assertWritableFolder(em, scope, input.folderId, actorUserId, features)
      document = existing.document ?? em.create(Document, {
        id: input.documentId,
        ...scope,
        title: input.title,
        folderId: input.folderId ?? null,
        ownerUserId: actorUserId,
        createdByUserId: actorUserId,
        isActive: true,
      })
      if (!existing.document) em.persist(document)
      document.title = input.title
      document.folderId = input.folderId ?? null
      document.ownerUserId = actorUserId
      document.createdByUserId = actorUserId
      document.isActive = true
      document.deletedAt = null
      if (existing.document) document.updatedAt = nextDocumentVersion(document.updatedAt)

      content = existing.content ?? em.create(DocumentContent, {
        id: input.contentId,
        ...scope,
        documentId: input.documentId,
        contentHtml: '',
        contentText: '',
        collaborationGeneration: 1,
      })
      if (!existing.content) em.persist(content)
      content.deletedAt = null
      if (existing.content) {
        advanceDocumentCollaborationGeneration(content)
        content.updatedAt = nextDocumentVersion(content.updatedAt)
      }
    }], { transaction: true, label: 'documents.document.create' })

    const after = mutationSnapshot(document, content)
    await bufferDocumentSideEffect(ctx, 'created', document)
    return { id: document.id, updatedAt: document.updatedAt.toISOString(), before, after }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.documentCreated', 'Create document'),
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: { undo: documentLogPayload(result.before, result.after) },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<DocumentMutationUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before || !after?.document) return
    const input = documentCreateCommandSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let document!: Document
    await withAtomicFlush(em, [async () => {
      document = await lockDocumentAggregateRoot(em, input.documentId, scope, { includeDeleted: true })
      const authorization = await authorizeSnapshotOwnerAction(
        ctx,
        scope,
        after.document!,
        'documents.create',
      )
      // Undoing create soft-deletes the aggregate. Preserve the original
      // command grant and also enforce the action feature for that inverse
      // mutation so the audit-log endpoint cannot become a delete bypass.
      assertCommandFeature(authorization.features, 'documents.delete')
      const content = await loadLockedDocumentContent(em, input.documentId, scope, { includeDeleted: true })
      assertVersionedSnapshot(document, after.document, DOCUMENTS_ENTITY_IDS.document)
      if (after.content) assertVersionedSnapshot(content, after.content, DOCUMENTS_ENTITY_IDS.documentContent)
      await assertNoPostCreateDocumentDependents(em, input.documentId, scope)
      if (before.document) restoreDocumentFields(document, before.document)
      else {
        document.deletedAt = new Date()
        document.isActive = false
        document.updatedAt = nextDocumentVersion(document.updatedAt)
      }
      if (content) restoreContentState(content, before.content)
      if (content) {
        advanceDocumentCollaborationGeneration(content)
      }
    }], { transaction: true, label: 'documents.document.create.undo' })
    await bufferDocumentUndoSideEffect(ctx, 'deleted', document)
  },
}

const updateDocumentCommand: CommandHandler<DocumentUpdateCommandInput, DocumentCommandResult> = {
  id: 'documents.document.update',
  async execute(rawInput, ctx) {
    const input = documentUpdateCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    const actorUserId = resolveDocumentsCommandActor(ctx)
    let document!: Document
    let content: DocumentContent | null = null
    let before!: DocumentMutationSnapshot
    await withAtomicFlush(em, [async () => {
      document = await lockDocumentAggregateRoot(
        em,
        input.id,
        scope,
        { includeDeleted: input.redoExpectation !== undefined },
      )
      const features = await assertDocumentCommandCapability(ctx, em, input.id, scope, 'canEdit')
      if (input.redoExpectation) {
        assertDocumentStateMatches(document, input.redoExpectation.document)
      }
      if (!input.redoExpectation) {
        await enforceCommandOptimisticLockWithGuards(ctx.container, {
          resourceKind: DOCUMENTS_ENTITY_IDS.document,
          resourceId: input.id,
          current: document.updatedAt,
          request: ctx.request ?? null,
        })
      }
      content = await loadLockedDocumentContent(em, input.id, scope)
      before = mutationSnapshot(document, content)
      if (Object.prototype.hasOwnProperty.call(input, 'folderId')) {
        await assertWritableFolder(em, scope, input.folderId, actorUserId, features)
      }
      if (input.title !== undefined) document.title = input.title
      if (Object.prototype.hasOwnProperty.call(input, 'folderId')) document.folderId = input.folderId ?? null
      document.updatedAt = nextDocumentVersion(document.updatedAt)
    }], { transaction: true, label: 'documents.document.update' })
    const after = mutationSnapshot(document, content)
    await bufferDocumentSideEffect(ctx, 'updated', document)
    return { id: document.id, updatedAt: document.updatedAt.toISOString(), before, after }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    const redoExpectation = buildUpdateRedoExpectation(result.before, result.after)
    return {
      actionLabel: translate('documents.audit.documentUpdated', 'Update document'),
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
      payload: {
        undo: documentLogPayload(result.before, result.after),
        __redoInput: {
          ...input,
          redoExpectation,
        } satisfies DocumentUpdateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<DocumentMutationUndoPayload>(logEntry)
    const before = undo?.before
    const after = undo?.after
    if (!before?.document || !after?.document) return
    const input = documentUpdateCommandSchema.parse(readCommandRedoInput(logEntry))
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let document!: Document
    await withAtomicFlush(em, [async () => {
      document = await lockDocumentAggregateRoot(em, input.id, scope)
      const features = await assertDocumentCommandCapability(ctx, em, input.id, scope, 'canEdit')
      assertVersionedSnapshot(document, after.document, DOCUMENTS_ENTITY_IDS.document)
      await assertWritableFolder(
        em,
        scope,
        before.document!.folderId,
        resolveDocumentsCommandActor(ctx),
        features,
      )
      restoreDocumentFields(
        document,
        before.document!,
        input.redoExpectation?.document.updatedAt,
      )
    }], { transaction: true, label: 'documents.document.update.undo' })
    await bufferDocumentUndoSideEffect(ctx, 'updated', document)
  },
}

const deleteDocumentCommand: CommandHandler<DocumentDeleteCommandInput, DocumentCommandResult> = {
  id: 'documents.document.delete',
  // Non-undoable by design: restoring a document would also have to revive its
  // shares, comments, versions, links, and attachments as a consistent set,
  // and re-open the collaboration room at the right generation. Recovery is
  // via version restore on a re-created document, not command undo.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const input = documentDeleteCommandSchema.parse(rawInput)
    const scope = resolveDocumentsCommandScope(ctx, input)
    const em = resolveDocumentsCommandEntityManager(ctx)
    let document!: Document
    let content: DocumentContent | null = null
    let before!: DocumentMutationSnapshot
    let attachmentCleanups: AttachmentProviderCleanupPort[] = []
    await withAtomicFlush(em, [async () => {
      document = await lockDocumentAggregateRoot(em, input.id, scope)
      await assertDocumentCommandCapability(ctx, em, input.id, scope, 'canDelete')
      await enforceCommandOptimisticLockWithGuards(ctx.container, {
        resourceKind: DOCUMENTS_ENTITY_IDS.document,
        resourceId: input.id,
        current: document.updatedAt,
        request: ctx.request ?? null,
      })
      content = await loadLockedDocumentContent(em, input.id, scope)
      before = mutationSnapshot(document, content)
      attachmentCleanups = await releaseAllDocumentAttachments(ctx, em, scope, input.id)
      const now = nextDocumentVersion(document.updatedAt)
      document.deletedAt = now
      document.updatedAt = now
      document.isActive = false
      if (content) {
        const contentNow = nextDocumentVersion(content.updatedAt, now)
        advanceDocumentCollaborationGeneration(content)
        content.deletedAt = contentNow
        content.updatedAt = contentNow
      }
    }], { transaction: true, label: 'documents.document.delete' })
    await runAttachmentProviderCleanups(attachmentCleanups)
    const after = mutationSnapshot(document, content)
    await bufferDocumentSideEffect(ctx, 'deleted', document)
    return { id: document.id, updatedAt: document.updatedAt.toISOString(), before, after }
  },
  async buildLog({ input, result }) {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.documentDeleted', 'Delete document'),
      resourceKind: DOCUMENTS_ENTITY_IDS.document,
      resourceId: result.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: result.before,
      snapshotAfter: result.after,
    }
  },
}

registerCommand(createDocumentCommand)
registerCommand(updateDocumentCommand)
registerCommand(deleteDocumentCommand)

export {
  createDocumentCommand,
  updateDocumentCommand,
  deleteDocumentCommand,
}
