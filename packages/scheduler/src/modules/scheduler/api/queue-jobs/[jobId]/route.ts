import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getRedisUrlOrThrow, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { ScheduledJob } from '../../../data/entities.js'
import { resolveScheduleAccess } from '../../../lib/scheduleAccess.js'

const logger = createLogger('scheduler').child({ component: 'queue-jobs' })


export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

const SCHEDULER_MODULE_ID = 'scheduler'

/**
 * Only the scheduler module's own worker queues are inspectable here (#9141).
 * A generic queue inspector is out of scope: BullMQ job ids are sequential
 * integers, so accepting any module's queue would let a scheduler.jobs.view
 * holder walk another module's queue and read its payloads. Queue ownership is
 * resolved from the live registry, never parsed from queue or worker ids.
 */
function isSchedulerOwnedQueue(queueName: string): boolean {
  return getModules().some((mod) =>
    mod.id === SCHEDULER_MODULE_ID && (mod.workers ?? []).some((worker) => worker.queue === queueName))
}

/**
 * GET /api/scheduler/queue-jobs/[jobId]
 * Fetch BullMQ job details and logs for a scheduled execution
 *
 * Query params:
 * - queue: Queue name (required; only queues owned by the scheduler module)
 *
 * Note: This endpoint returns job data from BullMQ directly. A job is readable
 * only when it sits on a scheduler-owned queue and its schedule passes
 * `resolveScheduleAccess` — the same per-schedule tenant/organization/scope
 * isolation the executions route applies (#9141).
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

  // Refuse queues this module does not own (#9141)
  if (!isSchedulerOwnedQueue(queueName)) {
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
    const queue = new Queue(queueName, {
      connection: parseRedisUrl(getRedisUrlOrThrow('QUEUE')),
    })

    try {
      const job = await queue.getJob(jobId)

      if (!job) {
        return NextResponse.json(
          { error: translate('scheduler.error.job_not_found', 'Job not found in BullMQ (may have been removed)') },
          { status: 404 }
        )
      }

      // Per-schedule isolation (#9141): the job's own tenant/org payload fields
      // are enqueue-time copies, so the schedule row is the authority. Load it
      // by id alone, then apply the same access decision as the executions
      // route. A job without a resolvable schedule fails closed.
      const jobData = job.data as { payload?: { scheduleId?: unknown }; scheduleId?: unknown } | null | undefined
      const scheduleId = jobData?.payload?.scheduleId ?? jobData?.scheduleId ?? null
      const schedule = scheduleIdSchema.safeParse(scheduleId).success
        ? await loadSchedule(String(scheduleId))
        : null

      if (!schedule) {
        return NextResponse.json(
          { error: translate('scheduler.error.not_found', 'Schedule not found') },
          { status: 404 }
        )
      }

      const access = resolveScheduleAccess(schedule, auth)
      if (access === 'not_found') {
        return NextResponse.json(
          { error: translate('scheduler.error.not_found', 'Schedule not found') },
          { status: 404 }
        )
      }
      if (access === 'forbidden') {
        return NextResponse.json(
          { error: translate('scheduler.error.access_denied', 'Access denied') },
          { status: 403 }
        )
      }

      // Get job state and logs
      const state = await job.getState()
      const logs = await queue.getJobLogs(jobId)

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
    } finally {
      await queue.close()
    }
  } catch (error: unknown) {
    logger.error('Error fetching job', { err: error })
    try {
      getTelemetryRuntime()?.reportError(error, { module: 'scheduler', code: 'scheduler.fetch_job_failed' })
    } catch (telemetryError) {
      logger.warn('Failed to report queue job error to telemetry', { err: telemetryError })
    }
    return NextResponse.json(
      { error: translate('scheduler.error.fetch_job_failed', 'Failed to fetch job details') },
      { status: 500 }
    )
  }
}

async function loadSchedule(scheduleId: string) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  // Load by id alone, then apply isolation to the loaded row. Folding the
  // actor's tenant/org into the lookup would make system-scoped schedules
  // unmatchable, the same reason the executions route loads this way.
  return em.findOne(ScheduledJob, { id: scheduleId, deletedAt: null })
}

// Query schemas
const queueJobQuerySchema = z.object({
  queue: z.string(),
})

const scheduleIdSchema = z.guid()

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
      description: 'Fetch detailed information and logs for a scheduled execution queue job. Only scheduler-owned queues are accepted, and the job is readable only when its schedule passes schedule access checks. Requires QUEUE_STRATEGY=async.',
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
        { status: 404, description: 'Job or schedule not found', schema: errorResponseSchema },
        { status: 500, description: 'Internal server error', schema: errorResponseSchema },
      ],
    },
  },
}