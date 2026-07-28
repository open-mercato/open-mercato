/**
 * User Task Claim API
 *
 * Endpoints:
 * - POST /api/workflows/tasks/[id]/claim - Claim a task from role queue
 */

import { NextRequest, NextResponse } from 'next/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { TaskHandlerService } from '../../../../lib/task-handler'
import { gateTaskAction } from '../../../../lib/task-visibility-request'
import {
  workflowsTag,
  userTaskClaimResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.claim'],
}

/**
 * POST /api/workflows/tasks/[id]/claim
 *
 * Claim a user task from a role queue
 *
 * This allows a user to claim a task that's assigned to their role(s).
 * Once claimed, the task moves to IN_PROGRESS status and is assigned to the claiming user.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
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
        { status: 400 }
      )
    }

    // §6.4 runs BEFORE the handler, and that ordering is the disclosure fix:
    // `claimUserTask` reports `TASK_ALREADY_ASSIGNED` before it checks queue
    // membership, so a caller with no relationship to the task used to learn
    // that it exists from the status code alone. Now they get the same 404 a
    // nonexistent id produces, and the handler still owns membership, the
    // compare-and-set and every error code below.
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

    // Call task handler to claim task
    const taskHandler = container.resolve<TaskHandlerService>('taskHandler')
    // Role names are server-derived (`auth.roles`), never read off the request —
    // a caller who holds none of the task's queues is refused as "not found".
    await taskHandler.claimUserTask(
      em,
      params.id,
      auth.sub,
      { tenantId, organizationId },
      auth.roles ?? [],
    )

    // Fetch updated task
    const { UserTask } = await import('../../../../data/entities')
    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found after claim' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      data: task,
      message: 'Task claimed successfully',
    })
  } catch (error) {
    logger.error('Error claiming user task', { err: error })

    // Keyed on the handler's error CODE rather than on substrings of its
    // message. The old message matching had no arm for `TASK_NOT_ROLE_ASSIGNED`
    // ("Task is not assigned to any roles" contains neither "not found" nor
    // "already"), so a task with an empty queue answered 500.
    const code = (error as { code?: unknown } | null)?.code
    if (code === 'TASK_NOT_FOUND') {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 })
    }
    if (code === 'TASK_ALREADY_ASSIGNED' || code === 'TASK_NOT_ROLE_ASSIGNED') {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 })
    }

    return NextResponse.json(
      {
        error: 'Failed to claim user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Claim user task',
  methods: {
    POST: {
      summary: 'Claim a task from role queue',
      description: 'Allows a user to claim a task assigned to their role(s). Once claimed, the task moves to IN_PROGRESS status and is assigned to the claiming user.',
      responses: [
        { status: 200, description: 'Task claimed successfully', schema: userTaskClaimResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant or organization context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'The task is visible to the caller but is not theirs to act on — it has no assignee and no role queue, so it must be reassigned first (§6.4: administration widens seeing, never acting).', schema: workflowErrorSchema },
        { status: 404, description: 'Task not found, or not visible to the caller', schema: workflowErrorSchema },
        { status: 409, description: 'Task already claimed', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
