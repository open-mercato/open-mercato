import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FilterQuery } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { resolveNotificationService } from '@open-mercato/core/modules/notifications/lib/notificationService'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { Document, DocumentComment, DocumentShare } from '../../../data/entities'
import { documentCommentCreateSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { emitDocumentsEvent } from '../../../events'
import { assertTier, hasTier, resolveUserAccess } from '../../../lib/permissions'
import {
  hasDocumentsFeature,
  handleDocumentsRouteError,
  loadScopedDocument,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

type SerializedComment = {
  id: string
  documentId: string
  parentCommentId: string | null
  authorUserId: string
  body: string
  anchor: Record<string, unknown> | null
  resolvedAt: string | null
  resolvedByUserId: string | null
  createdAt: string
  updatedAt: string
  replies: SerializedComment[]
}

const commentResolveSchema = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
})

const commentNodeSchema: z.ZodType<SerializedComment> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    parentCommentId: z.string().uuid().nullable(),
    authorUserId: z.string().uuid(),
    body: z.string(),
    anchor: z.record(z.string(), z.unknown()).nullable(),
    resolvedAt: z.string().nullable(),
    resolvedByUserId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    replies: z.array(commentNodeSchema),
  }),
)

const commentListResponseSchema = z.object({
  items: z.array(commentNodeSchema),
})

const commentCreateResponseSchema = z.object({
  id: z.string().uuid(),
  updatedAt: z.string(),
})

