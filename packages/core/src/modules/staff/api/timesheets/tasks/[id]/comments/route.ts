/**
 * Task comments (T3.4b) — the "Komentarze (2)" thread in the task drawer of
 * screen 7: avatar, author name, timestamp, body, and a composer that posts on
 * ⌘↵.
 *
 * Hand-written rather than `makeCrudRoute`, for one reason that decides
 * everything else: **a caller who cannot see the task's project must not be able
 * to tell that the task exists.** A CRUD list would answer such a request with
 * an empty page — which is a different response from "no such task" and
 * therefore an existence oracle for every task id in the tenant. Here every
 * method funnels through the same `requireAccessibleTask` call before it touches
 * a comment, so "not yours" and "does not exist" produce one and the same 404
 * body, byte for byte.
 *
 * Because the route is hand-written it wires `runRouteMutationGuards` itself
 * (`packages/core/AGENTS.md` § API Routes) — the same guard set every
 * `makeCrudRoute` write runs — and the writes go through the task-comment
 * commands so audit, undo, events and indexing stay consistent.
 *
 * Two more things the thread depends on:
 *
 *  - **Oldest first.** Screen 7 reads as a conversation, so the list sorts by
 *    `created_at ASC` with an id tiebreak, not the newest-first default a grid
 *    would want.
 *  - **The author's display name is resolved for rendering**, reusing the same
 *    `User` lookup `api/comments.ts` uses for the team-member timeline rather
 *    than inventing a cross-module join. A name that cannot be resolved degrades
 *    to `null` and the thread still renders — the comment is the record, the
 *    name is decoration.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { StaffTimeTaskComment } from '../../../../../data/entities'
import {
  staffTimeTaskCommentCreateSchema,
  staffTimeTaskCommentUpdateSchema,
} from '../../../../../data/validators'
import { staffTimeTaskCommentCommandIds } from '../../../../../commands/timesheets-task-comments'
import {
  loadTagProjectAccess as loadTaskProjectAccess,
  requireAccessibleTask,
  type TagAssignmentScope as TaskAccessScope,
} from '../../../tags/access'

const logger = createLogger('staff').child({ component: 'api/timesheets/tasks/comments' })

const RESOURCE_KIND = 'staff.timesheets.task_comment'

const VIEW_FEATURE = 'staff.timesheets.tasks.view'
const MANAGE_FEATURE = 'staff.timesheets.tasks.manage'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
  POST: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
  PUT: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
  DELETE: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

const listQuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(50),
})

const commentItemSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  body: z.string(),
  authorUserId: z.string().uuid().nullable(),
  authorName: z.string().nullable(),
  authorEmail: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const listResponseSchema = z.object({
  items: z.array(commentItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
})

const createResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  taskId: z.string().uuid(),
  authorUserId: z.string().uuid().nullable(),
})

const okResponseSchema = z.object({ ok: z.boolean() })

const createBodySchema = z.object({ body: z.string().trim().min(1).max(5000) })
const updateBodySchema = z.object({ id: z.string().uuid(), body: z.string().trim().min(1).max(5000) })

type RouteContext = {
  ctx: CommandRuntimeContext
  scope: TaskAccessScope
  translate: (key: string, fallback?: string) => string
  taskId: string
}

/**
 * The task id comes from the path segment. Read from the URL rather than the
 * handler's `params` argument so the route behaves identically under the app's
 * catch-all dispatcher and under a direct call in tests.
 */
function extractTaskId(req: Request): string | null {
  try {
    const match = new URL(req.url).pathname.match(/\/tasks\/([^/]+)\/comments/)
    const id = match?.[1] ? decodeURIComponent(match[1]) : null
    return id && id.length > 0 ? id : null
  } catch {
    return null
  }
}

