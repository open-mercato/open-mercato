/**
 * Workflow Instance Events API
 *
 * Endpoint:
 * - GET /api/workflows/instances/[id]/events - Get event history for a workflow instance
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { workflowListPaginationSchema } from '../../../../data/validators'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { WorkflowInstance, WorkflowEvent } from '../../../../data/entities'
import { workflowEventRowSchema, paginationSchema } from '../../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('workflows')

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
    const orgFilter = resolveOrganizationScopeFilter(scope, auth)

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenant context' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(request.url)
    const eventType = searchParams.get('eventType')
    const pagination = workflowListPaginationSchema.safeParse({
      limit: searchParams.get('limit') ?? 100,
      offset: searchParams.get('offset') ?? undefined,
    })
    if (!pagination.success) {
      return NextResponse.json({ error: pagination.error.message }, { status: 400 })
    }
    const { limit, offset } = pagination.data

    // Verify instance exists and belongs to tenant
    const instance = await em.findOne(WorkflowInstance, {
      id: params.id,
      tenantId,
      ...orgFilter.where,
    })

    if (!instance) {
      return NextResponse.json(
        { error: 'Workflow instance not found' },
        { status: 404 }
      )
    }

    // Build where clause
    const where: any = {
      workflowInstanceId: params.id,
      tenantId,
      ...orgFilter.where,
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
    logger.error('Error getting workflow events', { err: error })
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
        limit: workflowListPaginationSchema.shape.limit.default(100),
        offset: workflowListPaginationSchema.shape.offset,
      }),
      responses: [
        {
          status: 400,
          description: 'Invalid pagination: page size must be an integer from 1 to 100 and offset an integer from 0 to 100000.',
          schema: z.object({ error: z.string() }),
        },
        {
          status: 200,
          description: 'List of workflow events',
          schema: z.object({
            data: z.array(workflowEventRowSchema),
            pagination: paginationSchema,
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
