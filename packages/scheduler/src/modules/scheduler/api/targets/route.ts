import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { commandRegistry } from '@open-mercato/shared/lib/commands'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

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
    .sort()
    .map((queue) => ({ value: queue, label: queue }))

  const commands = commandRegistry
    .list()
    .sort()
    .map((id) => ({ value: id, label: id }))

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
  description: 'Returns available queue names and registered command IDs for schedule target selection.',
  methods: {
    GET: {
      operationId: 'listScheduleTargets',
      summary: 'List available queues and commands',
      description: 'Returns all registered queue names (from module workers) and command IDs (from the command registry) that can be used as schedule targets.',
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
