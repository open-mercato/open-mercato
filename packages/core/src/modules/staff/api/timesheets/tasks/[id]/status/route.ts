/**
 * The Kanban drag of screen 6 (US-C2), and the drawer's subtask tick, which is the
 * same move without a meaningful position.
 *
 * The board writes optimistically — the card lands in the new column before the
 * request completes — so this endpoint's contract is what makes the rollback in the
 * mockup's note 2 correct:
 *
 *  1. **The `updated_at` version travels with the drag.** Two people moving the same
 *     card is the one genuinely likely conflict on this board, so a stale
 *     `x-om-ext-optimistic-lock-expected-updated-at` answers 409 and the client puts
 *     the card back where it came from instead of overwriting the other move.
 *  2. **Project access is intersected before anything else is revealed.** The access
 *     decision reuses the tasks list route's memoised resolver, and a caller who is
 *     not a member gets the same 404 a missing task gets — the body never confirms
 *     the task exists.
 *  3. **The target column must belong to the task's own project.** A foreign column
 *     is refused by the command (422) rather than quietly accepted, because a task
 *     lives in exactly one project (§2) and its board is that project's.
 *
 * The write itself is the `staff.timesheets.tasks.status_change` command, which owns
 * the `closed_at` stamping and emits `staff.timesheets.time_task.status_changed`.
 */

import { NextResponse } from 'next/server'
import { resolveFeatureAccess } from '../../../../../lib/time-tracking/featureAccess'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { authorizeFeatures } from '@open-mercato/shared/security/featurePolicy'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { StaffTimeTask } from '../../../../../data/entities'
import { staffTimeTaskStatusChangeSchema } from '../../../../../data/validators'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { STAFF_TIME_TRACKING_RESOURCE_KINDS } from '../../../../guards'
import { runTimesheetInterceptors } from '../../../_shared/withTimesheetInterceptors'
import {
  staffTimeTaskCommandIds,
  type StaffTimeTaskStatusChangeCommandInput,
  type StaffTimeTaskStatusChangeResult,
} from '../../../../../commands/timesheets-tasks'
import { assertProjectAccess } from '../../../../../lib/time-tracking/access'
import { resolveListProjectAccess } from '../../route'

const logger = createLogger('staff').child({ component: 'api/timesheets/tasks/status' })

const MANAGE_FEATURE = 'staff.timesheets.tasks.manage'

export const metadata = {
  PATCH: { requireAuth: true, requireFeatures: [MANAGE_FEATURE] },
}

type RouteContext = {
  params?: Promise<Record<string, string | string[]>> | Record<string, string | string[]>
}

type RbacServiceLike = {
  getGrantedFeatures?: (
    userId: string,
    options: { tenantId: string | null; organizationId: string | null },
  ) => Promise<string[]>
}

function extractTaskIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/tasks\/([^/]+)\/status/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

async function resolveTaskId(req: Request, context?: RouteContext): Promise<string | null> {
  const params = context?.params ? await context.params : null
  const fromParams = params?.id
  if (typeof fromParams === 'string' && fromParams.length > 0) return fromParams
  return extractTaskIdFromUrl(req)
}

/**
 * Granted features power both the explicit manage check and the feature gating inside
 * the mutation-guard registry. Returns null when RBAC cannot be consulted, in which
 * case the declarative `requireFeatures` guard in `metadata` remains the
 * authorization source.
 */
async function resolveGrantedFeatures(
  container: Awaited<ReturnType<typeof createRequestContainer>>,
  userId: string,
  tenantId: string,
  organizationId: string | null,
): Promise<string[] | null> {
  try {
    const rbac = container.resolve('rbacService') as RbacServiceLike | undefined
    if (!rbac?.getGrantedFeatures) return null
    return await rbac.getGrantedFeatures(userId, { tenantId, organizationId })
  } catch {
    return null
  }
}

