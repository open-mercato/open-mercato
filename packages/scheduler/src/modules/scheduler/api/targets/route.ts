import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listSchedulerSafeCommands } from '../../lib/scheduler-safe-commands'
import { listSchedulerSafeQueueTargets } from '../../lib/safeQueueTargets'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

/**
 * GET /api/scheduler/targets
 * Returns scheduler-safe queue names and command IDs for schedule target selection.
 * Only queues whose workers opted into scheduling (`schedulerSafe: true`) are
 * advertised; internal and system-only workers stay undiscoverable (#5213).
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const queues = listSchedulerSafeQueueTargets()
    .map((target) => ({ value: target.queue, label: target.queue }))

  const commands = listSchedulerSafeCommands()
    .filter((command) => commandRegistry.has(command.commandId))
    .map((command) => ({ value: command.commandId, label: command.commandId }))

  return NextResponse.json({ queues, commands })
}

// Response schemas
const targetOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

const targetsResponseSchema = z.object({
  queues: z.array(targetOptionSchema),
  commands: z.array(targetOptionSchema),
})

const errorResponseSchema = z.object({
  error: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Scheduler',
  summary: 'List available schedule targets',
  description: 'Returns available queue names and scheduler-safe command IDs for schedule target selection.',
  methods: {
    GET: {
      operationId: 'listScheduleTargets',
      summary: 'List available queues and commands',
      responses: [
        {
          status: 200,
          description: 'Available targets',
          schema: targetsResponseSchema,
        },
      ],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
      ],
    },
  },
}
