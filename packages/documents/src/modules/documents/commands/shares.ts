import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Document, DocumentShare } from '../data/entities'
import {
  documentShareCreateSchema,
  documentSharePermissionSchema,
  documentSharePrincipalTypeSchema,
  documentShareUpdateSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import type { DocumentsProjectionDescriptor } from './projection-types'
import {
  assertDocumentCommandCapability,
  resolveDocumentsCommandActor,
  resolveDocumentsCommandScope,
} from './shared'
import { nextDocumentVersion } from './mutation-helpers'
import { resolveAuthPrincipalService, type DocumentsServiceContainer } from '../lib/platformServices'

const scopeSchema = z.object({
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

const shareStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  principalType: documentSharePrincipalTypeSchema,
  principalId: z.string().uuid(),
  permission: documentSharePermissionSchema,
  createdByUserId: z.string().uuid(),
  deletedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
})

const shareRedoExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), state: shareStateSchema }),
  z.object({ kind: z.literal('soft-deleted-created'), state: shareStateSchema }),
])

const shareCommandBaseSchema = scopeSchema.extend({
  documentId: z.string().uuid(),
  actorUserId: z.string().uuid(),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  redoExpectation: shareRedoExpectationSchema.optional(),
})

export const shareCreateCommandSchema = shareCommandBaseSchema.extend({
  shareId: z.string().uuid(),
  share: documentShareCreateSchema,
})

export const shareUpdateCommandSchema = shareCommandBaseSchema.extend({
  share: documentShareUpdateSchema,
})

export const shareDeleteCommandSchema = shareCommandBaseSchema.extend({
  shareId: z.string().uuid(),
})

export type ShareCreateCommandInput = z.infer<typeof shareCreateCommandSchema>
export type ShareUpdateCommandInput = z.infer<typeof shareUpdateCommandSchema>
export type ShareDeleteCommandInput = z.infer<typeof shareDeleteCommandSchema>
export type ShareState = z.infer<typeof shareStateSchema>
export type ShareRedoExpectation = z.infer<typeof shareRedoExpectationSchema>

export type ShareCommandResult = {
  id: string
  updatedAt: string
  before: ShareState
  after: ShareState
  projections?: DocumentsProjectionDescriptor[]
}

type ShareUndoPayload = {
  before?: ShareState | null
  after?: ShareState | null
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

type ShareStateFallback = Pick<
  ShareState,
  'id' | 'principalType' | 'principalId' | 'permission' | 'createdByUserId'
>

function captureShareState(share: DocumentShare | null, fallback: ShareStateFallback): ShareState {
  return {
    id: share?.id ?? fallback.id,
    existed: share !== null,
    principalType: share?.principalType ?? fallback.principalType,
    principalId: share?.principalId ?? fallback.principalId,
    permission: share?.permission ?? fallback.permission,
    createdByUserId: share?.createdByUserId ?? fallback.createdByUserId,
    deletedAt: share?.deletedAt?.toISOString() ?? null,
    updatedAt: share?.updatedAt?.toISOString() ?? null,
  }
}

function assertActor(input: { actorUserId: string }, ctx: Parameters<CommandHandler['execute']>[1]): void {
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function assertShareMatchesState(
  share: DocumentShare | null,
  expected: ShareState,
  softDeletedCreated = false,
): void {
  if (!share || !expected.existed) throw new CrudHttpError(409, { error: 'Record changed by another user' })
  const scalarsMatch = share.id === expected.id
    && share.principalType === expected.principalType
    && share.principalId === expected.principalId
    && share.permission === expected.permission
    && share.createdByUserId === expected.createdByUserId
  const deletedAt = share.deletedAt?.toISOString() ?? null
  const deletionMatches = softDeletedCreated ? deletedAt !== null : deletedAt === expected.deletedAt
  if (!scalarsMatch || !deletionMatches) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      share.updatedAt.toISOString(),
      expected.updatedAt ?? share.updatedAt.toISOString(),
    ))
  }
}