async function buildRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope,
    selectedOrganizationId: organizationScope?.selectedId ?? auth.orgId ?? null,
    organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  const tenantId = auth.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? auth.orgId ?? null
  const userId = auth.sub ?? null
  if (!tenantId || !organizationId || !userId) {
    throw new CrudHttpError(400, {
      error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
    })
  }

  const taskId = extractTaskId(req)
  if (!taskId) {
    throw new CrudHttpError(400, {
      error: translate('staff.time_tracking.taskComments.errors.taskIdRequired', 'Task id is required.'),
    })
  }

  return { ctx, scope: { tenantId, organizationId, userId }, translate, taskId }
}

/**
 * The single gate every method passes through. Resolving project access before
 * the task is loaded — and answering both misses with one body — is what keeps
 * the endpoint from confirming that a task the caller may not see exists.
 */
async function requireTaskAccess(route: RouteContext): Promise<void> {
  const access = await loadTaskProjectAccess(route.ctx.container, route.scope)
  const em = (route.ctx.container.resolve('em') as EntityManager).fork()
  await requireAccessibleTask(em, route.taskId, route.scope, access, route.translate)
}

function commentNotFoundError(translate: (key: string, fallback?: string) => string): CrudHttpError {
  return new CrudHttpError(404, {
    error: translate('staff.time_tracking.taskComments.errors.notFound', 'Comment not found or not accessible.'),
  })
}

/**
 * A comment addressed through another task's URL is refused exactly like a
 * comment that does not exist, so the path segment cannot be swapped to reach a
 * thread the caller has no route to.
 */
async function requireCommentOnTask(route: RouteContext, commentId: string): Promise<StaffTimeTaskComment> {
  const em = (route.ctx.container.resolve('em') as EntityManager).fork()
  const comment = await em.findOne(StaffTimeTaskComment, {
    id: commentId,
    taskId: route.taskId,
    tenantId: route.scope.tenantId,
    organizationId: route.scope.organizationId,
    deletedAt: null,
  })
  if (!comment) throw commentNotFoundError(route.translate)
  return comment
}

type AuthorMeta = { name: string | null; email: string | null }

async function resolveAuthorMeta(
  route: RouteContext,
  authorUserIds: string[],
): Promise<Map<string, AuthorMeta>> {
  const map = new Map<string, AuthorMeta>()
  const unique = Array.from(new Set(authorUserIds))
  if (unique.length === 0) return map
  try {
    const em = (route.ctx.container.resolve('em') as EntityManager).fork()
    const users = await findWithDecryption(
      em,
      User,
      { id: { $in: unique } },
      undefined,
      { tenantId: route.scope.tenantId, organizationId: route.scope.organizationId },
    )
    for (const user of users) {
      const name = typeof user.name === 'string' && user.name.trim().length > 0 ? user.name.trim() : null
      map.set(user.id, { name, email: user.email ?? null })
    }
  } catch (err) {
    // A thread that renders without display names is still a usable thread.
    logger.warn('staff.timesheets.task comments failed to resolve author metadata', { err })
  }
  return map
}

function serializeComment(comment: StaffTimeTaskComment, authors: Map<string, AuthorMeta>) {
  const authorUserId = comment.authorUserId ?? null
  const meta = authorUserId ? authors.get(authorUserId) ?? null : null
  return {
    id: comment.id,
    taskId: comment.taskId,
    body: comment.body,
    authorUserId,
    authorName: meta?.name ?? null,
    authorEmail: meta?.email ?? null,
    createdAt: comment.createdAt ? comment.createdAt.toISOString() : null,
    updatedAt: comment.updatedAt ? comment.updatedAt.toISOString() : null,
  }
}

async function runGuards(
  route: RouteContext,
  operation: 'create' | 'update' | 'delete',
  resourceId: string | null,
  mutationPayload: Record<string, unknown> | null,
) {
  return runRouteMutationGuards({
    container: route.ctx.container,
    req: route.ctx.request as Request,
    auth: {
      userId: route.scope.userId,
      tenantId: route.scope.tenantId,
      organizationId: route.scope.organizationId,
    },
    input: {
      resourceKind: RESOURCE_KIND,
      resourceId,
      operation,
      mutationPayload,
    },
  })
}

