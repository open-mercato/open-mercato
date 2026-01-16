/**
 * Cancel Workflow Instance API
 *
 * Endpoint:
 * - POST /api/workflows/instances/[id]/cancel - Cancel a running workflow instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowInstance } from '../../../../data/entities'
import * as workflowExecutor from '../../../../lib/workflow-executor'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.cancel'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * POST /api/workflows/instances/[id]/cancel
 *
 * Cancel a running workflow instance
 */
export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    const params = await context.params
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

    // Check cancel permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.cancel'],
      {
        tenantId,
        organizationId,
      }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!instance) {
      return NextResponse.json(
        { error: 'Workflow instance not found' },
        { status: 404 }
      )
    }

    // Check if instance can be cancelled
    if (instance.status !== 'RUNNING' && instance.status !== 'PAUSED') {
      return NextResponse.json(
        {
          error: `Cannot cancel workflow in ${instance.status} status. Only RUNNING or PAUSED workflows can be cancelled.`,
        },
        { status: 400 }
      )
    }

    // Cancel the workflow
    await workflowExecutor.completeWorkflow(em, container, params.id, 'CANCELLED')

    // Reload instance to get updated state
    await em.refresh(instance)

    return NextResponse.json({
      data: instance,
      message: 'Workflow cancelled successfully',
    })
  } catch (error) {
    console.error('Error cancelling workflow instance:', error)
    return NextResponse.json(
      { error: 'Failed to cancel workflow instance' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    POST: {
      summary: 'Cancel workflow instance',
      description: 'Cancel a running or paused workflow instance. The workflow will be marked as CANCELLED and will not execute further.',
      tags: ['Workflows'],
      params: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow cancelled successfully',
          schema: z.object({
            data: z.any(),
            message: z.string(),
          }),
        },
        {
          status: 400,
          description: 'Bad request - Workflow cannot be cancelled in current status',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 403,
          description: 'Forbidden - Insufficient permissions',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Workflow instance not found',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 500,
          description: 'Internal server error',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
