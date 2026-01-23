import { NextRequest, NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import { ScheduledJob, ScheduledJobRun } from '../../data/entities.js'
import { scheduleTriggerSchema } from '../../data/validators.js'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.trigger'],
}

/**
 * POST /api/scheduler/trigger
 * Manually trigger a schedule
 */
export async function POST(req: NextRequest) {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const auth = container.resolve<any>('auth')

  if (!auth?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    if (!auth.isSuperAdmin && schedule.organizationId && schedule.organizationId !== auth.organizationId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Create run record
    const run = em.create(ScheduledJobRun, {
      scheduledJobId: schedule.id,
      organizationId: schedule.organizationId || null,
      tenantId: schedule.tenantId || null,
      triggerType: 'manual',
      triggeredByUserId: input.userId || auth.userId,
      status: 'running',
      payload: schedule.targetPayload,
      startedAt: new Date(),
      createdAt: new Date(),
    })
    em.persist(run)
    await em.flush()

    try {
      // Enqueue job
      if (schedule.targetType === 'queue' && schedule.targetQueue) {
        // Resolve queue from container
        const queueName = schedule.targetQueue
        const queue = container.resolve<Queue<any>>(`${queueName}Queue`)
        
        if (!queue) {
          throw new Error(`Queue not found: ${queueName}`)
        }

        const jobId = await queue.enqueue({
          ...(schedule.targetPayload ?? {}),
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        })

        run.queueJobId = jobId
        run.queueName = schedule.targetQueue
      }

      // Mark as completed
      run.status = 'completed'
      run.finishedAt = new Date()
      run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime()
      await em.flush()

      return NextResponse.json({
        ok: true,
        runId: run.id,
        queueJobId: run.queueJobId,
      })
    } catch (error) {
      // Log error
      run.status = 'failed'
      run.errorMessage = error instanceof Error ? error.message : 'Unknown error'
      run.errorStack = error instanceof Error ? error.stack : undefined
      run.finishedAt = new Date()
      run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime()
      await em.flush()

      return NextResponse.json(
        {
          error: 'Failed to trigger schedule',
          message: error instanceof Error ? error.message : 'Unknown error',
          runId: run.id,
        },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('[scheduler:trigger] Error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to trigger schedule' },
      { status: 400 }
    )
  }
}

// OpenAPI specification
export const openApi = {
  POST: {
    tags: ['Scheduler'],
    summary: 'Manually trigger a schedule',
    description: 'Execute a schedule immediately, bypassing the normal schedule time',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              userId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    },
    responses: {
      200: {
        description: 'Schedule triggered successfully',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                runId: { type: 'string', format: 'uuid' },
                queueJobId: { type: 'string' },
              },
            },
          },
        },
      },
      404: {
        description: 'Schedule not found',
      },
      403: {
        description: 'Access denied',
      },
    },
  },
}
