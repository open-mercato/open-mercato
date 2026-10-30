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
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { StaffTimeTask } from '../../data/entities'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../api/guards'
import {
  staffTimeTaskAssignmentCommandIds,
  type StaffTimeTaskAssignmentInput,
  type StaffTimeTaskAssignmentResult,
} from '../../commands/timesheets-task-assignment'
import { resolveFeatureAccess } from './featureAccess'
import { assertProjectAccess } from './access'
import { resolveListProjectAccess } from './listProjectAccess'

export type TaskAssignmentAction = keyof typeof staffTimeTaskAssignmentCommandIds

export const TASK_ASSIGNMENT_VIEW_FEATURE = 'staff.timesheets.tasks.view'

const FAILURE_CODES: Record<TaskAssignmentAction, string> = {
  claim: 'staff.task_claim_failed',
  release: 'staff.task_release_failed',
}

export type TaskAssignmentRouteContext = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>
}

export const taskAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  timeProjectId: z.string().uuid(),
  assigneeStaffMemberId: z.string().uuid().nullable(),
  updatedAt: z.string().nullable(),
})

async function resolveTaskId(req: Request, action: TaskAssignmentAction, context?: TaskAssignmentRouteContext): Promise<string | null> {
  const params = context?.params ? await context.params : null
  const fromParams = params?.id
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams
  try {
    const match = new URL(req.url).pathname.match(new RegExp(`/tasks/([^/]+)/${action}`))
    return match?.[1] ?? null
  } catch {
    return null
  }
}

/**
 * The `POST /api/staff/timesheets/tasks/{id}/claim|release` handler. Both actions
 * share every step — scope, project access (the tasks list rule), optimistic lock,
 * mutation guards, the command and the undo header — and differ only in the command.
 */
export function createTaskAssignmentPostHandler(action: TaskAssignmentAction) {
  const logger = createLogger('staff').child({ component: `api/timesheets/tasks/${action}` })
  return async function POST(req: Request, context?: TaskAssignmentRouteContext): Promise<Response> {
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
      const taskId = await resolveTaskId(req, action, context)
      if (!taskId || !z.string().uuid().safeParse(taskId).success) {
        throw new CrudHttpError(400, { error: translate('staff.time_tracking.tasks.errors.idRequired', 'Task id is required.') })
      }

      const actorId = auth.sub ?? ''
      const viewAccess = await resolveFeatureAccess(container, actorId, [TASK_ASSIGNMENT_VIEW_FEATURE], { tenantId, organizationId })
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
        staffTimeTaskAssignmentCommandIds[action],
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
      logger.error(`staff.timesheets.tasks.${action} POST failed`, { err })
      getTelemetryRuntime()?.reportError(err, { module: 'staff', code: FAILURE_CODES[action] })
      return NextResponse.json({ error: translate('staff.errors.internal', 'Internal server error') }, { status: 500 })
    }
  }
}
