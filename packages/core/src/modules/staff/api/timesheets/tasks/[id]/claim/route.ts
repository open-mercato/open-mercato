import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeTask } from '../../../../../data/entities'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../../guards'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { assertProjectAccess } from '../../../../../lib/time-tracking/access'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import {
  staffTimeTaskAssignmentCommandIds,
  type StaffTimeTaskAssignmentInput,
  type StaffTimeTaskAssignmentResult,
} from '../../../../../commands/timesheets-task-assignment'
import { resolveListProjectAccess } from '../../route'

const ACTION = 'claim'
const VIEW_FEATURE = 'staff.timesheets.tasks.view'
const logger = createLogger('staff').child({ component: `api/timesheets/tasks/${ACTION}` })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: [VIEW_FEATURE] },
}

type RouteContext = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>
}

async function resolveTaskId(req: Request, context?: RouteContext): Promise<string | null> {
  const params = context?.params ? await context.params : null
  const fromParams = params?.id
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams
  try {
    const match = new URL(req.url).pathname.match(new RegExp(`/tasks/([^/]+)/${ACTION}`))
    return match?.[1] ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request, context?: RouteContext): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, { error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.') })
    }
    const taskId = await resolveTaskId(req, context)
    if (!taskId || !z.string().uuid().safeParse(taskId).success) {
      throw new CrudHttpError(400, { error: translate('staff.time_tracking.tasks.errors.idRequired', 'Task id is required.') })
    }

    const actorId = auth.sub ?? ''
    const viewAccess = await resolveFeatureAccess(container, actorId, [VIEW_FEATURE], { tenantId, organizationId })
    if (!viewAccess.allowed) throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))

    const routeCtx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(StaffTimeTask, { id: taskId, tenantId, organizationId, deletedAt: null })
    const access = task ? await resolveListProjectAccess(routeCtx) : null
    if (!task || !access || !assertProjectAccess(access, task.timeProjectId)) {
      throw new CrudHttpError(404, {
        error: translate('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.'),
      })
    }

    await enforceCommandOptimisticLockWithGuards(container, {
      resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeTask,
      resourceId: task.id,
      current: task.updatedAt,
      request: req,
    })

    const input: StaffTimeTaskAssignmentInput = { id: taskId }
    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: actorId, tenantId, organizationId, userFeatures: viewAccess.grantedFeatures },
      input: {
        resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeTask,
        resourceId: taskId,
        operation: 'update',
        mutationPayload: input,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<StaffTimeTaskAssignmentInput, StaffTimeTaskAssignmentResult>(
      staffTimeTaskAssignmentCommandIds.claim,
      { input, ctx: routeCtx },
    )
    await guardResult.runAfterSuccess()

    const response = NextResponse.json({
      id: result?.taskId ?? taskId,
      timeProjectId: result?.timeProjectId ?? task.timeProjectId,
      assigneeStaffMemberId: result?.assigneeStaffMemberId ?? null,
      updatedAt: result?.updatedAt ?? null,
    })
    if (logEntry?.undoToken && logEntry?.id && logEntry?.commandId) {
      response.headers.set(
        'x-om-operation',
        serializeOperationMetadata({
          id: logEntry.id,
          undoToken: logEntry.undoToken,
          commandId: logEntry.commandId,
          actionLabel: logEntry.actionLabel ?? null,
          resourceKind: logEntry.resourceKind ?? STAFF_TIME_TRACKING_RESOURCE_KINDS.timeTask,
          resourceId: logEntry.resourceId ?? taskId,
          executedAt: logEntry.createdAt instanceof Date ? logEntry.createdAt.toISOString() : undefined,
        }),
      )
    }
    return response
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    const { translate } = await resolveTranslations()
    logger.error(`staff.timesheets.tasks.${ACTION} POST failed`, { err })
    return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
  }
}

const responseSchema = z.object({
  id: z.string().uuid(),
  timeProjectId: z.string().uuid(),
  assigneeStaffMemberId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Claim an unassigned task',
  methods: {
    POST: {
      summary: 'Claim an unassigned task',
      description: 'Sets the caller as the assignee of an unassigned, not-done task. Only active assigners of the task project (a project member flagged as assigner, inside the assignment window) may claim; `staff.timesheets.tasks.manage` is not required. The update is conditional on the task still being unassigned, so of two concurrent claims exactly one wins and the other answers 409. Accepts `x-om-ext-optimistic-lock-expected-updated-at`.',
      responses: [{ status: 200, description: 'Claim an unassigned task', schema: responseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'The caller is not an active assigner of the project' },
        { status: 404, description: 'Task not found, or not on a project the caller can see' },
        { status: 409, description: 'The task was already claimed, or changed since the version the caller sent' },
        { status: 422, description: 'The task is in a done status' },
      ],
    },
  },
}
