import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ScheduledJob } from '../../../../data/entities.js'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'


export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

/**
 * GET /api/scheduler/jobs/[id]/executions
 * Fetch execution history for a schedule from BullMQ
 * 
 * Returns jobs from the scheduler-execution queue filtered by scheduleId.
 * This replaces the old /api/scheduler/runs endpoint that used the database table.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  const scheduleId = params.id

  try {
    // Verify schedule exists and user has access
    const schedule = await em.findOne(ScheduledJob, {
      id: scheduleId,
      deletedAt: null,
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    // Check tenant/org access
    if (schedule.tenantId && schedule.tenantId !== auth.tenantId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (schedule.organizationId && schedule.organizationId !== auth.orgId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if using async strategy
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    if (queueStrategy !== 'async') {
      return NextResponse.json({
        error: 'Execution history requires QUEUE_STRATEGY=async',
        message: 'Please set QUEUE_STRATEGY=async to view execution history',
        items: [],
      }, { status: 400 })
    }

    // Fetch jobs from BullMQ scheduler-execution queue
    const { Queue } = await import('bullmq')
    const queue = new Queue('scheduler-execution', { connection: { url: getRedisUrl('QUEUE') } })

    try {
      // Get completed and failed jobs
      // BullMQ doesn't have direct filtering, so we fetch recent jobs and filter client-side
      const pageSize = parseInt(req.nextUrl.searchParams.get('pageSize') || '20', 10)
      const limit = Math.min(pageSize, 100) // Cap at 100

      const [completed, failed, active, waiting, delayed] = await Promise.all([
        queue.getCompleted(0, limit - 1),
        queue.getFailed(0, limit - 1),
        queue.getActive(0, limit - 1),
        queue.getWaiting(0, limit - 1),
        queue.getDelayed(0, limit - 1),
      ])

      // Combine all jobs and filter by scheduleId
      const allJobs = [...completed, ...failed, ...active, ...waiting, ...delayed]
      const filteredJobs = allJobs
        .filter(job => {
          const data = job.data as any
          return data?.payload?.scheduleId === scheduleId || data?.scheduleId === scheduleId
        })
        .slice(0, limit)

      // Get state for each job (parallel)
      const jobsWithState = await Promise.all(
        filteredJobs.map(async (job) => {
          const state = await job.getState()
          const data = job.data as any
          
          return {
            id: job.id,
            scheduleId: data?.payload?.scheduleId || data?.scheduleId,
            startedAt: job.processedOn ? new Date(job.processedOn).toISOString() : new Date(job.timestamp).toISOString(),
            finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
            status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : state === 'active' ? 'running' : 'waiting',
            triggerType: data?.payload?.triggerType || data?.triggerType || 'scheduled',
            triggeredByUserId: data?.payload?.triggeredByUserId || data?.triggeredByUserId || null,
            errorMessage: job.failedReason || null,
            errorStack: job.stacktrace ? job.stacktrace.join('\n') : null,
            durationMs: (job.finishedOn && job.processedOn) ? (job.finishedOn - job.processedOn) : null,
            queueJobId: job.id,
            queueName: 'scheduler-execution',
            attemptsMade: job.attemptsMade,
            result: job.returnvalue,
          }
        })
      )

      // Sort by startedAt descending (most recent first)
      jobsWithState.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())

      return NextResponse.json({
        items: jobsWithState,
        total: jobsWithState.length,
        page: 1,
        pageSize: limit,
      })
    } finally {
      await queue.close()
    }

  } catch (error: any) {
    console.error('[scheduler:executions] Error fetching execution history:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch execution history' },
      { status: 500 }
    )
  }
}

// Query schemas
const executionsQuerySchema = z.object({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// Response schemas
const executionItemSchema = z.object({
  id: z.string(),
  scheduleId: z.string().uuid(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed', 'waiting']),
  triggerType: z.enum(['scheduled', 'manual']),
  triggeredByUserId: z.string().uuid().nullable(),
  errorMessage: z.string().nullable(),
  errorStack: z.string().nullable(),
  durationMs: z.number().nullable(),
  queueJobId: z.string(),
  queueName: z.string(),
  attemptsMade: z.number(),
  result: z.unknown().nullable(),
})

const executionsResponseSchema = z.object({
  items: z.array(executionItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
})

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  items: z.array(z.any()).optional(),
})

// OpenAPI specification
export const openApi: OpenApiRouteDoc = {
  tag: 'Scheduler',
  summary: 'Get execution history',
  description: 'Fetches recent execution history for a scheduled job from BullMQ.',
  methods: {
    GET: {
      operationId: 'getScheduleExecutions',
      summary: 'Get execution history for a schedule',
      description: 'Fetch recent executions from BullMQ for a scheduled job. Requires QUEUE_STRATEGY=async.',
      query: executionsQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Execution history',
          schema: executionsResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Local strategy not supported', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Schedule not found', schema: errorResponseSchema },
      ],
    },
  },
}