function assertShareUnchanged(share: DocumentShare | null, expected: ShareState): asserts share is DocumentShare {
  if (!share || !expected.existed || !expected.updatedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
    resourceId: expected.id,
    current: share.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  assertShareMatchesState(share, expected)
}

function assertRedoExpectation(share: DocumentShare | null, expectation: ShareRedoExpectation): void {
  assertShareMatchesState(share, expectation.state, expectation.kind === 'soft-deleted-created')
}

async function loadLockedDocument(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
): Promise<Document> {
  const document = await findOneWithDecryption(
    em,
    Document,
    {
      id: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    { lockMode: LockMode.PESSIMISTIC_WRITE },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (!document) throw new CrudHttpError(404, { error: 'Document not found' })
  return document
}

async function loadShareById(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
  shareId: string,
  lock = false,
): Promise<DocumentShare | null> {
  return findOneWithDecryption(
    em,
    DocumentShare,
    {
      id: shareId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
    },
    {
      filters: false,
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function loadShareByPrincipal(
  em: EntityManager,
  input: ShareCreateCommandInput,
  lock = false,
): Promise<DocumentShare | null> {
  return findOneWithDecryption(
    em,
    DocumentShare,
    {
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      principalType: input.share.principalType,
      principalId: input.share.principalId,
    },
    {
      filters: false,
      orderBy: { updatedAt: 'DESC' },
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function assertPrincipalExists(
  container: DocumentsServiceContainer,
  input: ShareCreateCommandInput,
): Promise<void> {
  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const principal = await resolveAuthPrincipalService(container)?.principalExists({
    type: input.share.principalType,
    id: input.share.principalId,
    scope,
  }) ?? false
  if (!principal) {
    throw new CrudHttpError(400, { error: 'Share principal not found in this organization' })
  }
}

function shareEventProjection(
  eventId: 'documents.document.shared' | 'documents.document.unshared',
  input: { tenantId: string; organizationId: string; documentId: string; actorUserId: string },
  state: ShareState,
  includeActor = true,
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: {
      id: input.documentId,
      shareId: state.id,
      principalType: state.principalType,
      principalId: state.principalId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeActor ? { userId: input.actorUserId } : {}),
    },
  }
}

function projectionAfterUndo(
  input: { tenantId: string; organizationId: string; documentId: string; actorUserId: string },
  before: ShareState,
): DocumentsProjectionDescriptor[] {
  return [shareEventProjection(
    before.existed && before.deletedAt === null
      ? 'documents.document.shared'
      : 'documents.document.unshared',
    input,
    before,
    false,
  )]
}

function restoreShareState(share: DocumentShare, before: ShareState): void {
  const now = nextDocumentVersion(share.updatedAt)
  if (!before.existed) {
    share.deletedAt = now
    share.updatedAt = now
    return
  }
  share.principalType = before.principalType
  share.principalId = before.principalId
  share.permission = before.permission
  share.createdByUserId = before.createdByUserId
  share.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
  share.updatedAt = now
}

function redoExpectationAfterUndo(before: ShareState, after: ShareState): ShareRedoExpectation {
  return before.existed
    ? { kind: 'snapshot', state: before }
    : { kind: 'soft-deleted-created', state: after }
}

function readRedoInput<T>(logEntry: { commandPayload?: unknown }, schema: z.ZodType<T>): T {
  const raw = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
    ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
    : null
  return schema.parse(raw)
}

async function authorizeShareMutation(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string; actorUserId: string },
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canShare')
}

export const createShareCommand: CommandHandler<ShareCreateCommandInput, ShareCommandResult> = {
  id: 'documents.share.create',
  async prepare(rawInput, ctx) {
    const input = shareCreateCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    assertActor(input, ctx)
    await authorizeShareMutation(ctx, em, input)
    await assertPrincipalExists(ctx.container, input)
    return null
  },
  async execute(rawInput, ctx) {
    const input = shareCreateCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    const fallback = {
      id: input.shareId,
      ...input.share,
      createdByUserId: input.actorUserId,
    }
    let share: DocumentShare | null = null
    let before: ShareState | null = null
    let after: ShareState | null = null
    let created = false
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      assertActor(input, ctx)
      await authorizeShareMutation(ctx, em, input)
      await assertPrincipalExists(ctx.container, input)
      share = await loadShareByPrincipal(em, input, true)
      if (share && share.id !== input.shareId) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      if (input.redoExpectation) {
        assertRedoExpectation(share, input.redoExpectation)
      } else if (share) {
        assertOptimisticLock({
          resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
          resourceId: share.id,
          current: share.updatedAt,
          expected: input.expectedUpdatedAt,
        })
      } else if (input.expectedUpdatedAt) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      before = captureShareState(share, fallback)
      if (!share) {
        share = em.create(DocumentShare, {
          id: input.shareId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          principalType: input.share.principalType,
          principalId: input.share.principalId,
          permission: input.share.permission,
          createdByUserId: input.actorUserId,
        })
        created = true
      }
      const now = nextDocumentVersion((share as DocumentShare).updatedAt)
      if (!(share as DocumentShare).id) throw new Error('[internal] share create produced no identity')
      if (!(share as DocumentShare).createdAt) (share as DocumentShare).createdAt = now
      ;(share as DocumentShare).permission = input.share.permission
      ;(share as DocumentShare).deletedAt = null
      ;(share as DocumentShare).updatedAt = now
      if (created) em.persist(share as DocumentShare)
    }, async () => {
      after = captureShareState(share, fallback)
    }], { transaction: true, label: 'documents.share.create' })
    const finalShare = share as DocumentShare | null
    const beforeState = before as ShareState | null
    const afterState = after as ShareState | null
    if (!finalShare || !beforeState || !afterState) throw new Error('[internal] share create produced no row')
    return {
      id: finalShare.id,
      updatedAt: finalShare.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
      projections: [shareEventProjection('documents.document.shared', input, afterState)],
    }
  },
  async buildLog({ input, result }) {
    const before = shareStateSchema.parse(result.before)
    const after = shareStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.shareCreated', 'Grant document access'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: {
          before,
          after,
          projectionsAfterUndo: projectionAfterUndo(input, before),
        } satisfies ShareUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: redoExpectationAfterUndo(before, after),
        } satisfies ShareCreateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<ShareUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, shareCreateCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      await authorizeShareMutation(ctx, em, input)
      const share = await loadShareById(em, input, undo.after!.id, true)
      assertShareUnchanged(share, undo.after!)
      restoreShareState(share, undo.before!)
    }], { transaction: true, label: 'documents.share.create.undo' })
  },
}

