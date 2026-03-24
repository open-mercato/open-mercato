import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_ERROR_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { emitWebhooksEvent } from '../../../events'
import { getWebhookEndpointAdapter } from '../../../lib/adapter-registry'
import { isWebhookIntegrationEnabled } from '../../../lib/integration-state'
import { json } from '../../helpers'
import { WebhookInboundReceiptEntity } from '../../../data/entities'

export const metadata = {
  POST: { requireAuth: false },
}

interface RouteContext {
  params: Promise<{ endpointId: string }>
}

const inboundResponseSchema = z.object({
  ok: z.boolean(),
  duplicate: z.boolean().optional(),
})

const errorSchema = z.object({ error: z.string() })

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const params = await context.params
  const adapter = getWebhookEndpointAdapter(params.endpointId)
  const { translate } = await resolveTranslations()

  if (!adapter) {
    return json({ error: 'Webhook endpoint not found' }, { status: 404 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const rateLimiterService = tryResolve<RateLimiterService>(container, 'rateLimiterService')

  if (rateLimiterService) {
    const rateLimitResponse = await checkRateLimit(
      rateLimiterService,
      { points: 60, duration: 60, keyPrefix: `webhooks:inbound:${params.endpointId}` },
      `${params.endpointId}:${getClientIp(request, rateLimiterService.trustProxyDepth) ?? 'unknown'}`,
      translate(RATE_LIMIT_ERROR_KEY, RATE_LIMIT_ERROR_FALLBACK),
    )

    if (rateLimitResponse) return rateLimitResponse
  }

  const body = await request.text()
  const headers = Object.fromEntries(request.headers.entries())
  let verified: Awaited<ReturnType<typeof adapter.verifyWebhook>>
  try {
    verified = await adapter.verifyWebhook({
      headers,
      body,
      method: request.method,
    })
  } catch {
    return json({ error: 'Verification failed' }, { status: 400 })
  }

  if (verified.tenantId && verified.organizationId) {
    const integrationEnabled = await isWebhookIntegrationEnabled(em, {
      tenantId: verified.tenantId,
      organizationId: verified.organizationId,
    })

    if (!integrationEnabled) {
      return json({ error: 'Custom Webhooks integration is disabled' }, { status: 503 })
    }
  }

  const messageId = headers['webhook-id'] ?? headers['svix-id'] ?? null
  if (messageId) {
    try {
      em.persist(em.create(WebhookInboundReceiptEntity, {
        endpointId: params.endpointId,
        messageId,
        providerKey: adapter.providerKey,
        eventType: verified.eventType,
        tenantId: verified.tenantId ?? null,
        organizationId: verified.organizationId ?? null,
        createdAt: new Date(),
      }))
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) {
        return json({ ok: true, duplicate: true })
      }
      throw error
    }
  }

  await emitWebhooksEvent('webhooks.inbound.received', {
    providerKey: adapter.providerKey,
    endpointId: params.endpointId,
    messageId,
    eventType: verified.eventType,
    payload: verified.payload,
    tenantId: verified.tenantId ?? null,
    organizationId: verified.organizationId ?? null,
  }, { persistent: true })

  return json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Receive inbound webhook',
  description: 'Verifies, rate limits, deduplicates, and processes an inbound webhook using the registered endpoint adapter.',
  methods: {
    POST: {
      summary: 'Receive inbound webhook',
      description: 'Endpoint ids currently resolve to registered adapter provider keys.',
      pathParams: z.object({ endpointId: z.string().min(1) }),
      responses: [{ status: 200, description: 'Inbound webhook accepted', schema: inboundResponseSchema }],
      errors: [
        { status: 400, description: 'Verification failed', schema: errorSchema },
        { status: 404, description: 'Endpoint not found', schema: errorSchema },
        { status: 429, description: 'Rate limit exceeded', schema: errorSchema },
        { status: 503, description: 'Webhook integration disabled', schema: errorSchema },
      ],
    },
  },
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const maybeError = error as { code?: string; cause?: unknown }
  if (maybeError.code === '23505') return true
  if (!maybeError.cause || typeof maybeError.cause !== 'object') return false
  return (maybeError.cause as { code?: string }).code === '23505'
}
