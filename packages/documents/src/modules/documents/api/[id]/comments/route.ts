import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentComment } from '../../../data/entities'
import { documentCommentCreateSchema } from '../../../data/validators'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  DOCUMENTS_COMMENT_LIST_PAGE_SIZE,
  DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT,
} from '../../../lib/historyLimits'
import { assertTier, hasTier } from '../../../lib/permissions'
import { resolveViewerSafeUserLabels } from '../../../lib/userLabels'
import type {
  CommentCreateCommandInput,
  CommentCreateCommandResult,
  CommentResolveCommandInput,
  CommentResolveCommandResult,
} from '../../../commands/comments'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  readBody,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
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
  mentions: { userId: string }[]
  resolvedAt: string | null
  resolvedByUserId: string | null
  createdAt: string
  updatedAt: string
  canResolve: boolean
  replies: SerializedComment[]
}

const commentResolveSchema = z.object({
  id: z.string().uuid(),
  resolved: z.boolean(),
})

export const commentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).default(DOCUMENTS_COMMENT_LIST_PAGE_SIZE)
    .transform((value) => Math.min(value, DOCUMENTS_COMMENT_LIST_PAGE_SIZE)),
})

const commentMentionSchema = z.object({
  userId: z.string().uuid(),
})

const userLabelSchema = z.object({
  label: z.string(),
})

const commentNodeSchema: z.ZodType<SerializedComment> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    documentId: z.string().uuid(),
    parentCommentId: z.string().uuid().nullable(),
    authorUserId: z.string().uuid(),
    body: z.string(),
    anchor: z.record(z.string(), z.unknown()).nullable(),
    mentions: z.array(commentMentionSchema),
    resolvedAt: z.string().nullable(),
    resolvedByUserId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    canResolve: z.boolean(),
    replies: z.array(commentNodeSchema),
  }),
)