export async function PATCH(req: Request, context?: RouteContext): Promise<Response> {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('staff.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope?.tenantId ?? auth.tenantId ?? null
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(400, {
        error: translate('staff.errors.missingScope', 'Missing tenant or organization scope.'),
      })
    }

    const taskId = await resolveTaskId(req, context)
    if (!taskId || !z.string().uuid().safeParse(taskId).success) {
      throw new CrudHttpError(400, {
        error: translate('staff.time_tracking.tasks.errors.idRequired', 'Task id is required.'),
      })
    }

    const actorId = auth.sub ?? ''
    const grantedFeatures = await resolveGrantedFeatures(container, actorId, tenantId, organizationId)
    // Checked unconditionally. The `grantedFeatures &&` this replaces turned the
    // check off whenever the grant read failed — harmless here only because the
    // route metadata happens to require the same feature, which is exactly the
    // shape that leaked rates on the report routes where no such backstop existed.
    if (!(await resolveFeatureAccess(container, actorId, [MANAGE_FEATURE], { tenantId, organizationId })).allowed) {
      throw forbidden(translate('staff.errors.forbidden', 'Forbidden'))
    }

    const interceptors = await runTimesheetInterceptors({
      request: req,
      method: 'PATCH',
      scope: { container, userId: actorId, tenantId, organizationId, userFeatures: grantedFeatures },
      body: await readJsonSafe<Record<string, unknown>>(req, {}),
    })
    if (!interceptors.ok) return interceptors.response
    const { session } = interceptors

    const parsed = staffTimeTaskStatusChangeSchema.parse(session.body)

    const routeCtx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    }

    // Membership is resolved against the task's project, so the lookup has to happen
    // here. Both "no such task" and "not your project" answer with the same body.
    const em = (container.resolve('em') as EntityManager).fork()
    const task = await em.findOne(StaffTimeTask, { id: taskId, tenantId, organizationId, deletedAt: null })
    const access = task ? await resolveListProjectAccess(routeCtx) : null
    if (!task || !access || !assertProjectAccess(access, task.timeProjectId)) {
      throw new CrudHttpError(404, {
        error: translate('staff.time_tracking.tasks.errors.notFound', 'Task not found or not accessible.'),
      })
    }

    const guardResult = await runRouteMutationGuards({
      container,
      req,
      auth: {
        userId: actorId,
        tenantId,
        organizationId,
        userFeatures: grantedFeatures ?? undefined,
      },
      input: {
        resourceKind: STAFF_TIME_TRACKING_RESOURCE_KINDS.timeTask,
        resourceId: taskId,
        operation: 'update',
        mutationPayload: parsed,
      },
    })
    if (!guardResult.ok) return guardResult.response

    const effective = guardResult.modifiedPayload
      ? staffTimeTaskStatusChangeSchema.parse({ ...parsed, ...guardResult.modifiedPayload })
      : parsed

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result, logEntry } = await commandBus.execute<
      StaffTimeTaskStatusChangeCommandInput,
      StaffTimeTaskStatusChangeResult
    >(staffTimeTaskCommandIds.statusChange, {
      input: { ...effective, id: taskId },
      ctx: routeCtx,
    })

    await guardResult.runAfterSuccess()

    const response = await session.respond(200, {
      id: result?.taskId ?? taskId,
      timeProjectId: result?.timeProjectId ?? task.timeProjectId,
      previousTaskStatusId: result?.previousTaskStatusId ?? null,
      taskStatusId: result?.taskStatusId ?? effective.taskStatusId,
      position: result?.position ?? null,
      closedAt: result?.closedAt ?? null,
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
    logger.error('staff.timesheets.tasks.status PATCH failed', { err })
    return NextResponse.json(
      { error: translate('staff.errors.internal', 'Internal server error') },
      { status: 500 },
    )
  }
}

const statusChangeResponseSchema = z.object({
  id: z.string().uuid(),
  timeProjectId: z.string().uuid(),
  previousTaskStatusId: z.string().uuid().nullable(),
  taskStatusId: z.string().uuid(),
  position: z.number().int().nullable(),
  closedAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

const conflictSchema = z.object({
  code: z.literal('optimistic_lock_conflict'),
  error: z.string(),
  currentUpdatedAt: z.string(),
  expectedUpdatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Staff',
  summary: 'Move a task to another board column',
  methods: {
    PATCH: {
      summary: 'Move a task to another board column',
      description:
        'Moves a task to the requested status column and slot. `position` is optional — omitting it appends the task to the end of the target column, which is what the drawer subtask tick does. The target status must belong to the task project (422 otherwise). Landing on a done column stamps `closedAt`, leaving one clears it. Send the record version in `x-om-ext-optimistic-lock-expected-updated-at`: a stale version answers 409 so an optimistic board can roll the card back to its origin column. Emits `staff.timesheets.time_task.status_changed`, which is bridged to connected boards.',
      requestBody: {
        contentType: 'application/json',
        schema: staffTimeTaskStatusChangeSchema,
      },
      responses: [{ status: 200, description: 'Task moved', schema: statusChangeResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid task id or body' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing staff.timesheets.tasks.manage' },
        { status: 404, description: 'Task not found, or not on a project the caller can see' },
        { status: 409, description: 'The task changed since the version the caller sent', schema: conflictSchema },
        { status: 422, description: 'The target column does not belong to this project' },
      ],
    },
  },
}
