/**
 * User Task Claim API
 *
 * Endpoints:
 * - POST /api/workflows/tasks/[id]/claim - Claim a task from role queue
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { claimUserTask } from '../../../../lib/task-handler'

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

    // Call task handler to claim task
    await claimUserTask(em, params.id, auth.sub)

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
    console.error('Error claiming user task:', error)

    // Handle specific error codes from task-handler
    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        return NextResponse.json(
          { error: error.message },
          { status: 404 }
        )
      }
      if (error.message.includes('already')) {
        return NextResponse.json(
          { error: error.message },
          { status: 409 }
        )
      }
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