const commentListResponseSchema = z.object({
  items: z.array(commentNodeSchema),
  userLabels: z.record(z.string(), userLabelSchema),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().positive(),
  totalComments: z.number().int().nonnegative(),
  truncated: z.boolean(),
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

function serializeComment(comment: DocumentComment, canResolve: boolean): SerializedComment {
  return {
    id: comment.id,
    documentId: comment.documentId,
    parentCommentId: comment.parentCommentId ?? null,
    authorUserId: comment.authorUserId,
    body: comment.body,
    anchor: comment.anchor ?? null,
    mentions: comment.mentions ?? [],
    resolvedAt: comment.resolvedAt ? comment.resolvedAt.toISOString() : null,
    resolvedByUserId: comment.resolvedByUserId ?? null,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
    canResolve,
    replies: [],
  }
}

function buildThreadedComments(
  comments: DocumentComment[],
  options: { tier: Awaited<ReturnType<typeof assertTier>>; userId: string },
): SerializedComment[] {
  const nodes = new Map<string, SerializedComment>()
  for (const comment of comments) {
    nodes.set(comment.id, serializeComment(
      comment,
      hasTier(options.tier, 'commenter') || comment.authorUserId === options.userId,
    ))
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

export function paginateNewestThreadRoots<T>(roots: T[], page: number, pageSize: number): T[] {
  const end = Math.max(0, roots.length - ((page - 1) * pageSize))
  const start = Math.max(0, end - pageSize)
  return roots.slice(start, end)
}

function collectSerializedCommentIds(comments: SerializedComment[]): Set<string> {
  const ids = new Set<string>()
  const visit = (nodes: SerializedComment[]) => {
    for (const comment of nodes) {
      ids.add(comment.id)
      visit(comment.replies)
    }
  }
  visit(comments)
  return ids
}

function extractMentionedUserIds(body: string): string[] {
  const mentionTokenPattern =
    /@\[([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/gi
  return Array.from(
    new Set(
      Array.from(body.matchAll(mentionTokenPattern))
        .map((match) => match[1])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .map((value) => value.toLowerCase()),
    ),
  )
}

function dedupeUserIds(userIds: string[]): string[] {
  return Array.from(new Set(userIds.map((userId) => userId.toLowerCase())))
}

function collectCommentLabelUserIds(comments: DocumentComment[]): string[] {
  const userIds: string[] = []
  for (const comment of comments) {
    userIds.push(comment.authorUserId)
    if (comment.resolvedByUserId) userIds.push(comment.resolvedByUserId)
    for (const mention of comment.mentions ?? []) {
      userIds.push(mention.userId)
    }
    userIds.push(...extractMentionedUserIds(comment.body))
  }
  return dedupeUserIds(userIds)
}

async function loadScopedComment(documentId: string, commentId: string, ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>): Promise<DocumentComment> {
  const comment = await findOneWithDecryption(
    ctx.em,
    DocumentComment,
    {
      id: commentId,
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!comment) throw new CrudHttpError(404, { error: 'Comment not found' })
  return comment
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const tier = await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    const userId = resolveActorUserId(ctx.auth)
    const url = new URL(request.url)
    const query = commentListQuerySchema.parse(Object.fromEntries(url.searchParams.entries()))

    const loadedComments = await findWithDecryption(
      ctx.em,
      DocumentComment,
      {
        documentId,
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        deletedAt: null,
      },
      {
        orderBy: { createdAt: 'DESC', id: 'DESC' },
        limit: DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT + 1,
      },
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    )
    const truncated = loadedComments.length > DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT
    const comments = loadedComments.slice(0, DOCUMENTS_MAX_COMMENTS_PER_DOCUMENT).reverse()
    const roots = buildThreadedComments(comments, { tier, userId })
    const items = paginateNewestThreadRoots(roots, query.page, query.pageSize)
    const visibleCommentIds = collectSerializedCommentIds(items)
    const userLabels = await resolveViewerSafeUserLabels(
      ctx.container,
      { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
      collectCommentLabelUserIds(comments.filter((comment) => visibleCommentIds.has(comment.id))),
    )

    return NextResponse.json({
      items,
      userLabels: Object.fromEntries(userLabels.entries()),
      page: query.page,
      pageSize: query.pageSize,
      total: roots.length,
      totalPages: Math.max(1, Math.ceil(roots.length / query.pageSize)),
      totalComments: comments.length,
      truncated,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.list')
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'commenter')
    await assertDocumentNotArchived(ctx, documentId)
    const input = documentCommentCreateSchema.parse(await readBody(request))
    const userId = resolveActorUserId(ctx.auth)
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: input,
      mutationPayloadSchema: documentCommentCreateSchema,
    })

    const commandInput: CommentCreateCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      commentId: randomUUID(),
      actorUserId: userId,
      comment: input,
      grantShares: dedupeUserIds(input.grantAccessTo ?? []).map((mentionedUserId) => ({
        userId: mentionedUserId,
        shareId: randomUUID(),
      })),
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<CommentCreateCommandInput, CommentCreateCommandResult>(
      'documents.comment.create',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: documentId,
      operation: 'create',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({ id: execution.result.id, updatedAt: execution.result.updatedAt }, { status: 201 }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentComment, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.create')
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    const tier = await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    await assertDocumentNotArchived(ctx, documentId)
    const input = commentResolveSchema.parse(await readBody(request))
    const comment = await loadScopedComment(documentId, input.id, ctx)
    const userId = resolveActorUserId(ctx.auth)
    if (!hasTier(tier, 'commenter') && comment.authorUserId !== userId) {
      throw new CrudHttpError(403, { error: 'Forbidden' })
    }
    await enforceCommandOptimisticLockWithGuards(ctx.container, {
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
      mutationPayloadSchema: commentResolveSchema,
    })

    const commandInput: CommentResolveCommandInput = {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      actorUserId: userId,
      expectedUpdatedAt: comment.updatedAt.toISOString(),
      comment: input,
    }
    const execution = await resolveDocumentsCommandBus(ctx).execute<CommentResolveCommandInput, CommentResolveCommandResult>(
      'documents.comment.resolve',
      { input: commandInput, ctx: buildDocumentsCommandRuntimeContext(ctx) },
    )
    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentComment,
      resourceId: comment.id,
      operation: 'update',
    })

    return attachDocumentsOperationMetadata(
      NextResponse.json({
        id: execution.result.id,
        resolvedAt: execution.result.resolvedAt,
        resolvedByUserId: execution.result.resolvedByUserId,
        updatedAt: execution.result.updatedAt,
      }),
      execution.logEntry,
      { resourceKind: DOCUMENTS_ENTITY_IDS.documentComment, resourceId: execution.result.id },
    )
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.comments.resolve')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
  tag: 'Documents',
  summary: 'Document comments',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'List document comments',
      query: commentListQuerySchema,
      responses: [{ status: 200, description: 'Threaded document comments', schema: commentListResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
      ],
    },
    POST: {
      summary: 'Create document comment',
      description: 'Mentions may be sent out-of-band as mentions: [{ userId }]. Legacy bracketed @[user-uuid] tokens in the comment body are still honored.',
      requestBody: { contentType: 'application/json', schema: documentCommentCreateSchema },
      responses: [{ status: 201, description: 'Comment created', schema: commentCreateResponseSchema }],
      errors: [
        { status: 400, description: 'Validation failed', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Request body or document comment limit exceeds the safe resource bound', schema: routeErrorSchema },
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
        { status: 413, description: 'Request body exceeds the safe resource bound', schema: routeErrorSchema },
      ],
    },
  },
})

export default { GET, POST, PATCH }
