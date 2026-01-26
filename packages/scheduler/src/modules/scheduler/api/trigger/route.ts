import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createQueue } from '@open-mercato/queue'
import { ScheduledJob } from '../../data/entities.js'
import { scheduleTriggerSchema } from '../../data/validators.js'
import type { ExecuteSchedulePayload } from '../../workers/execute-schedule.worker.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.trigger'],
}

/**
 * POST /api/scheduler/trigger
 * Manually trigger a schedule
 * 
 * This enqueues the schedule execution job in BullMQ.
 * Execution history is tracked in BullMQ job state.
 */
export async function POST(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.sub) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')

  try {
    const body = await req.json()
    const input = scheduleTriggerSchema.parse(body)

    // Find the schedule
    const schedule = await em.findOne(ScheduledJob, {
      id: input.id,
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

    // Check if using async queue strategy
    const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
    
    if (queueStrategy !== 'async') {
      return NextResponse.json(
        { 
          error: 'Manual trigger requires QUEUE_STRATEGY=async',
          message: 'Execution history and manual triggers are only available with BullMQ (async strategy)'
        },
        { status: 400 }
      )
    }

    // Enqueue execution job to scheduler-execution queue
    const executionQueue = createQueue<ExecuteSchedulePayload>('scheduler-execution', queueStrategy, {
      connection: { url: process.env.REDIS_URL || process.env.QUEUE_REDIS_URL },
    })

    const payload: ExecuteSchedulePayload = {
      scheduleId: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      scopeType: schedule.scopeType,
      triggerType: 'manual',
      triggeredByUserId: input.userId || auth.sub,
    }

    const jobId = await executionQueue.enqueue(payload)
    await executionQueue.close()

    console.log('[scheduler:trigger] Manually triggered schedule:', {
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      jobId,
      triggeredBy: input.userId || auth.sub,
    })

    return NextResponse.json({
      ok: true,
      jobId, // BullMQ job ID
      message: 'Schedule queued for execution',
    })

  } catch (error) {
    console.error('[scheduler:trigger] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger schedule' },
      { status: 400 }
    )
  }
}

// Response schemas
const triggerResponseSchema = z.object({
  ok: z.boolean(),
  jobId: z.string(),
  message: z.string(),
})

const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
})

// OpenAPI specification
export const openApi: OpenApiRouteDoc = {
  tag: 'Scheduler',
  summary: 'Manually trigger a schedule',
  description: 'Execute a schedule immediately by enqueueing it in the scheduler-execution queue. Requires QUEUE_STRATEGY=async.',
  methods: {
    POST: {
      operationId: 'triggerScheduledJob',
      summary: 'Manually trigger a schedule',
      description: 'Executes a scheduled job immediately, bypassing the scheduled time. Only works with async queue strategy.',
      requestBody: {
        schema: scheduleTriggerSchema,
        contentType: 'application/json',
      },
      responses: [
        {
          status: 200,
          description: 'Schedule triggered successfully',
          schema: triggerResponseSchema,
        },
      ],
      errors: [
        { status: 400, description: 'Invalid request or local strategy not supported', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 403, description: 'Access denied', schema: errorResponseSchema },
        { status: 404, description: 'Schedule not found', schema: errorResponseSchema },
      ],
    },
  },
}
