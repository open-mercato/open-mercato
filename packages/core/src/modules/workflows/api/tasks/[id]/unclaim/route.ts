/**
 * User Task Unclaim API
 *
 * Endpoints:
 * - POST /api/workflows/tasks/[id]/unclaim - Release a claimed task back to its
 *   role queue
 *
 * The counterpart of `claim`. New route, so purely additive
 * (BACKWARD_COMPATIBILITY.md §7); gated on the same `workflows.tasks.claim`
 * feature, because releasing your own claim is part of claiming rather than a
 * separate authority.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TaskHandlerService } from '../../../../lib/task-handler'
import { gateTaskAction } from '../../../../lib/task-visibility-request'
import { serializeUserTask } from '../../serialize'
import { UserTask } from '../../../../data/entities'
import {
  workflowsTag,
  userTaskClaimResponseSchema,
  workflowErrorSchema,
} from '../../../openapi'

const logger = createLogger('workflows')

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.claim'],
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
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

    // §6.4 first, so a caller with no relationship to the task cannot tell a
    // claimed task from a nonexistent one. The handler still enforces that the
    // caller IS the claimant, with the same compare-and-set.
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

    const taskHandler = container.resolve<TaskHandlerService>('taskHandler')
    await taskHandler.releaseUserTask(em, params.id, auth.sub, { tenantId, organizationId })

    const task = await em.findOne(UserTask, { id: params.id, tenantId, organizationId })

    if (!task) {
      return NextResponse.json({ error: 'Task not found after release' }, { status: 500 })
    }

    return NextResponse.json({
      data: serializeUserTask(task),
      message: 'Task released successfully',
    })
  } catch (error) {
    logger.error('Error releasing user task', { err: error })

    const code = (error as { code?: unknown } | null)?.code
    if (code === 'TASK_NOT_FOUND') {
      return NextResponse.json({ error: (error as Error).message }, { status: 404 })
    }
    if (code === 'TASK_ASSIGNED_TO_ANOTHER_USER') {
      return NextResponse.json({ error: (error as Error).message }, { status: 409 })
    }

    return NextResponse.json(
      {
        error: 'Failed to release user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: workflowsTag,
  summary: 'Release user task',
  methods: {
    POST: {
      summary: 'Release a claimed task back to its role queue',
      description:
        'Clears the caller\'s claim and returns the task to PENDING so another holder of the queued role can pick it up. Refused when the task is claimed by somebody else or is no longer in progress.',
      responses: [
        { status: 200, description: 'Task released successfully', schema: userTaskClaimResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing tenant or organization context', schema: workflowErrorSchema },
        { status: 401, description: 'Unauthorized', schema: workflowErrorSchema },
        { status: 403, description: 'The task is visible to the caller but is not theirs to act on — it has no assignee and no role queue, so it must be reassigned first (§6.4: administration widens seeing, never acting).', schema: workflowErrorSchema },
        { status: 404, description: 'Task not found, not visible to the caller, or not claimed', schema: workflowErrorSchema },
        { status: 409, description: 'Task claimed by another user', schema: workflowErrorSchema },
        { status: 500, description: 'Internal server error', schema: workflowErrorSchema },
      ],
    },
  },
}
