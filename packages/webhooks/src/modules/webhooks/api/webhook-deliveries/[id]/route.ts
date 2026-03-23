import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findScopedDelivery, json, resolveWebhookRequestScope, serializeDeliveryDetail } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const deliveryDetailSchema = z.object({
  id: z.string(),
  webhookId: z.string(),
  eventType: z.string(),
  messageId: z.string(),
  status: z.string(),
  responseStatus: z.number().nullable(),
  errorMessage: z.string().nullable(),
  attemptNumber: z.number(),
  maxAttempts: z.number(),
  targetUrl: z.string(),
  durationMs: z.number().nullable(),
  enqueuedAt: z.string(),
  lastAttemptAt: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  createdAt: z.string(),
  payload: z.record(z.string(), z.unknown()),
  responseBody: z.string().nullable(),
  responseHeaders: z.record(z.string(), z.string()).nullable(),
  nextRetryAt: z.string().nullable(),
  updatedAt: z.string(),
})

const errorSchema = z.object({ error: z.string() })

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const delivery = await findScopedDelivery(scope.em.fork(), scope, params.id)
  if (!delivery) {
    return json({ error: 'Delivery not found' }, { status: 404 })
  }

  return json(serializeDeliveryDetail(delivery))
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Get webhook delivery detail',
  description: 'Returns a single webhook delivery record including request payload and response metadata.',
  methods: {
    GET: {
      summary: 'Get delivery',
      description: 'Returns a single delivery attempt by ID.',
      pathParams: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'Delivery detail', schema: deliveryDetailSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Delivery not found', schema: errorSchema },
      ],
    },
  },
}
