import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { emitWebhooksEvent } from '../../../events'
import { findScopedWebhook, json, resolveWebhookRequestScope, serializeWebhookDetail } from '../../helpers'
import { webhookUpdateSchema } from '../../../data/validators'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['webhooks.view'] },
  PUT: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['webhooks.manage'] },
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
const deleteResponseSchema = z.object({ success: z.literal(true) })

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

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const em = scope.em.fork()
  const webhook = await findScopedWebhook(em, scope, params.id)

  if (!webhook) {
    return json({ error: 'Webhook not found' }, { status: 404 })
  }

  const parsed = webhookUpdateSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return json({ error: 'Invalid request payload' }, { status: 400 })
  }

  const input = parsed.data
  if (input.name !== undefined) webhook.name = input.name
  if (input.description !== undefined) webhook.description = input.description
  if (input.url !== undefined) webhook.url = input.url
  if (input.subscribedEvents !== undefined) webhook.subscribedEvents = input.subscribedEvents
  if (input.httpMethod !== undefined) webhook.httpMethod = input.httpMethod
  if (input.customHeaders !== undefined) webhook.customHeaders = input.customHeaders
  if (input.deliveryStrategy !== undefined) webhook.deliveryStrategy = input.deliveryStrategy
  if (input.strategyConfig !== undefined) webhook.strategyConfig = input.strategyConfig
  if (input.maxRetries !== undefined) webhook.maxRetries = input.maxRetries
  if (input.timeoutMs !== undefined) webhook.timeoutMs = input.timeoutMs
  if (input.rateLimitPerMinute !== undefined) webhook.rateLimitPerMinute = input.rateLimitPerMinute
  if (input.autoDisableThreshold !== undefined) webhook.autoDisableThreshold = input.autoDisableThreshold
  if (input.integrationId !== undefined) webhook.integrationId = input.integrationId
  if (input.isActive !== undefined) webhook.isActive = input.isActive

  await em.flush()

  await emitWebhooksEvent('webhooks.webhook.updated', {
    webhookId: webhook.id,
    organizationId: webhook.organizationId,
    tenantId: webhook.tenantId,
  }, { persistent: true })

  return json(serializeWebhookDetail(webhook))
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const scope = await resolveWebhookRequestScope(request)
  if (scope instanceof Response) return scope

  const params = await context.params
  const em = scope.em.fork()
  const webhook = await findScopedWebhook(em, scope, params.id)
  const { translate } = await resolveTranslations()

  if (!webhook) {
    return json({ error: translate('webhooks.errors.notFound', 'Webhook not found') }, { status: 404 })
  }

  webhook.deletedAt = new Date()
  await em.flush()

  await emitWebhooksEvent('webhooks.webhook.deleted', {
    webhookId: webhook.id,
    organizationId: webhook.organizationId,
    tenantId: webhook.tenantId,
  }, { persistent: true })

  return json({ success: true })
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
    PUT: {
      summary: 'Update webhook',
      description: 'Updates a single webhook configuration.',
      pathParams: z.object({ id: z.string().uuid() }),
      requestBody: {
        contentType: 'application/json',
        schema: webhookUpdateSchema,
        description: 'Webhook fields to update.',
      },
      responses: [{ status: 200, description: 'Webhook updated', schema: webhookDetailResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Webhook not found', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete webhook',
      description: 'Soft-deletes a webhook endpoint.',
      pathParams: z.object({ id: z.string().uuid() }),
      responses: [{ status: 200, description: 'Webhook deleted', schema: deleteResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 404, description: 'Webhook not found', schema: errorSchema },
      ],
    },
  },
}
