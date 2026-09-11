/**
 * User Task Reassignment API
 *
 * Endpoints:
 * - POST /api/workflows/tasks/[id]/reassign - Move a task to another assignee or role queue
 *
 * This is the act half of §6.4's central asymmetry. `workflows.tasks.view_all`
 * lets an administrator SEE a colleague's task and never lets them finish it, so
 * the sanctioned path to acting on somebody else's work is to take it first —
 * here — and the taking is permanently recorded on the audit columns plus a
 * `WorkflowEvent`.
 *
 * It is also the documented remedy for the one shape the model leaves
 * uncompletable: a task with no assignee, no claim and no role queue belongs to
 * nobody, so the act routes answer `TASK_NOT_ACTIONABLE` and name this endpoint.
 * The gate below therefore checks VISIBILITY, never ownership — requiring
 * ownership would make the unrescuable task unrescuable by definition.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TaskHandlerService } from '../../../../lib/task-handler'
import { gateTaskAction } from '../../../../lib/task-visibility-request'
import { reassignUserTaskSchema } from '../../../../data/validators'
import { serializeUserTask } from '../../serialize'
import {
  workflowsTag,
  userTaskReassignResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'

const logger = createLogger('workflows')

/**
 * `UserTask` is deliberately absent from the curated optimistic-lock entity
 * list, and `optimistic-lock-ui-coverage.test.ts` only matches `PUT`/`PATCH`/
 * `DELETE`, so nothing enforces the header here automatically. The route honours
 * it explicitly: a client that sends `x-om-ext-optimistic-lock-expected-updated-at`
 * gets the same structured 409 every CRUD surface returns, and one that does not
 * is unaffected (the helper is a no-op without the header).
 */
const REASSIGN_RESOURCE_KIND = 'workflows.user_task'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.reassign'],
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em')
    const auth = await getAuthFromRequest(request)

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
    const tenantId = auth.tenantId
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 },
      )
    }

    let payload: unknown
    try {
      payload = await request.json()
    } catch {
      payload = {}
    }

    const parsed = reassignUserTaskSchema.safeParse(payload)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.issues },
        { status: 400 },
      )
    }

    // Visibility only — see the file header. A `workflows.tasks.reassign` holder
    // depends on `workflows.tasks.view_all`, so an administrator reaches every
    // row in scope, including the ownerless one this endpoint exists to rescue.
    const gate = await gateTaskAction({
      container,
      em,
      auth: { userId: auth.sub, tenantId, roleNames: auth.roles ?? [] },
      taskId: params.id,
      organizationId,
    })

    if (!gate.allowed) {
      return NextResponse.json(gate.refusal.body, { status: gate.refusal.status })
    }

    enforceCommandOptimisticLock({
      resourceKind: REASSIGN_RESOURCE_KIND,
      resourceId: gate.task.id,
      current: gate.task.updatedAt,
      request,
    })

    const taskHandler = container.resolve<TaskHandlerService>('taskHandler')
    const task = await taskHandler.reassignUserTask(em, {
      taskId: params.id,
      userId: auth.sub,
      target: {
        assignedTo: parsed.data.assignedTo,
        assignedToRoles: parsed.data.assignedToRoles,
      },
      reason: parsed.data.reason,
      scope: { tenantId, organizationId },
    })

    return NextResponse.json({
      data: serializeUserTask(task),
      message: 'Task reassigned successfully',
    })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }

    const code = (error as { code?: unknown } | null)?.code
    if (code === 'TASK_NOT_FOUND') {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 })
    }
    if (code === 'TASK_NOT_REASSIGNABLE') {
      return NextResponse.json(
        { error: (error as Error).message, code: 'TASK_NOT_REASSIGNABLE' },
        { status: 409 },
      )
    }

    logger.error('Error reassigning user task', { err: error })
    return NextResponse.json(
      {
        error: 'Failed to reassign user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Reassign user task',
  methods: {
    POST: {
      summary: 'Move a task to another assignee or role queue',
      description:
        'Records who moved the task, when, and why (`reassignedBy` / `reassignedAt` / `reassignReason`) and logs a `USER_TASK_REASSIGNED` workflow event. Requires `workflows.tasks.reassign`. An in-flight claim is released and an IN_PROGRESS task returns to PENDING; the status vocabulary is unchanged. Honours the optimistic-lock header `x-om-ext-optimistic-lock-expected-updated-at`.',
      requestBody: { schema: reassignUserTaskSchema },
      responses: [
        {
          status: 200,
          description: 'Task reassigned successfully',
          schema: userTaskReassignResponseSchema,
        },
      ],
      errors: [
        {
          status: 400,
          description: 'Missing tenant/organization context, or a body naming neither an assignee nor a role queue',
          schema: workflowErrorSchema,
        },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        {
          status: 403,
          description: 'Visible to the caller but refused by the entity gate, with the blocking entity type named',
          schema: workflowErrorSchema,
        },
        { status: 404, description: 'Task not found, or not visible to the caller', schema: workflowErrorSchema },
        {
          status: 409,
          description: 'Task is in a terminal status, or the record changed since it was loaded (optimistic lock)',
          schema: workflowErrorSchema,
        },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