export const updateShareCommand: CommandHandler<ShareUpdateCommandInput, ShareCommandResult> = {
  id: 'documents.share.update',
  async prepare(rawInput, ctx) {
    const input = shareUpdateCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    assertActor(input, ctx)
    await authorizeShareMutation(ctx, em, input)
    const share = await loadShareById(em, input, input.share.id)
    if (!share) throw new CrudHttpError(404, { error: 'Share not found' })
    return null
  },
  async execute(rawInput, ctx) {
    const input = shareUpdateCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let share: DocumentShare | null = null
    let before: ShareState | null = null
    let after: ShareState | null = null
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      assertActor(input, ctx)
      await authorizeShareMutation(ctx, em, input)
      share = await loadShareById(em, input, input.share.id, true)
      if (!share || share.deletedAt) throw new CrudHttpError(404, { error: 'Share not found' })
      if (input.redoExpectation) assertRedoExpectation(share, input.redoExpectation)
      else assertOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
        resourceId: share.id,
        current: share.updatedAt,
        expected: input.expectedUpdatedAt,
      })
      before = captureShareState(share, share)
      ;(share as DocumentShare).permission = input.share.permission
      ;(share as DocumentShare).updatedAt = nextDocumentVersion(
        (share as DocumentShare).updatedAt,
      )
    }, async () => {
      after = captureShareState(share, share as DocumentShare)
    }], { transaction: true, label: 'documents.share.update' })
    const finalShare = share as DocumentShare | null
    const beforeState = before as ShareState | null
    const afterState = after as ShareState | null
    if (!finalShare || !beforeState || !afterState) throw new Error('[internal] share update produced no row')
    return {
      id: finalShare.id,
      updatedAt: finalShare.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
      projections: [shareEventProjection('documents.document.shared', input, afterState)],
    }
  },
  async buildLog({ input, result }) {
    const before = shareStateSchema.parse(result.before)
    const after = shareStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.shareUpdated', 'Update document access'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after, projectionsAfterUndo: projectionAfterUndo(input, before) } satisfies ShareUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: { kind: 'snapshot', state: before },
        } satisfies ShareUpdateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<ShareUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, shareUpdateCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      await authorizeShareMutation(ctx, em, input)
      const share = await loadShareById(em, input, undo.after!.id, true)
      assertShareUnchanged(share, undo.after!)
      restoreShareState(share, undo.before!)
    }], { transaction: true, label: 'documents.share.update.undo' })
  },
}

