/**
 * Workflow Events API
 *
 * Endpoint:
 * - GET /api/workflows/events - List all workflow events with filtering and pagination
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { EntityManager } from '@mikro-orm/postgresql'
import { WorkflowEvent, WorkflowInstance } from '../../data/entities'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['workflows.instances.view'],
}

/**
 * GET /api/workflows/events
 *
 * List all workflow events with filtering and pagination
 */
export async function GET(request: NextRequest) {
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

    const { searchParams } = new URL(request.url)

    // Pagination
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '50')
    const offset = (page - 1) * pageSize

    // Filters
    const eventType = searchParams.get('eventType')
    const workflowInstanceId = searchParams.get('workflowInstanceId')
    const userId = searchParams.get('userId')
    const occurredAtFrom = searchParams.get('occurredAtFrom')
    const occurredAtTo = searchParams.get('occurredAtTo')

    // Sorting
    const sortField = searchParams.get('sortField') || 'occurredAt'
    const sortDir = (searchParams.get('sortDir') || 'desc').toLowerCase() as 'asc' | 'desc'

    // Build where clause
    const where: any = {
      tenantId,
      organizationId,
    }

    if (eventType) {
      where.eventType = eventType
    }

    if (workflowInstanceId) {
      where.workflowInstanceId = workflowInstanceId
    }

    if (userId) {
      where.userId = userId
    }

    if (occurredAtFrom || occurredAtTo) {
      where.occurredAt = {}
      if (occurredAtFrom) {
        where.occurredAt.$gte = new Date(occurredAtFrom)
      }
      if (occurredAtTo) {
        where.occurredAt.$lte = new Date(occurredAtTo)
      }
    }

    // Query events
    const [events, total] = await em.findAndCount(
      WorkflowEvent,
      where,
      {
        orderBy: { [sortField]: sortDir },
        limit: pageSize,
        offset,
      }
    )

    // Fetch related workflow instances for display
    const instanceIds = [...new Set(events.map(e => e.workflowInstanceId))]
    const instances = await em.find(WorkflowInstance, {
      id: { $in: instanceIds },
      tenantId,
      organizationId,
    })

    const instanceMap = new Map(instances.map(i => [i.id, i]))

    // Enrich events with workflow instance info
    const enrichedEvents = events.map(event => ({
      id: String(event.id), // Convert BigInt to string for JSON serialization
      workflowInstanceId: event.workflowInstanceId,
      stepInstanceId: event.stepInstanceId,
      eventType: event.eventType,
      eventData: event.eventData,
      occurredAt: event.occurredAt,
      userId: event.userId,
      workflowInstance: instanceMap.get(event.workflowInstanceId) ? {
        id: instanceMap.get(event.workflowInstanceId)!.id,
        workflowId: instanceMap.get(event.workflowInstanceId)!.workflowId,
        workflowName: instanceMap.get(event.workflowInstanceId)!.workflowId, // Use workflowId as name
        status: instanceMap.get(event.workflowInstanceId)!.status,
      } : null,
    }))

    const totalPages = Math.ceil(total / pageSize)

    return NextResponse.json({
      items: enrichedEvents,
      total,
      page,
      pageSize,
      totalPages,
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
      summary: 'List all workflow events',
      description: 'Get a paginated list of all workflow events with filtering options',
      tags: ['Workflows'],
      query: z.object({
        page: z.number().int().positive().default(1).optional(),
        pageSize: z.number().int().positive().default(50).optional(),
        eventType: z.string().optional(),
        workflowInstanceId: z.string().uuid().optional(),
        userId: z.string().optional(),
        occurredAtFrom: z.string().datetime().optional(),
        occurredAtTo: z.string().datetime().optional(),
        sortField: z.enum(['occurredAt', 'eventType']).default('occurredAt').optional(),
        sortDir: z.enum(['asc', 'desc']).default('desc').optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'List of workflow events',
          schema: z.object({
            items: z.array(z.any()),
            total: z.number(),
            page: z.number(),
            pageSize: z.number(),
            totalPages: z.number(),
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
          status: 500,
          description: 'Internal server error',
          schema: z.object({ error: z.string() }),
        },
      ],
    },
  },
}
