/**
 * Workflow Instance Events API
 *
 * Endpoint:
 * - GET /api/workflows/instances/[id]/events - Get event history for a workflow instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { WorkflowInstance, WorkflowEvent } from '../../../../data/entities'

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
 * GET /api/workflows/instances/[id]/events
 *
 * Get event history for a workflow instance
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
    const organizationId = scope?.selectedId ?? auth.orgId

    if (!tenantId || !organizationId) {
      return NextResponse.json(
        { error: 'Missing tenant or organization context' },
        { status: 400 }
      )
    }

    // Verify instance exists and belongs to tenant
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

    const { searchParams } = new URL(request.url)
    const eventType = searchParams.get('eventType')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')

    // Build where clause
    const where: any = {
      workflowInstanceId: params.id,
      tenantId,
      organizationId,
    }

    if (eventType) {
      where.eventType = eventType
    }

    const [events, total] = await em.findAndCount(
      WorkflowEvent,
      where,
      {
        orderBy: { occurredAt: 'DESC' },
        limit,
        offset,
      }
    )

    return NextResponse.json({
      data: events,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    })
  } catch (error) {
    console.error('Error getting workflow events:', error)
    return NextResponse.json(
      { error: 'Failed to get workflow events' },
      { status: 500 }
    )
  }
}

export const openApi = {
  methods: {
    GET: {
      summary: 'Get workflow instance events',
      description: 'Get a chronological list of events for a workflow instance. Events track all state changes, transitions, and activities.',
      tags: ['Workflows'],
      params: z.object({
        id: z.string().uuid(),
      }),
      query: z.object({
        eventType: z.string().optional(),
        limit: z.number().int().positive().default(100).optional(),
        offset: z.number().int().min(0).default(0).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of workflow events',
          schema: z.object({
            data: z.array(z.any()),
            pagination: z.object({
              total: z.number(),
              limit: z.number(),
              offset: z.number(),
              hasMore: z.boolean(),
            }),
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
