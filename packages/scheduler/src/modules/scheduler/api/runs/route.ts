import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJobRun } from '../../data/entities.js'
import { scheduleRunsQuerySchema } from '../../data/validators.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

/**
 * GET /api/scheduler/runs
 * List execution history
 */
export async function GET(req: NextRequest) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<any>('auth')

  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const queryParams = Object.fromEntries(url.searchParams.entries())
  
  try {
    const query = scheduleRunsQuerySchema.parse(queryParams)

    // Build filters
    const filters: Record<string, any> = {}

    if (query.scheduledJobId) {
      filters.scheduledJobId = { $eq: query.scheduledJobId }
    }

    if (query.status) {
      filters.status = { $eq: query.status }
    }

    if (query.triggerType) {
      filters.triggerType = { $eq: query.triggerType }
    }

    if (query.fromDate) {
      filters.startedAt = { ...filters.startedAt, $gte: new Date(query.fromDate) }
    }

    if (query.toDate) {
      filters.startedAt = { ...filters.startedAt, $lte: new Date(query.toDate) }
    }

    // Tenant isolation
    if (auth.tenantId) {
      filters.tenantId = { $eq: auth.tenantId }
    }

    // Organization scope if not super admin
    if (!auth.isSuperAdmin && auth.organizationId) {
      filters.organizationId = { $eq: auth.organizationId }
    }

    // Get total count
    const total = await em.count(ScheduledJobRun, filters)

    // Get paginated data
    const offset = (query.page - 1) * query.pageSize
    const sortField = query.sort || 'startedAt'
    const sortOrder = query.order || 'desc'

    const runs = await em.find(
      ScheduledJobRun,
      filters,
      {
        limit: query.pageSize,
        offset,
        orderBy: { [sortField]: sortOrder },
      }
    )

    return NextResponse.json({
      data: runs,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.ceil(total / query.pageSize),
    })
  } catch (error) {
    console.error('[scheduler:runs] Error listing runs:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list runs' },
      { status: 400 }
    )
  }
}

// OpenAPI specification
export const openApi = {
  GET: {
    tags: ['Scheduler'],
    summary: 'List schedule execution history',
    description: 'Get a paginated list of schedule execution runs',
    parameters: [
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      { name: 'scheduledJobId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['running', 'completed', 'failed', 'skipped'] } },
      { name: 'triggerType', in: 'query', schema: { type: 'string', enum: ['scheduled', 'manual'] } },
      { name: 'fromDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
      { name: 'toDate', in: 'query', schema: { type: 'string', format: 'date-time' } },
    ],
    responses: {
      200: {
        description: 'List of schedule runs',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                data: { type: 'array', items: { type: 'object' } },
                total: { type: 'integer' },
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
}