function withOperationHeader(
  response: NextResponse,
  logEntry: {
    id?: string
    undoToken?: string | null
    commandId?: string
    actionLabel?: string | null
    resourceKind?: string | null
    resourceId?: string | null
    createdAt?: Date | string | null
  } | null | undefined,
  fallbackResourceId: string,
): NextResponse {
  if (!logEntry?.undoToken || !logEntry.id || !logEntry.commandId) return response
  response.headers.set(
    'x-om-operation',
    serializeOperationMetadata({
      id: logEntry.id,
      undoToken: logEntry.undoToken,
      commandId: logEntry.commandId,
      actionLabel: logEntry.actionLabel ?? null,
      resourceKind: logEntry.resourceKind ?? RESOURCE_KIND,
      resourceId: logEntry.resourceId ?? fallbackResourceId,
      executedAt:
        logEntry.createdAt instanceof Date
          ? logEntry.createdAt.toISOString()
          : typeof logEntry.createdAt === 'string'
            ? logEntry.createdAt
            : new Date().toISOString(),
    }),
  )
  return response
}

async function errorResponse(err: unknown, message: string): Promise<Response> {
  if (isCrudHttpError(err)) {
    return NextResponse.json(err.body, { status: err.status })
  }
  const { translate } = await resolveTranslations()
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: translate('staff.errors.invalid_request', 'Invalid request'), details: err.issues },
      { status: 400 },
    )
  }
  logger.error(message, { err })
  return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
}

export async function GET(req: Request) {
  try {
    const route = await buildRouteContext(req)
    await requireTaskAccess(route)

    const url = new URL(req.url)
    const query = listQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    })

    const em = (route.ctx.container.resolve('em') as EntityManager).fork()
    const [comments, total] = await em.findAndCount(
      StaffTimeTaskComment,
      {
        taskId: route.taskId,
        tenantId: route.scope.tenantId,
        organizationId: route.scope.organizationId,
        deletedAt: null,
      },
      {
        // Oldest first — the drawer reads the thread top to bottom.
        orderBy: { createdAt: 'asc', id: 'asc' },
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      },
    )

    const authors = await resolveAuthorMeta(
      route,
      comments.map((comment) => comment.authorUserId).filter((id): id is string => typeof id === 'string'),
    )

    return NextResponse.json({
      items: comments.map((comment) => serializeComment(comment, authors)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0,
    })
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.tasks.comments.GET failed')
  }
}

export async function POST(req: Request) {
  try {
    const route = await buildRouteContext(req)
    await requireTaskAccess(route)

    const raw = await readJsonSafe(req, {})
    const parsedBody = createBodySchema.parse(raw ?? {})
    // `authorUserId` is never forwarded: whatever the client sent is dropped
    // here and the command stamps the authenticated caller instead.
    const input = parseScopedCommandInput(
      staffTimeTaskCommentCreateSchema,
      { taskId: route.taskId, body: parsedBody.body },
      route.ctx,
      route.translate,
    )

    const guardResult = await runGuards(route, 'create', route.taskId, input as unknown as Record<string, unknown>)
    if (!guardResult.ok) return guardResult.response

    const commandBus = route.ctx.container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      typeof input,
      { commentId: string; taskId: string; authorUserId: string | null }
    >(staffTimeTaskCommentCommandIds.create, { input, ctx: route.ctx })

    await guardResult.runAfterSuccess()

    const response = NextResponse.json(
      {
        id: result?.commentId ?? null,
        taskId: route.taskId,
        authorUserId: result?.authorUserId ?? null,
      },
      { status: 201 },
    )
    return withOperationHeader(response, logEntry, result?.commentId ?? route.taskId)
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.tasks.comments.POST failed')
  }
}

