import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findScopedWebhook, json, resolveWebhookRequestScope, serializeWebhookDetail } from '../../helpers'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
}

interface RouteContext {
  params: Promise<{ id: string }>
}

const webhookDetailResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  subscribedEvents: z.array(z.string()),
  httpMethod: z.string(),
  isActive: z.boolean(),
  deliveryStrategy: z.string(),
  maxRetries: z.number(),
  consecutiveFailures: z.number(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customHeaders: z.record(z.string(), z.string()).nullable(),
  strategyConfig: z.record(z.string(), z.unknown()).nullable(),
  timeoutMs: z.number(),
  rateLimitPerMinute: z.number(),
  autoDisableThreshold: z.number(),
  integrationId: z.string().nullable(),
  maskedSecret: z.string(),
  previousSecretSetAt: z.string().nullable(),
})

const errorSchema = z.object({ error: z.string() })

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const webhook = await findScopedWebhook(scope.em.fork(), scope, params.id)

  if (!webhook) {
    return json({ error: 'Webhook not found' }, { status: 404 })
  }

  return json(serializeWebhookDetail(webhook))
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Get webhook detail',
  description: 'Returns a single webhook configuration for the current tenant scope.',
  methods: {
    GET: {
      summary: 'Get webhook',
      description: 'Returns webhook configuration, masked secret metadata, and delivery settings.',
      pathParams: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'Webhook detail', schema: webhookDetailResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Webhook not found', schema: errorSchema },
      ],
    },
  },
}
