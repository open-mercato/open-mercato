import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getRedisConnection } from '../../../lib/redisConnection.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

/**
 * GET /api/scheduler/queue-jobs/[jobId]
 * Fetch BullMQ job details and logs
 * 
 * Query params:
 * - queue: Queue name (required)
 * 
 * Note: This endpoint returns job data from BullMQ directly.
 * Tenant/org isolation is enforced at the queue level (jobs contain tenant/org IDs in their data).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { jobId } = params
  const queueName = req.nextUrl.searchParams.get('queue')

  if (!queueName) {
    return NextResponse.json(
      { error: 'queue parameter required' },
      { status: 400 }
    )
  }

  try {
    // Check if using async strategy
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    if (queueStrategy !== 'async') {
      return NextResponse.json({
        error: 'BullMQ job logs are only available with QUEUE_STRATEGY=async',
        available: false,
      }, { status: 400 })
    }

    // Fetch job from BullMQ
    const { Queue } = await import('bullmq')
    const connection = getRedisConnection()
    const queue = new Queue(queueName, { connection })

    const job = await queue.getJob(jobId)

    if (!job) {
      await queue.close()
      return NextResponse.json(
        { error: 'Job not found in BullMQ (may have been removed)' },
        { status: 404 }
      )
    }

    // Validate tenant/org access from job data
    // When a user has a tenantId, deny access to jobs belonging to a different tenant.
    const jobData = job.data as Record<string, unknown> | undefined
    if (auth.tenantId && jobData?.tenantId && jobData.tenantId !== auth.tenantId) {
      await queue.close()
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // When a user has an orgId, deny access to jobs belonging to a different organization.
    if (auth.orgId && jobData?.organizationId && jobData.organizationId !== auth.orgId) {
      await queue.close()
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Get job state and logs
    const state = await job.getState()
    const logs = await queue.getJobLogs(jobId)

    await queue.close()

    return NextResponse.json({
      id: job.id,
      name: job.name,
      data: job.data,
      state,
      progress: job.progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn ? new Date(job.processedOn).toISOString() : null,
      finishedOn: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
      logs: logs.logs || [],
    })
  } catch (error: any) {
    console.error('[scheduler:queue-jobs] Error fetching job:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch job details' },
      { status: 500 }
    )
  }
}

// Query schemas
const queueJobQuerySchema = z.object({
  queue: z.string(),
})

// Response schemas
const queueJobResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  data: z.unknown(),
  state: z.enum(['waiting', 'active', 'completed', 'failed', 'delayed', 'waiting-children']),
  progress: z.number().nullable(),
  returnvalue: z.unknown().nullable(),
  failedReason: z.string().nullable(),
  stacktrace: z.array(z.string()).nullable(),
  attemptsMade: z.number(),
  processedOn: z.string().nullable(),
  finishedOn: z.string().nullable(),
  logs: z.array(z.string()),
})

const errorResponseSchema = z.object({
  error: z.string(),
  available: z.boolean().optional(),
})

// OpenAPI specification
export const openApi: OpenApiRouteDoc = {
  tag: 'Scheduler',
  summary: 'Get BullMQ job details',
  description: 'Fetches detailed information and logs for a queue job from BullMQ.',
  methods: {
    GET: {
      operationId: 'getQueueJobDetails',
      summary: 'Get BullMQ job details and logs',
      description: 'Fetch detailed information and logs for a queue job. Requires QUEUE_STRATEGY=async.',
      query: queueJobQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Job details and logs',
          schema: queueJobResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request or local strategy not supported', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Job not found', schema: errorResponseSchema },
        { status: 500, description: 'Internal server error', schema: errorResponseSchema },
      ],
    },
  },
}
