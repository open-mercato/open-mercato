/**
 * User Task Detail API
 *
 * Endpoints:
 * - GET /api/workflows/tasks/[id] - Get task details
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { UserTask } from '../../../data/entities'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.tasks.view'],
}

/**
 * GET /api/workflows/tasks/[id]
 *
 * Get user task details by ID
 */
export async function GET(
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

    const task = await em.findOne(UserTask, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      data: task,
    })
  } catch (error) {
    console.error('Error fetching user task:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch user task',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}
