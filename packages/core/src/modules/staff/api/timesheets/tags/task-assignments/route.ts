/**
 * Task tag assignment (T3.4) — the "Dodaj tag" chip in the task drawer of screen
 * 7 and the badges on the board cards of screen 6.
 *
 * `POST` adds the tags, `DELETE` removes them; both are idempotent, so the drawer
 * can re-send its chip list without special-casing what was already there.
 *
 * Every call resolves the caller's project access before it touches the task —
 * see `../access.ts` for why that lookup and the 404 are shaped the way they are.
 */
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { emitStaffEvent } from '../../../../events'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runTimesheetInterceptors } from '../../_shared/withTimesheetInterceptors'
import {
  staffTimeTaskTagAssignmentSchema,
  type StaffTimeTaskTagAssignmentInput,
} from '../../../../data/validators'
import { staffTimeTagCommandIds } from '../../../../commands/timesheets-tags'
import {
  STAFF_TIME_TRACKING_RESOURCE_KINDS,
  runStaffMutationGuardAfterSuccess,
  runStaffMutationGuards,
} from '../../../guards'
import { loadTagProjectAccess, requireAccessibleTask, type TagAssignmentScope } from '../access'

const logger = createLogger('staff').child({ component: 'api/timesheets/tags/task-assignments' })

const RESOURCE_KIND = STAFF_TIME_TRACKING_RESOURCE_KINDS.taskTag

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
}

const assignResponseSchema = z.object({
  taskId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()),
  assignedTagIds: z.array(z.string().uuid()),
  alreadyAssignedTagIds: z.array(z.string().uuid()),
})

const unassignResponseSchema = z.object({
  taskId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()),
  removedTagIds: z.array(z.string().uuid()),
  notAssignedTagIds: z.array(z.string().uuid()),
})

type AssignmentResult = {
  targetId: string
  assignedTagIds: string[]
  alreadyAssignedTagIds: string[]
  tagIds: string[]
}

type UnassignmentResult = {
  targetId: string
  removedTagIds: string[]
  notAssignedTagIds: string[]
  tagIds: string[]
}

async function buildContext(
  req: Request,
): Promise<{ ctx: CommandRuntimeContext; translate: (key: string, fallback?: string) => string }> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: scope?.selectedId ?? auth.orgId ?? null,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }
  return { ctx, translate }
}

function requireAssignmentScope(
  ctx: CommandRuntimeContext,
  translate: (key: string, fallback?: string) => string,
): TagAssignmentScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  const userId = ctx.auth?.sub ?? null
  if (!tenantId || !organizationId || !userId) {
    throw new CrudHttpError(400, {
      error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
    })
  }
  return { tenantId, organizationId, userId }
}

async function handle(
  req: Request,
  commandId: string,
  operation: 'create' | 'delete',
): Promise<Response> {
  const { ctx, translate } = await buildContext(req)
  const scope = requireAssignmentScope(ctx, translate)

  const interceptors = await runTimesheetInterceptors({
    request: req,
    method: operation === 'create' ? 'POST' : 'DELETE',
    scope: {
      container: ctx.container,
      userId: scope.userId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    },
    body: await readJsonSafe<Record<string, unknown>>(req, {}),
  })
  if (!interceptors.ok) return interceptors.response
  const { session } = interceptors

  const input = parseScopedCommandInput(staffTimeTaskTagAssignmentSchema, session.body, ctx, translate)

  const access = await loadTagProjectAccess(ctx.container, scope)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  await requireAccessibleTask(em, input.taskId, scope, access, translate)

  const guardResult = await runStaffMutationGuards(
    ctx.container,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: RESOURCE_KIND,
      resourceId: input.taskId,
      operation,
      requestMethod: req.method,
      requestHeaders: req.headers,
      mutationPayload: input,
    },
  )
  if (!guardResult.ok) {
    return NextResponse.json(guardResult.errorBody ?? { error: 'Operation blocked by guard' }, {
      status: guardResult.errorStatus ?? 422,
    })
  }

  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const { result, logEntry } = await commandBus.execute<
    StaffTimeTaskTagAssignmentInput,
    AssignmentResult | UnassignmentResult
  >(commandId, { input, ctx })

  if (guardResult.afterSuccessCallbacks.length) {
    await runStaffMutationGuardAfterSuccess(guardResult.afterSuccessCallbacks, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      resourceKind: RESOURCE_KIND,
      resourceId: input.taskId,
      operation,
      requestMethod: req.method,
      requestHeaders: req.headers,
    })
  }

  // A tag write is a change to the task itself, so it travels as the task's own
  // `updated` event rather than an assignment-shaped one no subscriber knows about.
  void emitStaffEvent('staff.timesheets.time_task.updated', {
    id: input.taskId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }, { persistent: true }).catch((err) => {
    logger.error('staff.timesheets emit time_task.updated failed', { err })
  })

  const assignment = result as AssignmentResult | undefined
  const unassignment = result as UnassignmentResult | undefined
  const payload =
    operation === 'create'
      ? {
          taskId: input.taskId,
          tagIds: assignment?.tagIds ?? [],
          assignedTagIds: assignment?.assignedTagIds ?? [],
          alreadyAssignedTagIds: assignment?.alreadyAssignedTagIds ?? [],
        }
      : {
          taskId: input.taskId,
          tagIds: unassignment?.tagIds ?? [],
          removedTagIds: unassignment?.removedTagIds ?? [],
          notAssignedTagIds: unassignment?.notAssignedTagIds ?? [],
        }

  const response = await session.respond(200, payload)
  if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
    response.headers.set(
      'x-om-operation',
      serializeOperationMetadata({
        id: logEntry.id,
        undoToken: logEntry.undoToken,
        commandId: logEntry.commandId,
        actionLabel: logEntry.actionLabel ?? null,
        resourceKind: logEntry.resourceKind ?? RESOURCE_KIND,
        resourceId: logEntry.resourceId ?? input.taskId,
        executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
      }),
    )
  }
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

export async function POST(req: Request) {
  try {
    return await handle(req, staffTimeTagCommandIds.assignTask, 'create')
  } catch (err) {
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    return errorResponse(err, 'staff.timesheets.tags.task-assignments.POST failed')
  }
}

export async function DELETE(req: Request) {
  try {
    return await handle(req, staffTimeTagCommandIds.unassignTask, 'delete')
  } catch (err) {
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) {
      return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    }
    return errorResponse(err, 'staff.timesheets.tags.task-assignments.DELETE failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Task tag assignments',
  methods: {
    POST: {
      summary: 'Assign tags to a task',
      description:
        'Adds tags to a task. Idempotent — a tag the task already carries comes back in alreadyAssignedTagIds instead of failing. Refused with 404 when the task is outside the caller\'s project access.',
      requestBody: { contentType: 'application/json', schema: staffTimeTaskTagAssignmentSchema },
      responses: [{ status: 200, description: 'Tags assigned', schema: assignResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.manage' },
        { status: 404, description: 'Task not found or not accessible' },
        { status: 422, description: 'Unknown tag ids' },
      ],
    },
    DELETE: {
      summary: 'Unassign tags from a task',
      description:
        'Removes tags from a task. Idempotent — a tag the task does not carry comes back in notAssignedTagIds instead of failing.',
      requestBody: { contentType: 'application/json', schema: staffTimeTaskTagAssignmentSchema },
      responses: [{ status: 200, description: 'Tags unassigned', schema: unassignResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.manage' },
        { status: 404, description: 'Task not found or not accessible' },
      ],
    },
  },
}
