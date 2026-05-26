/**
 * Events registry API — returns declared events from module `events.ts` files.
 *
 * Uses the globally registered event configs (populated during bootstrap). Data
 * leaked here (event ids, module ids, entity ids, clientBroadcast/portalBroadcast
 * flags) is recon-grade and MUST NOT be served to anonymous callers; the route
 * is protected by the standard `[...slug]` dispatcher with `requireAuth: true`.
 * Consumer: `packages/ui/src/backend/inputs/EventSelect.tsx` (workflow triggers,
 * business rules, webhook config).
 */

import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'

export const metadata = {
  path: '/events',
  GET: { requireAuth: true },
}

const eventDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  category: z.enum(['crud', 'lifecycle', 'system', 'custom']).optional(),
  module: z.string().optional(),
  entity: z.string().optional(),
  excludeFromTriggers: z.boolean().optional(),
  clientBroadcast: z.boolean().optional(),
  portalBroadcast: z.boolean().optional(),
})

const eventsResponseSchema = z.object({
  data: z.array(eventDefinitionSchema),
  total: z.number().int().nonnegative(),
})

export async function GET(req: Request): Promise<Response> {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const moduleId = searchParams.get('module')
  const excludeTriggerExcluded = searchParams.get('excludeTriggerExcluded') !== 'false'

  let filteredEvents = getDeclaredEvents()

  if (excludeTriggerExcluded) {
    filteredEvents = filteredEvents.filter((e) => !e.excludeFromTriggers)
  }
  if (category) {
    filteredEvents = filteredEvents.filter((e) => e.category === category)
  }
  if (moduleId) {
    filteredEvents = filteredEvents.filter((e) => e.module === moduleId)
  }

  return Response.json({
    data: filteredEvents,
    total: filteredEvents.length,
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List declared platform events',
  description: 'Returns all declared platform events from every enabled module. Supports optional category and module filters.',
  methods: {
    GET: {
      summary: 'List declared events',
      description: 'Returns every declared event. Filters: category, module, excludeTriggerExcluded (default true).',
      responses: [{ status: 200, description: 'Declared events', schema: eventsResponseSchema }],
    },
  },
}