const commentResolveResponseSchema = z.object({
  id: z.string().uuid(),
  resolvedAt: z.string().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
  updatedAt: z.string(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
  POST: { requireAuth: true, requireFeatures: ['documents.view'] },
  PATCH: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

function serializeComment(comment: DocumentComment): SerializedComment {
  return {
    id: comment.id,
    documentId: comment.documentId,
    parentCommentId: comment.parentCommentId ?? null,
    authorUserId: comment.authorUserId,
    body: comment.body,
    anchor: comment.anchor ?? null,
    resolvedAt: comment.resolvedAt ? comment.resolvedAt.toISOString() : null,
    resolvedByUserId: comment.resolvedByUserId ?? null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    replies: [],
  }
}

function buildThreadedComments(comments: DocumentComment[]): SerializedComment[] {
  const nodes = new Map<string, SerializedComment>()
  for (const comment of comments) {
    nodes.set(comment.id, serializeComment(comment))
  }

  const roots: SerializedComment[] = []
  for (const comment of comments) {
    const node = nodes.get(comment.id)
    if (!node) continue
    const parentId = comment.parentCommentId ?? null
    const parent = parentId ? nodes.get(parentId) : null
    if (parent) {
      parent.replies.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function extractMentionedUserIds(body: string): string[] {
  const mentionTokenPattern =
    /@\[([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\]/gi
  return Array.from(
    new Set(
      Array.from(body.matchAll(mentionTokenPattern))
        .map((match) => match[1])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  )
}

async function loadScopedComment(documentId: string, commentId: string, ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>): Promise<DocumentComment> {
  const comment = await ctx.em.findOne(DocumentComment, {
    id: commentId,
    documentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
  return comment
}

async function assertParentComment(
  documentId: string,
  parentCommentId: string | null | undefined,
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
): Promise<void> {
  if (!parentCommentId) return
  await loadScopedComment(documentId, parentCommentId, ctx)
}

async function assertShareUserPrincipal(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  userId: string,
): Promise<void> {
  const user = await ctx.em.findOne(User, {
    id: userId,
    tenantId: ctx.tenantId,
    deletedAt: null,
    $or: [{ organizationId: null }, { organizationId: ctx.organizationId }],
  } as FilterQuery<User>)
  if (!user) throw new CrudHttpError(400, { error: 'Share principal not found in this organization' })
}

async function grantMentionAccessToUser(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
  userId: string,
  actorUserId: string,
): Promise<DocumentShare> {
  await assertShareUserPrincipal(ctx, userId)
  const existing = await ctx.em.findOne(
    DocumentShare,
    {
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      principalType: 'user',
      principalId: userId,
    },
    { orderBy: { updatedAt: 'DESC' } },
  )
  const now = new Date()
  const share = existing ?? ctx.em.create(DocumentShare, {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    documentId,
    principalType: 'user',
    principalId: userId,
    permission: 'commenter',
    createdByUserId: actorUserId,
  })
  share.permission = 'commenter'
  share.deletedAt = null
  share.updatedAt = now
  if (!existing) ctx.em.persist(share)
  await ctx.em.flush()
  return share
}

async function emitMentionNotifications(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  document: Document,
  comment: DocumentComment,
  mentionedUserIds: string[],
): Promise<void> {
  if (!mentionedUserIds.length) return
  const notificationService = resolveNotificationService(ctx.container)
  const linkHref = `/backend/documents/${encodeURIComponent(document.id)}?commentId=${encodeURIComponent(comment.id)}`

  for (const recipientUserId of mentionedUserIds) {
    await emitDocumentsEvent('documents.comment.mentioned', {
      id: comment.id,
      documentId: document.id,
      mentionedUserId: recipientUserId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId: comment.authorUserId,
    })
    await notificationService.create(
      {
        recipientUserId,
        type: 'documents.comment.mentioned',
        titleKey: 'documents.notifications.comment.mentioned.title',
        bodyKey: 'documents.notifications.comment.mentioned.body',
        severity: 'info',
        titleVariables: {
          documentTitle: document.title,
        },
        bodyVariables: {
          documentTitle: document.title,
          authorUserId: comment.authorUserId,
        },
        sourceEntityType: DOCUMENTS_ENTITY_IDS.documentComment,
        sourceEntityId: comment.id,
        linkHref,
      },
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      },
    )
  }
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')

    const comments = await ctx.em.find(
      DocumentComment,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      { orderBy: { createdAt: 'ASC' } },
    )

    return NextResponse.json({ items: buildThreadedComments(comments) })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'commenter')
    const document = await loadScopedDocument(ctx, documentId)
    const input = documentCommentCreateSchema.parse(await readBody(request))
    await assertParentComment(documentId, input.parentCommentId, ctx)
    const userId = resolveActorUserId(ctx.auth)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: input,
    })

    const comment = ctx.em.create(DocumentComment, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      parentCommentId: input.parentCommentId ?? null,
      authorUserId: userId,
      body: input.body,
      anchor: input.anchor ?? null,
    })
    ctx.em.persist(comment)
    await ctx.em.flush()

    await emitDocumentsEvent('documents.comment.created', {
      id: comment.id,
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
    })
    const mentionedIds = extractMentionedUserIds(comment.body)
    const canShare =
      hasDocumentsFeature(ctx.auth, 'documents.share')
      || hasDocumentsFeature(ctx.auth, 'documents.manage')
      || document.ownerUserId === userId
    const grantSet = new Set((input.grantAccessTo ?? []).map((id) => id.toLowerCase()))

    for (const mentionedId of mentionedIds) {
      if (!grantSet.has(mentionedId) || !canShare) continue
      const tier = await resolveUserAccess(
        ctx.em,
        documentId,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        mentionedId,
      )
      if (tier) continue
      const share = await grantMentionAccessToUser(ctx, documentId, mentionedId, userId)
      await emitDocumentsEvent('documents.document.shared', {
        id: documentId,
        shareId: share.id,
        principalType: share.principalType,
        principalId: share.principalId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        userId,
      })
    }

    const notifyMentionedIds: string[] = []
    for (const mentionedId of mentionedIds) {
      const tier = await resolveUserAccess(
        ctx.em,
        documentId,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
        mentionedId,
      )
      if (tier) notifyMentionedIds.push(mentionedId)
    }
    await emitMentionNotifications(ctx, document, comment, notifyMentionedIds)
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: documentId,
      operation: 'create',
    })

    return NextResponse.json({ id: comment.id, updatedAt: comment.updatedAt.toISOString() }, { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.create')
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const tier = await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    const input = commentResolveSchema.parse(await readBody(request))
    const comment = await loadScopedComment(documentId, input.id, ctx)
    const userId = resolveActorUserId(ctx.auth)
    if (!hasTier(tier, 'commenter') && comment.authorUserId !== userId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    enforceCommandOptimisticLock({
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: comment.id,
      current: comment.updatedAt,
      request,
    })

    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: comment.id,
      operation: 'update',
      mutationPayload: input,
    })

    const now = new Date()
    comment.resolvedAt = input.resolved ? now : null
    comment.resolvedByUserId = input.resolved ? userId : null
    comment.updatedAt = now
    await ctx.em.flush()

    await emitDocumentsEvent('documents.comment.resolved', {
      id: comment.id,
      documentId,
      resolved: input.resolved,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      userId,
    })
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: comment.id,
      operation: 'update',
    })

    return NextResponse.json({
      id: comment.id,
      resolvedAt: comment.resolvedAt ? comment.resolvedAt.toISOString() : null,
      resolvedByUserId: comment.resolvedByUserId ?? null,
      updatedAt: comment.updatedAt.toISOString(),
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.resolve')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document comments',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List document comments',
      responses: [{ status: 200, description: 'Threaded document comments', schema: commentListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document comment',
      description: 'Mentions use bracketed user-id tokens in the comment body: @[user-uuid].',
      requestBody: { contentType: 'application/json', schema: documentCommentCreateSchema },
      responses: [{ status: 201, description: 'Comment created', schema: commentCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    PATCH: {
      summary: 'Resolve or unresolve document comment',
      requestBody: { contentType: 'application/json', schema: commentResolveSchema },
      responses: [{ status: 200, description: 'Comment resolution updated', schema: commentResolveResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Comment not found', schema: routeErrorSchema },
        { status: 409, description: 'Optimistic lock conflict', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET, POST, PATCH }
