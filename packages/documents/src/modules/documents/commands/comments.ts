import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Document, DocumentComment, DocumentShare } from '../data/entities'
import {
  documentCommentCreateSchema,
  documentSharePermissionSchema,
} from '../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../lib/constants'
import { assertDocumentCommentCapacity } from '../lib/historyLimits'
import { resolveUserAccess } from '../lib/permissions'
import { resolveWatcherRecipients } from '../lib/watchers'
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

const commentStateSchema = z.object({
  id: z.string().uuid(),
  existed: z.boolean(),
  parentCommentId: z.string().uuid().nullable(),
  authorUserId: z.string().uuid(),
  body: z.string(),
  // Snapshots must remain permissive for legacy anchors. New command input is
  // still validated by documentCommentCreateSchema's strict write union.
  anchor: z.record(z.string(), z.unknown()).nullable(),
  mentions: z.array(z.object({ userId: z.string().uuid() })).nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
  deletedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
})

const mentionShareStateSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  existed: z.boolean(),
  permission: documentSharePermissionSchema,
  createdByUserId: z.string().uuid(),
  deletedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime().nullable(),
})

const commentRedoExpectationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('snapshot'), state: commentStateSchema }),
  z.object({ kind: z.literal('soft-deleted-created'), state: commentStateSchema }),
])

const commentCommandBaseSchema = scopeSchema.extend({
  documentId: z.string().uuid(),
  actorUserId: z.string().uuid(),
})

export const commentCreateCommandSchema = commentCommandBaseSchema.extend({
  commentId: z.string().uuid(),
  comment: documentCommentCreateSchema,
  grantShares: z.array(z.object({ userId: z.string().uuid(), shareId: z.string().uuid() })).max(50),
  redoExpectation: commentRedoExpectationSchema.optional(),
}).superRefine((input, context) => {
  const grantIds = Array.from(new Set((input.comment.grantAccessTo ?? []).map((id) => id.toLowerCase())))
  const identities = Array.from(new Set(input.grantShares.map((grant) => grant.userId.toLowerCase())))
  if (grantIds.length !== identities.length || grantIds.some((id) => !identities.includes(id))) {
    context.addIssue({ code: 'custom', message: 'documents.comments.grantIdentityMismatch' })
  }
})

export const commentResolveCommandSchema = commentCommandBaseSchema.extend({
  comment: z.object({ id: z.string().uuid(), resolved: z.boolean() }),
  expectedUpdatedAt: z.string().datetime().nullable().optional(),
  redoExpectation: commentRedoExpectationSchema.optional(),
})

export type CommentCreateCommandInput = z.infer<typeof commentCreateCommandSchema>
export type CommentResolveCommandInput = z.infer<typeof commentResolveCommandSchema>
export type CommentState = z.infer<typeof commentStateSchema>
export type MentionShareState = z.infer<typeof mentionShareStateSchema>

export type CommentCreateCommandResult = {
  id: string
  updatedAt: string
  projections?: DocumentsProjectionDescriptor[]
  undo: CommentCreateUndoPayload
}

export type CommentResolveCommandResult = {
  id: string
  resolvedAt: string | null
  resolvedByUserId: string | null
  updatedAt: string
  before: CommentState
  after: CommentState
  projections?: DocumentsProjectionDescriptor[]
}

type MentionShareMutation = {
  before: MentionShareState
  after: MentionShareState
}

type PendingMentionShareMutation = {
  before: MentionShareState
  share: DocumentShare
  fallback: { shareId: string; userId: string; actorUserId: string }
}

type CommentCreateUndoPayload = {
  before?: CommentState | null
  after?: CommentState | null
  shareMutations: MentionShareMutation[]
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

type CommentResolveUndoPayload = {
  before?: CommentState | null
  after?: CommentState | null
  projectionsAfterUndo?: DocumentsProjectionDescriptor[]
}

function extractMentionedUserIds(body: string): string[] {
  const pattern = /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi
  return Array.from(new Set(
    Array.from(body.matchAll(pattern))
      .map((match) => match[1])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase()),
  ))
}

function dedupeUserIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.toLowerCase())))
}