export async function PUT(req: Request) {
  try {
    const route = await buildRouteContext(req)
    await requireTaskAccess(route)

    const raw = await readJsonSafe(req, {})
    const parsedBody = updateBodySchema.parse(raw ?? {})
    await requireCommentOnTask(route, parsedBody.id)

    const input = staffTimeTaskCommentUpdateSchema.parse({ id: parsedBody.id, body: parsedBody.body })

    const guardResult = await runGuards(route, 'update', input.id, input as unknown as Record<string, unknown>)
    if (!guardResult.ok) return guardResult.response

    const commandBus = route.ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<typeof input, { commentId: string; taskId: string }>(
      staffTimeTaskCommentCommandIds.update,
      { input, ctx: route.ctx },
    )

    await guardResult.runAfterSuccess()

    return withOperationHeader(NextResponse.json({ ok: true }), logEntry, input.id)
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.tasks.comments.PUT failed')
  }
}

export async function DELETE(req: Request) {
  try {
    const route = await buildRouteContext(req)
    await requireTaskAccess(route)

    const url = new URL(req.url)
    const raw = await readJsonSafe(req, {})
    const rawId = url.searchParams.get('id') ?? (raw as { id?: unknown } | null)?.id
    const id = z.string().uuid().parse(typeof rawId === 'string' ? rawId : undefined)
    await requireCommentOnTask(route, id)

    const guardResult = await runGuards(route, 'delete', id, { id })
    if (!guardResult.ok) return guardResult.response

    const commandBus = route.ctx.container.resolve('commandBus') as CommandBus
    const { logEntry } = await commandBus.execute<{ id: string }, { commentId: string; taskId: string }>(
      staffTimeTaskCommentCommandIds.delete,
      { input: { id }, ctx: route.ctx },
    )

    await guardResult.runAfterSuccess()

    return withOperationHeader(NextResponse.json({ ok: true }), logEntry, id)
  } catch (err) {
    return errorResponse(err, 'staff.timesheets.tasks.comments.DELETE failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Task comments',
  methods: {
    GET: {
      summary: 'List task comments',
      description:
        'Returns the task comment thread oldest-first, with the author display name resolved for rendering. Answers 404 — identical to a task that does not exist — when the task belongs to a project the caller cannot see.',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Comment thread', schema: listResponseSchema }],
      errors: [
        { status: 400, description: 'Missing task id or organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.view' },
        { status: 404, description: 'Task not found or not accessible' },
      ],
    },
    POST: {
      summary: 'Post a task comment',
      description:
        'Adds a comment to the task. The author is stamped from the authenticated caller — an authorUserId supplied by the client is ignored.',
      requestBody: { contentType: 'application/json', schema: createBodySchema },
      responses: [{ status: 201, description: 'Comment created', schema: createResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload, missing task id or organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.manage' },
        { status: 404, description: 'Task not found or not accessible' },
      ],
    },
    PUT: {
      summary: 'Edit a task comment',
      description:
        'Updates a comment body. Only the comment author may edit, unless the caller holds staff.timesheets.manage_all. Honours the optimistic-lock header.',
      requestBody: { contentType: 'application/json', schema: updateBodySchema },
      responses: [{ status: 200, description: 'Comment updated', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload, missing task id or organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Not the author and missing staff.timesheets.manage_all' },
        { status: 404, description: 'Task or comment not found or not accessible' },
        { status: 409, description: 'Optimistic lock conflict' },
      ],
    },
    DELETE: {
      summary: 'Delete a task comment',
      description:
        'Soft-deletes a comment so its audit trail survives. Only the comment author may delete, unless the caller holds staff.timesheets.manage_all.',
      requestBody: { contentType: 'application/json', schema: z.object({ id: z.string().uuid() }) },
      responses: [{ status: 200, description: 'Comment deleted', schema: okResponseSchema }],
      errors: [
        { status: 400, description: 'Missing comment id, task id or organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Not the author and missing staff.timesheets.manage_all' },
        { status: 404, description: 'Task or comment not found or not accessible' },
        { status: 409, description: 'Optimistic lock conflict' },
      ],
    },
  },
}
