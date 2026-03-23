import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { enqueueWebhookDelivery } from '../../../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../../../lib/integration-state'
import { findScopedDelivery, json, resolveWebhookRequestScope, serializeDeliveryDetail } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const retryResponseSchema = z.object({
  success: z.literal(true),
  delivery: z.object({
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
  }),
})

const errorSchema = z.object({ error: z.string() })

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const em = scope.em.fork()
  const delivery = await findScopedDelivery(em, scope, params.id)

  if (!delivery) {
    return json({ error: 'Delivery not found' }, { status: 404 })
  }

  const integrationEnabled = await isWebhookIntegrationEnabled(em, {
    tenantId: delivery.tenantId,
    organizationId: delivery.organizationId,
  })
  if (!integrationEnabled) {
    return json({ error: 'Custom Webhooks integration is disabled' }, { status: 409 })
  }

  delivery.status = 'pending'
  delivery.nextRetryAt = null
  delivery.errorMessage = null
  await em.flush()

  await enqueueWebhookDelivery({
    deliveryId: delivery.id,
    tenantId: delivery.tenantId,
    organizationId: delivery.organizationId,
  })

  return json({
    success: true,
    delivery: serializeDeliveryDetail(delivery),
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Retry failed webhook delivery',
  description: 'Re-enqueues a webhook delivery for immediate retry.',
  methods: {
    POST: {
      summary: 'Retry delivery',
      description: 'Resets retry scheduling fields and enqueues the delivery again.',
      pathParams: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'Delivery re-enqueued', schema: retryResponseSchema }],
      errors: [
        { status: 409, description: 'Webhook integration disabled', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Delivery not found', schema: errorSchema },
      ],
    },
  },
}
