/**
 * Workflow Event Detail API
 *
 * Endpoint:
 * - GET /api/workflows/events/[id] - Get a single workflow event by ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowEvent, WorkflowInstance } from '../../../data/entities'
import { workflowEventDetailSchema } from '../../openapi'

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
 * GET /api/workflows/events/[id]
 *
 * Get a single workflow event by ID
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const params = await context.params

    const container = await createRequestContainer()
    const em = container.resolve<EntityManager>('em')
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

    // Check permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.view'],
      { tenantId, organizationId: scope?.selectedId ?? auth.orgId }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Find the event with proper filters
    const event = await em.findOne(WorkflowEvent, {
      id: params.id,
      tenantId,
      ...(organizationIds ? { organizationId: { $in: organizationIds } } : {}),
    })

    if (!event) {
      return NextResponse.json(
        { error: 'Workflow event not found' },
        { status: 404 }
      )
    }

    // Fetch related workflow instance
    const instance = await em.findOne(WorkflowInstance, {
      id: event.workflowInstanceId,
      tenantId,
      ...(organizationIds ? { organizationId: { $in: organizationIds } } : {}),
    })

    // Build response
    const response = {
      id: event.id,
      workflowInstanceId: event.workflowInstanceId,
      stepInstanceId: event.stepInstanceId,
      eventType: event.eventType,
      eventData: event.eventData,
      occurredAt: event.occurredAt.toISOString(),
      userId: event.userId,
      tenantId: event.tenantId,
      organizationId: event.organizationId,
      workflowInstance: instance ? {
        id: instance.id,
        workflowId: instance.workflowId,
        version: instance.version,
        status: instance.status,
        currentStepId: instance.currentStepId,
        correlationKey: instance.correlationKey,
        startedAt: instance.startedAt?.toISOString() || null,
        completedAt: instance.completedAt?.toISOString() || null,
        context: instance.context,
      } : null,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Error getting workflow event:', error)
    return NextResponse.json(
      { error: 'Failed to get workflow event' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow event by ID',
      description: 'Get detailed information about a specific workflow event',
      tags: ['Workflows'],
      params: z.object({
        id: z.string(),
      }),
      responses: [
        {
          status: 200,
          description: 'Workflow event details',
          schema: workflowEventDetailSchema,
        },
        {
          status: 401,
          description: 'Unauthorized',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 403,
          description: 'Insufficient permissions',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 404,
          description: 'Workflow event not found',
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
