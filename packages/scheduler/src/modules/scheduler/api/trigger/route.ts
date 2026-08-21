import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { scheduleTriggerSchema } from '../../data/validators.js'
import type { TriggerScheduleResult } from '../../commands/trigger.js'
import type { ScheduleTriggerInput } from '../../data/validators.js'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'trigger' })

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
 *
 * The handler is a thin mapper: `scheduler.jobs.trigger` owns loading the
 * schedule, deciding access, checking the queue strategy and enqueueing, so that
 * every authenticated attempt — refusals included — leaves an action-log entry
 * attributed to the caller. Expected refusals come back as an `outcome`, never as
 * an exception, because a throwing handler would skip the audit write entirely.
 */
export async function POST(req: NextRequest) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  // No actor means nothing to attribute, so this is the one path that
  // legitimately leaves no action-log entry.
  if (!auth?.sub) {
    return NextResponse.json({ error: translate('scheduler.error.unauthorized', 'Unauthorized') }, { status: 401 })
  }

  const container = await createRequestContainer()

  try {
    const body = await req.json()
    // Parsed before the command runs, so a malformed body still answers 400 with
    // the validation message and the command never sees unvalidated input.
    const input = scheduleTriggerSchema.parse(body)

    // Null organization scope is the supported non-CRUD shape (see
    // `ensureOrganizationScope`), and the scheduler's own worker and
    // `localSchedulerService` build their contexts the same way. The trigger
    // command performs its isolation through `resolveScheduleAccess` on the loaded
    // row, so the only consumer of these fields is the action-log row's scope.
    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: auth.orgId ? [auth.orgId] : null,
      request: req,
    }

    const commandBus = container.resolve<CommandBus>('commandBus')
    const { result } = await commandBus.execute<ScheduleTriggerInput, TriggerScheduleResult>(
      'scheduler.jobs.trigger',
      { input, ctx },
    )

    if (result.outcome === 'not_found') {
      return NextResponse.json({ error: translate('scheduler.error.not_found', 'Schedule not found') }, { status: 404 })
    }

    if (result.outcome === 'forbidden') {
      return NextResponse.json({ error: translate('scheduler.error.access_denied', 'Access denied') }, { status: 403 })
    }

    if (result.outcome === 'strategy_unsupported') {
      return NextResponse.json(
        {
          error: translate('scheduler.error.trigger_async_required', 'Manual trigger requires QUEUE_STRATEGY=async'),
          message: translate('scheduler.error.trigger_async_hint', 'Execution history and manual triggers are only available with BullMQ (async strategy)')
        },
        { status: 400 }
      )
    }

    if (result.outcome === 'failed') {
      return NextResponse.json(
        { error: result.error ?? translate('scheduler.error.trigger_failed', 'Failed to trigger schedule') },
        { status: 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      jobId: result.queueJobId, // BullMQ job ID
      message: translate('scheduler.success.triggered', 'Schedule queued for execution'),
    })

  } catch (error) {
    // The action log is written after the enqueue, and the bus does not guard that
    // write, so a failing audit store surfaces here with the job already queued.
    // Record it loudly: the run stays traceable even when its entry was lost.
    logger.error('Manual trigger failed', { err: error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : translate('scheduler.error.trigger_failed', 'Failed to trigger schedule') },
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
  description: 'Execute a schedule immediately by enqueueing it in the scheduler-execution queue. Requires QUEUE_STRATEGY=async. Every authenticated attempt, including refusals, is recorded in the action log against the calling user.',
  methods: {
    POST: {
      operationId: 'triggerScheduledJob',
      summary: 'Manually trigger a schedule',
      description: 'Executes a scheduled job immediately, bypassing the scheduled time. Only works with async queue strategy. The attempt is audited against the calling user whether it succeeds, is refused, or fails.',
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