function commentFallback(input: CommentCreateCommandInput): Omit<CommentState, 'existed' | 'deletedAt' | 'updatedAt'> {
  const mentionUserIds = dedupeUserIds([
    ...(input.comment.mentions ?? []).map((mention) => mention.userId),
    ...extractMentionedUserIds(input.comment.body),
  ])
  return {
    id: input.commentId,
    parentCommentId: input.comment.parentCommentId ?? null,
    authorUserId: input.actorUserId,
    body: input.comment.body,
    anchor: input.comment.anchor ?? null,
    mentions: mentionUserIds.length ? mentionUserIds.map((userId) => ({ userId })) : null,
    resolvedAt: null,
    resolvedByUserId: null,
  }
}

function captureCommentState(
  comment: DocumentComment | null,
  fallback: Omit<CommentState, 'existed' | 'deletedAt' | 'updatedAt'>,
): CommentState {
  return {
    id: comment?.id ?? fallback.id,
    existed: comment !== null,
    parentCommentId: comment?.parentCommentId ?? fallback.parentCommentId,
    authorUserId: comment?.authorUserId ?? fallback.authorUserId,
    body: comment?.body ?? fallback.body,
    anchor: (comment?.anchor ?? fallback.anchor) as CommentState['anchor'],
    mentions: comment?.mentions ?? fallback.mentions,
    resolvedAt: comment?.resolvedAt?.toISOString() ?? fallback.resolvedAt,
    resolvedByUserId: comment?.resolvedByUserId ?? fallback.resolvedByUserId,
    deletedAt: comment?.deletedAt?.toISOString() ?? null,
    updatedAt: comment?.updatedAt?.toISOString() ?? null,
  }
}

function captureMentionShareState(
  share: DocumentShare | null,
  fallback: { shareId: string; userId: string; actorUserId: string },
): MentionShareState {
  return {
    id: share?.id ?? fallback.shareId,
    userId: share?.principalId ?? fallback.userId,
    existed: share !== null,
    permission: share?.permission ?? 'commenter',
    createdByUserId: share?.createdByUserId ?? fallback.actorUserId,
    deletedAt: share?.deletedAt?.toISOString() ?? null,
    updatedAt: share?.updatedAt?.toISOString() ?? null,
  }
}

