import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listSchedulerSafeCommands } from '../../lib/scheduler-safe-commands'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['scheduler.jobs.view'],
}

/**
 * GET /api/scheduler/targets
 * Returns available queue names and command IDs for schedule target selection.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const modules = getModules()

  const queueSet = new Set<string>()
  for (const mod of modules) {
    if (mod.workers) {
      for (const worker of mod.workers) {
        queueSet.add(worker.queue)
      }
    }
  }

  const queues = Array.from(queueSet)
    .sort((a, b) => a.localeCompare(b))
    .map((queue) => ({ value: queue, label: queue }))

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
      description: 'Returns all registered queue names (from module workers) and explicitly scheduler-safe command IDs that can be used as schedule targets.',
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
