import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Todo } from '../../../data/entities'
import {
  TODO_BULK_MAX_IDS,
  claimTodoBulkOperation,
  publishTodoBulkOperation,
  type ProgressServiceLike,
} from '../../../lib/todoBulkComplete'
import { exampleErrorSchema, exampleTag } from '../../openapi'

const logger = createLogger('example').child({ component: 'todo-bulk-complete-route' })

const bulkCompleteRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(TODO_BULK_MAX_IDS),
  idempotencyKey: z.string().uuid(),
})

const bulkCompleteResponseSchema = z.object({
  ok: z.boolean(),
  progressJobId: z.string().uuid().nullable(),
  message: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['example.todos.manage'] },
}

/**
 * Starts the durable Todo bulk-complete operation.
 *
 * The response is 202 the moment the outbox row and progress job commit — queue
 * publication is best-effort after that, because an enqueue failure must not
 * erase an operation the user was already told had started. The scheduler
 * dispatcher republishes anything left unpublished.
 */
export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.sub) {
    return Response.json({ ok: false, progressJobId: null, message: 'Unauthorized' }, { status: 401 })
  }
  if (!auth.orgId) {
    return Response.json(
      { ok: false, progressJobId: null, message: 'Organization scope required' },
      { status: 400 },
    )
  }

  const parsed = bulkCompleteRequestSchema.safeParse(await readJsonSafe(req))
  if (!parsed.success) {
    return Response.json({ ok: false, progressJobId: null, message: 'Invalid payload' }, { status: 400 })
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId, userId: String(auth.sub) }
  const ids = Array.from(new Set(parsed.data.ids))
  const container = await createRequestContainer()

  const guardResult = await runRouteMutationGuards({
    container,
    req,
    auth: { userId: scope.userId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    input: {
      resourceKind: 'example:todo',
      operation: 'update',
      mutationPayload: { ids, idempotencyKey: parsed.data.idempotencyKey },
    },
  })
  if (!guardResult.ok) return guardResult.response

  const em = container.resolve('em') as EntityManager
  // Every selected id is verified inside the caller's own scope BEFORE anything
  // durable is written, so a foreign-scope id creates neither an outbox row nor a
  // progress job rather than failing halfway through the worker.
  const scopedCount = await em.fork().count(Todo, {
    id: { $in: ids },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<Todo>)
  if (scopedCount !== ids.length) {
    return Response.json(
      { ok: false, progressJobId: null, message: 'One or more todos are not in scope' },
      { status: 404 },
    )
  }

  const progress = container.resolve('progressService') as ProgressServiceLike
  const claim = await claimTodoBulkOperation({
    em,
    progress,
    scope,
    idempotencyKey: parsed.data.idempotencyKey,
    todoIds: ids,
  })

  await publishTodoBulkOperation({ em, operationId: claim.operationId, scope })
  try {
    await guardResult.runAfterSuccess()
  } catch (error) {
    logger.warn('Mutation guard after-success failed for todo bulk complete', { err: error })
  }

  return Response.json(
    {
      ok: true,
      progressJobId: claim.progressJobId,
      message: claim.created ? 'Bulk completion started.' : 'Bulk completion already in progress.',
    },
    { status: 202 },
  )
}

const bulkCompletePostDoc: OpenApiMethodDoc = {
  summary: 'Start marking selected todos done',
  description:
    'Creates (or reuses, by idempotency key) a durable bulk operation plus a progress job, then publishes it to the execution queue. Returns the `progressJobId` the DataTable bulk-action contract hands to the top progress bar.',
  tags: [exampleTag],
  requestBody: { schema: bulkCompleteRequestSchema },
  responses: [
    { status: 202, description: 'Operation accepted.', schema: bulkCompleteResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid payload or missing organization scope', schema: exampleErrorSchema },
    { status: 401, description: 'Authentication required', schema: exampleErrorSchema },
    { status: 404, description: 'One or more todos are not in the caller scope', schema: exampleErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: exampleTag,
  summary: 'Example todo bulk completion',
  methods: {
    POST: bulkCompletePostDoc,
  },
}