function assertActor(input: { actorUserId: string }, ctx: Parameters<CommandHandler['execute']>[1]): void {
  if (resolveDocumentsCommandActor(ctx) !== input.actorUserId) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
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

async function loadComment(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
  commentId: string,
  lock = false,
): Promise<DocumentComment | null> {
  return findOneWithDecryption(
    em,
    DocumentComment,
    {
      id: commentId,
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

async function assertNoActiveReplies(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
  commentId: string,
): Promise<void> {
  const replies = await findWithDecryption(
    em,
    DocumentComment,
    {
      documentId: input.documentId,
      parentCommentId: commentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      deletedAt: null,
    },
    { limit: 1 },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
  if (replies.length > 0) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}

async function loadMentionShare(
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
  userId: string,
  lock = false,
): Promise<DocumentShare | null> {
  return findOneWithDecryption(
    em,
    DocumentShare,
    {
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      principalType: 'user',
      principalId: userId,
    },
    {
      filters: false,
      orderBy: { updatedAt: 'DESC' },
      ...(lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : {}),
    },
    { tenantId: input.tenantId, organizationId: input.organizationId },
  )
}

async function assertUserPrincipal(
  container: DocumentsServiceContainer,
  input: { tenantId: string; organizationId: string },
  userId: string,
): Promise<void> {
  const exists = await resolveAuthPrincipalService(container)?.principalExists({
    type: 'user',
    id: userId,
    scope: { tenantId: input.tenantId, organizationId: input.organizationId },
  }) ?? false
  if (!exists) throw new CrudHttpError(400, { error: 'Share principal not found in this organization' })
}

async function hasDocumentCapability(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: { tenantId: string; organizationId: string; documentId: string },
  capability: 'canComment' | 'canShare',
): Promise<boolean> {
  try {
    await assertDocumentCommandCapability(
      ctx,
      em,
      input.documentId,
      resolveDocumentsCommandScope(ctx, input),
      capability,
    )
    return true
  } catch (error) {
    if (isCrudHttpError(error) && error.status === 403) return false
    throw error
  }
}

async function assertCanCreateComment(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: CommentCreateCommandInput,
): Promise<void> {
  resolveDocumentsCommandScope(ctx, input)
  if (!(await hasDocumentCapability(ctx, em, input, 'canComment'))) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

async function assertCanMutateMentionShares(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: CommentCreateCommandInput,
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canShare')
}

async function assertCanResolveComment(
  ctx: Parameters<CommandHandler['execute']>[1],
  em: EntityManager,
  input: CommentResolveCommandInput,
  comment: DocumentComment,
): Promise<void> {
  const scope = resolveDocumentsCommandScope(ctx, input)
  await assertDocumentCommandCapability(ctx, em, input.documentId, scope, 'canView')
  if (comment.authorUserId === resolveDocumentsCommandActor(ctx)) return
  if (!(await hasDocumentCapability(ctx, em, input, 'canComment'))) {
    throw new CrudHttpError(403, { error: 'Forbidden' })
  }
}

function assertCommentMatchesState(
  comment: DocumentComment | null,
  expected: CommentState,
  softDeletedCreated = false,
): void {
  if (!comment || !expected.existed) throw new CrudHttpError(409, { error: 'Record changed by another user' })
  const scalarsMatch = comment.id === expected.id
    && (comment.parentCommentId ?? null) === expected.parentCommentId
    && comment.authorUserId === expected.authorUserId
    && comment.body === expected.body
    && JSON.stringify(comment.anchor ?? null) === JSON.stringify(expected.anchor)
    && JSON.stringify(comment.mentions ?? null) === JSON.stringify(expected.mentions)
    && (comment.resolvedAt?.toISOString() ?? null) === expected.resolvedAt
    && (comment.resolvedByUserId ?? null) === expected.resolvedByUserId
  const deletedAt = comment.deletedAt?.toISOString() ?? null
  const deletionMatches = softDeletedCreated ? deletedAt !== null : deletedAt === expected.deletedAt
  if (!scalarsMatch || !deletionMatches) {
    throw new CrudHttpError(409, buildOptimisticLockConflictBody(
      comment.updatedAt.toISOString(),
      expected.updatedAt ?? comment.updatedAt.toISOString(),
    ))
  }
}

function assertCommentUnchanged(
  comment: DocumentComment | null,
  expected: CommentState,
): asserts comment is DocumentComment {
  if (!comment || !expected.existed || !expected.updatedAt) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
  assertOptimisticLock({
    resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
    resourceId: expected.id,
    current: comment.updatedAt,
    expected: expected.updatedAt,
    envValue: 'all',
  })
  assertCommentMatchesState(comment, expected)
}

function assertMentionShareUnchanged(share: DocumentShare | null, expected: MentionShareState): asserts share is DocumentShare {
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
  if (
    share.id !== expected.id
    || share.principalType !== 'user'
    || share.principalId !== expected.userId
    || share.permission !== expected.permission
    || share.createdByUserId !== expected.createdByUserId
    || (share.deletedAt?.toISOString() ?? null) !== expected.deletedAt
  ) {
    throw new CrudHttpError(409, { error: 'Record changed by another user' })
  }
}

function restoreCommentState(comment: DocumentComment, before: CommentState): void {
  const now = nextDocumentVersion(comment.updatedAt)
  if (!before.existed) {
    comment.deletedAt = now
    comment.updatedAt = now
    return
  }
  comment.parentCommentId = before.parentCommentId
  comment.authorUserId = before.authorUserId
  comment.body = before.body
  comment.anchor = before.anchor
  comment.mentions = before.mentions
  comment.resolvedAt = before.resolvedAt ? new Date(before.resolvedAt) : null
  comment.resolvedByUserId = before.resolvedByUserId
  comment.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
  comment.updatedAt = now
}

function restoreMentionShareState(share: DocumentShare, before: MentionShareState): void {
  const now = nextDocumentVersion(share.updatedAt)
  if (!before.existed) {
    share.deletedAt = now
    share.updatedAt = now
    return
  }
  share.permission = before.permission
  share.createdByUserId = before.createdByUserId
  share.deletedAt = before.deletedAt ? new Date(before.deletedAt) : null
  share.updatedAt = now
}

function shareProjection(
  eventId: 'documents.document.shared' | 'documents.document.unshared',
  input: CommentCreateCommandInput,
  state: MentionShareState,
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
      principalType: 'user',
      principalId: state.userId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeActor ? { userId: input.actorUserId } : {}),
    },
  }
}

function resolutionProjection(
  input: CommentResolveCommandInput,
  state: CommentState,
  includeActor = true,
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId: 'documents.comment.resolved',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: {
      id: state.id,
      documentId: input.documentId,
      resolved: state.resolvedAt !== null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      ...(includeActor ? { userId: input.actorUserId } : {}),
    },
  }
}

function mentionProjections(
  input: CommentCreateCommandInput,
  document: Document,
  mentionedUserIds: string[],
): DocumentsProjectionDescriptor[] {
  return mentionedUserIds.flatMap((recipientUserId): DocumentsProjectionDescriptor[] => [
    {
      kind: 'event',
      eventId: 'documents.comment.mentioned',
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: {
        id: input.commentId,
        documentId: input.documentId,
        mentionedUserId: recipientUserId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        userId: input.actorUserId,
      },
    },
    {
      kind: 'mention-notification',
      recipientUserId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      documentId: input.documentId,
      documentTitle: document.title,
      commentId: input.commentId,
      authorUserId: input.actorUserId,
    },
  ])
}

function watchCommentProjections(
  input: { tenantId: string; organizationId: string; documentId: string; commentId: string },
  documentTitle: string,
  recipientUserIds: readonly string[],
  bodyKey: string,
): DocumentsProjectionDescriptor[] {
  return recipientUserIds.map((recipientUserId) => ({
    kind: 'watch-notification',
    recipientUserId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    documentId: input.documentId,
    documentTitle,
    notificationType: 'documents.watch.commented',
    bodyKey,
    sourceEntityType: DOCUMENTS_ENTITY_IDS.documentComment,
    sourceEntityId: input.commentId,
    linkHref: `/backend/documents/${encodeURIComponent(input.documentId)}?commentId=${encodeURIComponent(input.commentId)}`,
  }))
}

function commentCreatedProjection(
  input: CommentCreateCommandInput,
): DocumentsProjectionDescriptor {
  return {
    kind: 'event',
    eventId: 'documents.comment.created',
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    payload: {
      id: input.commentId,
      documentId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      userId: input.actorUserId,
    },
  }
}

function readRedoInput<T>(logEntry: { commandPayload?: unknown }, schema: z.ZodType<T>): T {
  const raw = logEntry.commandPayload && typeof logEntry.commandPayload === 'object'
    ? (logEntry.commandPayload as { __redoInput?: unknown }).__redoInput
    : null
  return schema.parse(raw)
}

export const createCommentCommand: CommandHandler<CommentCreateCommandInput, CommentCreateCommandResult> = {
  id: 'documents.comment.create',
  async prepare(rawInput, ctx) {
    const input = commentCreateCommandSchema.parse(rawInput)
    assertActor(input, ctx)
    const em = ctx.container.resolve('em') as EntityManager
    await assertCanCreateComment(ctx, em, input)
    return null
  },
  async execute(rawInput, ctx) {
    const input = commentCreateCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    const fallback = commentFallback(input)
    const mentionUserIds = fallback.mentions?.map((mention) => mention.userId) ?? []
    const grantIdentityByUserId = new Map(input.grantShares.map((grant) => [grant.userId.toLowerCase(), grant]))
    const shareMutations: MentionShareMutation[] = []
    const pendingShareMutations: PendingMentionShareMutation[] = []
    const notifyMentionedIds: string[] = []
    let document: Document | null = null
    let comment: DocumentComment | null = null
    let before: CommentState | null = null
    let after: CommentState | null = null
    await withAtomicFlush(em, [async () => {
      document = await loadLockedDocument(em, input)
      assertActor(input, ctx)
      await assertCanCreateComment(ctx, em, input)
      comment = await loadComment(em, input, input.commentId, true)
      if (input.redoExpectation) {
        assertCommentMatchesState(
          comment,
          input.redoExpectation.state,
          input.redoExpectation.kind === 'soft-deleted-created',
        )
      } else if (comment) {
        throw new CrudHttpError(409, { error: 'Record changed by another user' })
      }
      before = captureCommentState(comment, fallback)
      if (fallback.parentCommentId) {
        const parent = await loadComment(em, input, fallback.parentCommentId, true)
        if (!parent || parent.deletedAt) throw new CrudHttpError(404, { error: 'Comment not found' })
      }
      await assertDocumentCommentCapacity(em, input)

      const canShare = await hasDocumentCapability(ctx, em, input, 'canShare')
      // An explicit grant request from an actor without the share capability
      // must fail loudly instead of returning 201 with the grants silently
      // dropped. Redo replays are exempt: their grants either already exist
      // (mentioned users resolve a tier below) or were legitimately created
      // by the original execution.
      if (input.grantShares.length > 0 && !canShare && !input.redoExpectation) {
        throw new CrudHttpError(403, { error: 'Forbidden' })
      }
      for (const mentionedUserId of mentionUserIds) {
        const grantIdentity = grantIdentityByUserId.get(mentionedUserId)
        if (!grantIdentity || !canShare) continue
        const tier = await resolveUserAccess(em, input.documentId, input, mentionedUserId, ctx.container)
        if (tier) continue
        await assertUserPrincipal(ctx.container, input, mentionedUserId)
        let share = await loadMentionShare(em, input, mentionedUserId, true)
        const shareFallback = {
          shareId: share?.id ?? grantIdentity.shareId,
          userId: mentionedUserId,
          actorUserId: input.actorUserId,
        }
        const shareBefore = captureMentionShareState(share, shareFallback)
        const created = !share
        share = share ?? em.create(DocumentShare, {
          id: grantIdentity.shareId,
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          documentId: input.documentId,
          principalType: 'user',
          principalId: mentionedUserId,
          permission: 'commenter',
          createdByUserId: input.actorUserId,
        })
        share.permission = 'commenter'
        share.deletedAt = null
        share.updatedAt = nextDocumentVersion(share.updatedAt)
        if (created) em.persist(share)
        pendingShareMutations.push({ before: shareBefore, share, fallback: shareFallback })
      }

      const created = !comment
      comment = comment ?? em.create(DocumentComment, {
        id: input.commentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        documentId: input.documentId,
        parentCommentId: fallback.parentCommentId,
        authorUserId: fallback.authorUserId,
        body: fallback.body,
        anchor: fallback.anchor,
        mentions: fallback.mentions,
      })
      comment.parentCommentId = fallback.parentCommentId
      comment.authorUserId = fallback.authorUserId
      comment.body = fallback.body
      comment.anchor = fallback.anchor
      comment.mentions = fallback.mentions
      comment.resolvedAt = null
      comment.resolvedByUserId = null
      comment.deletedAt = null
      comment.updatedAt = nextDocumentVersion(comment.updatedAt)
      if (created) em.persist(comment)
    }, async () => {
      after = captureCommentState(comment, fallback)
      for (const mutation of pendingShareMutations) {
        shareMutations.push({
          before: mutation.before,
          after: captureMentionShareState(mutation.share, mutation.fallback),
        })
      }
      for (const mentionedUserId of mentionUserIds) {
        const tier = await resolveUserAccess(em, input.documentId, input, mentionedUserId, ctx.container)
        if (tier) notifyMentionedIds.push(mentionedUserId)
      }
    }], { transaction: true, label: 'documents.comment.create' })

    const finalDocument = document as Document | null
    const finalComment = comment as DocumentComment | null
    const beforeState = before as CommentState | null
    if (!finalDocument || !finalComment || !beforeState) {
      throw new Error('[internal] comment create produced no row')
    }
    const afterState = after as CommentState | null
    if (!afterState) throw new Error('[internal] comment create produced no after snapshot')
    const watcherRecipientIds = await resolveWatcherRecipients({
      em,
      container: ctx.container,
      scope: { tenantId: input.tenantId, organizationId: input.organizationId },
      documentId: input.documentId,
      actorUserId: input.actorUserId,
      excludeUserIds: notifyMentionedIds,
    })
    const projections = [
      commentCreatedProjection(input),
      ...shareMutations.map((mutation) => shareProjection('documents.document.shared', input, mutation.after)),
      ...mentionProjections(input, finalDocument, notifyMentionedIds),
      ...watchCommentProjections(
        { ...input, commentId: input.commentId },
        finalDocument.title,
        watcherRecipientIds,
        'documents.notifications.watch.commented.body',
      ),
    ]
    const projectionsAfterUndo: DocumentsProjectionDescriptor[] = [
      ...shareMutations.map((mutation) => shareProjection(
        mutation.before.existed && mutation.before.deletedAt === null
          ? 'documents.document.shared'
          : 'documents.document.unshared',
        input,
        mutation.before,
        false,
      )),
      {
        kind: 'mention-notification-delete',
        commentId: input.commentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
      },
    ]
    return {
      id: finalComment.id,
      updatedAt: finalComment.updatedAt.toISOString(),
      projections,
      undo: { before: beforeState, after: afterState, shareMutations, projectionsAfterUndo },
    }
  },
  async buildLog({ input, result }) {
    const before = commentStateSchema.parse(result.undo.before)
    const after = commentStateSchema.parse(result.undo.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.commentCreated', 'Add comment'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: result.id,
      parentResourceKind: DOCUMENTS_ENTITY_IDS.document,
      parentResourceId: input.documentId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      snapshotBefore: before,
      snapshotAfter: after,
      payload: {
        undo: result.undo,
        __redoInput: {
          ...input,
          redoExpectation: before.existed
            ? { kind: 'snapshot', state: before }
            : { kind: 'soft-deleted-created', state: after },
        } satisfies CommentCreateCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<CommentCreateUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, commentCreateCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      if (undo.shareMutations.length > 0) {
        await assertCanMutateMentionShares(ctx, em, input)
      }
      const comment = await loadComment(em, input, undo.after!.id, true)
      if (!comment) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      await assertCanResolveComment(ctx, em, {
        ...input,
        comment: { id: comment.id, resolved: false },
        expectedUpdatedAt: null,
      }, comment)
      assertCommentUnchanged(comment, undo.after!)
      await assertNoActiveReplies(em, input, comment.id)
      for (const mutation of undo.shareMutations) {
        const share = await loadMentionShare(em, input, mutation.after.userId, true)
        assertMentionShareUnchanged(share, mutation.after)
        restoreMentionShareState(share, mutation.before)
      }
      restoreCommentState(comment, undo.before!)
    }], { transaction: true, label: 'documents.comment.create.undo' })
  },
}

export const resolveCommentCommand: CommandHandler<CommentResolveCommandInput, CommentResolveCommandResult> = {
  id: 'documents.comment.resolve',
  async prepare(rawInput, ctx) {
    const input = commentResolveCommandSchema.parse(rawInput)
    assertActor(input, ctx)
    const em = ctx.container.resolve('em') as EntityManager
    const comment = await loadComment(em, input, input.comment.id)
    if (!comment || comment.deletedAt) throw new CrudHttpError(404, { error: 'Comment not found' })
    await assertCanResolveComment(ctx, em, input, comment)
    return null
  },
  async execute(rawInput, ctx) {
    const input = commentResolveCommandSchema.parse(rawInput)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    let comment: DocumentComment | null = null
    let before: CommentState | null = null
    let after: CommentState | null = null
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      assertActor(input, ctx)
      comment = await loadComment(em, input, input.comment.id, true)
      if (!comment || comment.deletedAt) throw new CrudHttpError(404, { error: 'Comment not found' })
      await assertCanResolveComment(ctx, em, input, comment)
      if (input.redoExpectation) {
        assertCommentMatchesState(comment, input.redoExpectation.state)
      } else {
        assertOptimisticLock({
          resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
          resourceId: comment.id,
          current: comment.updatedAt,
          expected: input.expectedUpdatedAt,
        })
      }
      before = captureCommentState(comment, {
        id: comment.id,
        parentCommentId: comment.parentCommentId ?? null,
        authorUserId: comment.authorUserId,
        body: comment.body,
        anchor: comment.anchor as CommentState['anchor'],
        mentions: comment.mentions ?? null,
        resolvedAt: comment.resolvedAt?.toISOString() ?? null,
        resolvedByUserId: comment.resolvedByUserId ?? null,
      })
      const now = new Date()
      ;(comment as DocumentComment).resolvedAt = input.comment.resolved ? now : null
      ;(comment as DocumentComment).resolvedByUserId = input.comment.resolved ? input.actorUserId : null
      ;(comment as DocumentComment).updatedAt = nextDocumentVersion(
        (comment as DocumentComment).updatedAt,
        now,
      )
    }, async () => {
      const finalComment = comment as DocumentComment | null
      if (!finalComment) throw new Error('[internal] comment resolve produced no row')
      after = captureCommentState(finalComment, {
        id: finalComment.id,
        parentCommentId: finalComment.parentCommentId ?? null,
        authorUserId: finalComment.authorUserId,
        body: finalComment.body,
        anchor: finalComment.anchor as CommentState['anchor'],
        mentions: finalComment.mentions ?? null,
        resolvedAt: finalComment.resolvedAt?.toISOString() ?? null,
        resolvedByUserId: finalComment.resolvedByUserId ?? null,
      })
    }], { transaction: true, label: 'documents.comment.resolve' })
    const finalComment = comment as DocumentComment | null
    const beforeState = before as CommentState | null
    const afterState = after as CommentState | null
    if (!finalComment || !beforeState || !afterState) throw new Error('[internal] comment resolve produced no row')
    const resolvedDocument = await findOneWithDecryption(
      em,
      Document,
      {
        id: input.documentId,
        tenantId: input.tenantId,
        organizationId: input.organizationId,
        deletedAt: null,
      },
      { fields: ['id', 'title'] },
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    const watcherRecipientIds = resolvedDocument
      ? await resolveWatcherRecipients({
          em,
          container: ctx.container,
          scope: { tenantId: input.tenantId, organizationId: input.organizationId },
          documentId: input.documentId,
          actorUserId: input.actorUserId,
        })
      : []
    return {
      id: finalComment.id,
      resolvedAt: afterState.resolvedAt,
      resolvedByUserId: afterState.resolvedByUserId,
      updatedAt: finalComment.updatedAt.toISOString(),
      before: beforeState,
      after: afterState,
      projections: [
        resolutionProjection(input, afterState),
        ...(resolvedDocument
          ? watchCommentProjections(
              { ...input, commentId: finalComment.id },
              resolvedDocument.title,
              watcherRecipientIds,
              'documents.notifications.watch.commented.resolvedBody',
            )
          : []),
      ],
    }
  },
  async buildLog({ input, result }) {
    const before = commentStateSchema.parse(result.before)
    const after = commentStateSchema.parse(result.after)
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('documents.audit.commentResolved', 'Resolve comment'),
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
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
          projectionsAfterUndo: [resolutionProjection(input, before, false)],
        } satisfies CommentResolveUndoPayload,
        __redoInput: {
          ...input,
          expectedUpdatedAt: null,
          redoExpectation: { kind: 'snapshot', state: before },
        } satisfies CommentResolveCommandInput,
      },
    }
  },
  async undo({ logEntry, ctx }) {
    const undo = extractUndoPayload<CommentResolveUndoPayload>(logEntry)
    if (!undo?.before || !undo.after) return
    const input = readRedoInput(logEntry, commentResolveCommandSchema)
    const em = ctx.transactionalEm ?? (ctx.container.resolve('em') as EntityManager).fork()
    await withAtomicFlush(em, [async () => {
      await loadLockedDocument(em, input)
      const comment = await loadComment(em, input, undo.after!.id, true)
      if (!comment) throw new CrudHttpError(409, { error: 'Record changed by another user' })
      await assertCanResolveComment(ctx, em, input, comment)
      assertCommentUnchanged(comment, undo.after!)
      restoreCommentState(comment, undo.before!)
    }], { transaction: true, label: 'documents.comment.resolve.undo' })
  },
}

registerCommand(createCommentCommand)
registerCommand(resolveCommentCommand)
