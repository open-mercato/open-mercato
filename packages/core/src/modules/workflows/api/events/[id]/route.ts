/**
 * Workflow Event Detail API
 *
 * Endpoint:
 * - GET /api/workflows/events/[id] - Get a single workflow event by ID
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowEvent, WorkflowInstance } from '../../../data/entities'

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
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Check permission
    const rbacService = container.resolve('rbacService')
    const hasPermission = await rbacService.userHasAllFeatures(
      auth.sub,
      ['workflows.instances.view'],
      { tenantId, organizationId }
    )

    if (!hasPermission) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      )
    }

    // Find the event - first try without org filter to debug
    const eventAny = await em.findOne(WorkflowEvent, {
      id: params.id,
    })

    // Find the event with proper filters
    const event = await em.findOne(WorkflowEvent, {
      id: params.id,
      tenantId,
      organizationId,
    })

    if (!event) {
      return NextResponse.json(
        {
          error: 'Workflow event not found',
          debug: process.env.NODE_ENV === 'development' ? {
            requestedId: params.id,
            requestedTenantId: tenantId,
            requestedOrganizationId: organizationId,
            eventExists: !!eventAny,
            eventTenantId: eventAny?.tenantId,
            eventOrganizationId: eventAny?.organizationId,
          } : undefined
        },
        { status: 404 }
      )
    }

    // Fetch related workflow instance
    const instance = await em.findOne(WorkflowInstance, {
      id: event.workflowInstanceId,
      tenantId,
      organizationId,
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
          schema: z.object({
            id: z.string(),
            workflowInstanceId: z.string(),
            stepInstanceId: z.string().nullable(),
            eventType: z.string(),
            eventData: z.any(),
            occurredAt: z.string(),
            userId: z.string().nullable(),
            workflowInstance: z.object({
              id: z.string(),
              workflowId: z.string(),
              version: z.number(),
              status: z.string(),
              currentStepId: z.string(),
              correlationKey: z.string().nullable(),
              startedAt: z.string().nullable(),
              completedAt: z.string().nullable(),
              context: z.any(),
            }).nullable(),
          }),
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
