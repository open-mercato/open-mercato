import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createWebhookDelivery, processWebhookDeliveryJob } from '../../../../lib/delivery'
import { isWebhookIntegrationEnabled } from '../../../../lib/integration-state'
import { findScopedWebhook, json, resolveWebhookRequestScope, serializeDeliveryDetail } from '../../../helpers'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['webhooks.test'] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const requestBodySchema = z.object({
  eventType: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
})

const testResponseSchema = z.object({
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
  const webhook = await findScopedWebhook(em, scope, params.id)

  if (!webhook) {
    return json({ error: 'Webhook not found' }, { status: 404 })
  }

  const integrationEnabled = await isWebhookIntegrationEnabled(em, {
    tenantId: webhook.tenantId,
    organizationId: webhook.organizationId,
  })
  if (!integrationEnabled) {
    return json({ error: 'Custom Webhooks integration is disabled' }, { status: 409 })
  }

  const parsed = requestBodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const delivery = await createWebhookDelivery({
    em,
    webhook,
    eventId: parsed.data.eventType ?? 'webhooks.test.ping',
    payload: parsed.data.payload ?? {
      ping: true,
      webhookId: webhook.id,
      testedAt: new Date().toISOString(),
    },
  })

  await processWebhookDeliveryJob(em, {
    deliveryId: delivery.id,
    tenantId: delivery.tenantId,
    organizationId: delivery.organizationId,
  }, { scheduleRetries: false })

  await em.refresh(delivery)

  return json({
    success: true,
    delivery: serializeDeliveryDetail(delivery),
  })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Send test webhook delivery',
  description: 'Creates and sends a synchronous test delivery for a webhook endpoint.',
  methods: {
    POST: {
      summary: 'Test webhook',
      description: 'Creates a synthetic event payload and delivers it immediately without using the queue.',
      pathParams: z.object({ id: z.string().uuid() }),
      requestBody: {
        contentType: 'application/json',
        schema: requestBodySchema,
        description: 'Optional custom event type and payload for the test delivery.',
      },
      responses: [{ status: 200, description: 'Test delivery result', schema: testResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid request payload', schema: errorSchema },
        { status: 409, description: 'Webhook integration disabled', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Webhook not found', schema: errorSchema },
      ],
    },
  },
}
