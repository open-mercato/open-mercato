import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getRedisUrl, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'


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
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: translate('scheduler.error.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const { jobId } = params

  // Validate query params with Zod schema
  const queryResult = queueJobQuerySchema.safeParse({
    queue: req.nextUrl.searchParams.get('queue') ?? undefined,
  })
  if (!queryResult.success) {
    return NextResponse.json(
      { error: translate('scheduler.error.queue_param_required', 'queue parameter required') },
      { status: 400 }
    )
  }
  const queueName = queryResult.data.queue

  // Validate queue name against registered module queues
  const registeredQueues = new Set(
    getModules().flatMap((m) => m.workers?.map((w) => w.queue) ?? [])
  )
  if (!registeredQueues.has(queueName)) {
    return NextResponse.json(
      { error: translate('scheduler.error.invalid_queue_name', 'Invalid queue name') },
      { status: 400 }
    )
  }

  try {
    // Check if using async strategy
    const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
    if (queueStrategy !== 'async') {
      return NextResponse.json({
        error: translate('scheduler.error.bullmq_required', 'BullMQ job logs are only available with QUEUE_STRATEGY=async'),
        available: false,
      }, { status: 400 })
    }

    // Fetch job from BullMQ
    const { Queue } = await import('bullmq')
    const queue = new Queue(queueName, { connection: parseRedisUrl(getRedisUrl('QUEUE')) })

    const job = await queue.getJob(jobId)

    if (!job) {
      await queue.close()
      return NextResponse.json(
        { error: translate('scheduler.error.job_not_found', 'Job not found in BullMQ (may have been removed)') },
        { status: 404 }
      )
    }

    // Validate tenant/org access from job data
    const jobData = job.data as Record<string, unknown> | undefined
    const jobPayload = jobData?.payload as Record<string, unknown> | undefined

    // Resolve tenant/org IDs from job data (may be nested in payload)
    const jobTenantId = jobData?.tenantId ?? jobPayload?.tenantId ?? null
    const jobOrgId = jobData?.organizationId ?? jobPayload?.organizationId ?? null

    // System-scoped jobs (no tenantId/orgId) require superadmin
    const isSuperAdmin = Array.isArray(auth.roles) && auth.roles.some(
      (role) => typeof role === 'string' && role.trim().toLowerCase() === 'superadmin'
    )
    if (!jobTenantId && !jobOrgId && !isSuperAdmin) {
      await queue.close()
      return NextResponse.json({ error: translate('scheduler.error.forbidden', 'Forbidden') }, { status: 403 })
    }

    // Deny access to jobs belonging to a different tenant
    if (jobTenantId && auth.tenantId && jobTenantId !== auth.tenantId) {
      await queue.close()
      return NextResponse.json({ error: translate('scheduler.error.forbidden', 'Forbidden') }, { status: 403 })
    }

    // Deny access to jobs belonging to a different organization
    if (jobOrgId && auth.orgId && jobOrgId !== auth.orgId) {
      await queue.close()
      return NextResponse.json({ error: translate('scheduler.error.forbidden', 'Forbidden') }, { status: 403 })
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
  } catch (error: unknown) {
    console.error('[scheduler:queue-jobs] Error fetching job:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : translate('scheduler.error.fetch_job_failed', 'Failed to fetch job details') },
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
