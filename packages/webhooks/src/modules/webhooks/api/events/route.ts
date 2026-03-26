import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getDeclaredEvents } from '@open-mercato/shared/modules/events'
import { json } from '../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
}

const eventDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  category: z.enum(['crud', 'lifecycle', 'system', 'custom']).optional(),
  module: z.string().optional(),
  entity: z.string().optional(),
  excludeFromTriggers: z.boolean().optional(),
})

const eventsResponseSchema = z.object({
  data: z.array(eventDefinitionSchema),
  total: z.number().int().nonnegative(),
})

export async function GET(): Promise<Response> {
  const events = getDeclaredEvents()
    .filter((event) => !event.id.startsWith('webhooks.'))
    .sort((left, right) => left.id.localeCompare(right.id))

  return json({
    data: events,
    total: events.length,
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List available webhook events',
  description: 'Returns all declared platform events that can be subscribed to by webhook endpoints.',
  methods: {
    GET: {
      summary: 'List webhook events',
      description: 'Returns all declared non-webhook events, sorted by event id.',
      responses: [{ status: 200, description: 'Available events', schema: eventsResponseSchema }],
    },
  },
}