export const deleteShareCommand: CommandHandler<ShareDeleteCommandInput, ShareCommandResult> = {
  id: 'documents.share.delete',
  async prepare(rawInput, ctx) {
    const input = shareDeleteCommandSchema.parse(rawInput)
    const em = ctx.container.resolve('em') as EntityManager
    assertActor(input, ctx)
    await authorizeShareMutation(ctx, em, input)
    const share = await loadShareById(em, input, input.shareId)
    if (!share) throw new CrudHttpError(404, { error: 'Share not found' })
    return null
  },
  async execute(rawInput, ctx) {
    const input = shareDeleteCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let share: DocumentShare | null = null
    let before: ShareState | null = null
    let after: ShareState | null = null
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      assertActor(input, ctx)
      await authorizeShareMutation(ctx, em, input)
      share = await loadShareById(em, input, input.shareId, true)
      if (!share || share.deletedAt) throw new CrudHttpError(404, { error: 'Share not found' })
      if (input.redoExpectation) assertRedoExpectation(share, input.redoExpectation)
      else assertOptimisticLock({
        resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
        resourceId: share.id,
        current: share.updatedAt,
        expected: input.expectedUpdatedAt,
      })
      before = captureShareState(share, share)
      const now = nextDocumentVersion((share as DocumentShare).updatedAt)
      ;(share as DocumentShare).deletedAt = now
      ;(share as DocumentShare).updatedAt = now
    }, async () => {
      after = captureShareState(share, share as DocumentShare)
    }], { transaction: true, label: 'documents.share.delete' })
    const finalShare = share as DocumentShare | null
    const beforeState = before as ShareState | null
    const afterState = after as ShareState | null
    if (!finalShare || !beforeState || !afterState) throw new Error('[internal] share delete produced no row')
    return {
      id: finalShare.id,
      updatedAt: finalShare.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
      projections: [shareEventProjection('documents.document.unshared', input, afterState)],
    }
  },
  async buildLog({ input, result }) {
    const before = shareStateSchema.parse(result.before)
    const after = shareStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.shareDeleted', 'Remove document access'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentShare,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: { before, after, projectionsAfterUndo: projectionAfterUndo(input, before) } satisfies ShareUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: { kind: 'snapshot', state: before },
        } satisfies ShareDeleteCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<ShareUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, shareDeleteCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      await authorizeShareMutation(ctx, em, input)
      const share = await loadShareById(em, input, undo.after!.id, true)
      assertShareUnchanged(share, undo.after!)
      restoreShareState(share, undo.before!)
    }], { transaction: true, label: 'documents.share.delete.undo' })
  },
}

registerCommand(createShareCommand)
registerCommand(updateShareCommand)
registerCommand(deleteShareCommand)
