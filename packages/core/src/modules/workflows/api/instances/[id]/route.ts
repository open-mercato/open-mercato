/**
 * Workflow Instance Detail API
 *
 * Endpoints:
 * - GET /api/workflows/instances/[id] - Get workflow instance details
 * - POST /api/workflows/instances/[id]/cancel - Cancel running instance
 * - POST /api/workflows/instances/[id]/retry - Retry failed instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowInstance } from '../../../data/entities'
import * as workflowExecutor from '../../../lib/workflow-executor'
import { workflowInstanceResponseSchema } from '../../openapi'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

interface RouteContext {
  params: Promise<{
    id: string
  }>
}

/**
 * GET /api/workflows/instances/[id]
 *
 * Get a single workflow instance by ID
 */
export async function GET(
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
    const organizationIds = (() => {
      if (scope?.selectedId) return [scope.selectedId]
      if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
      if (scope?.filterIds === null) return undefined
      if (auth.orgId) return [auth.orgId]
      return undefined
    })()

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant context' },
        { status: 400 }
      )
    }

    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      ...(organizationIds ? { organizationId: { $in: organizationIds } } : {}),
    })

    if (!instance) {
      return NextResponse.json(
        { error: 'Workflow instance not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data: instance })
  } catch (error) {
    console.error('Error getting workflow instance:', error)
    return NextResponse.json(
      { error: 'Failed to get workflow instance' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow instance',
      description: 'Get detailed information about a specific workflow instance including current state, context, and execution status.',
      tags: ['Workflows'],
      params: z.object({
        id: z.string().uuid(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow instance details',
          schema: z.object({
            data: workflowInstanceResponseSchema,
          }),
        },
        {
          status: 401,
          description: 'Unauthorized',
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
