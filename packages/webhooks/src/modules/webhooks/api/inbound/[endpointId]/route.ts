import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_ERROR_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { emitWebhooksEvent } from '../../../events'
import { getWebhookEndpointAdapter } from '../../../lib/adapter-registry'
import { isWebhookIntegrationEnabled, WEBHOOK_INTEGRATION_DISABLED_MESSAGE } from '../../../lib/integration-state'
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
      buildInboundRateLimitKey(params.endpointId, request, rateLimiterService.trustProxyDepth),
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

  const hasTenantId = Boolean(verified.tenantId)
  const hasOrganizationId = Boolean(verified.organizationId)
  if (hasTenantId !== hasOrganizationId) {
    return json({ error: WEBHOOK_INTEGRATION_DISABLED_MESSAGE }, { status: 503 })
  }

  const integrationScope = hasTenantId && hasOrganizationId
    ? { tenantId: verified.tenantId as string, organizationId: verified.organizationId as string }
    : null

  if (integrationScope) {
    const integrationEnabled = await isWebhookIntegrationEnabled(em, integrationScope)
    if (!integrationEnabled) {
      return json({ error: WEBHOOK_INTEGRATION_DISABLED_MESSAGE }, { status: 503 })
    }
  } else if (!adapter.allowUnscopedInbound) {
    return json({ error: WEBHOOK_INTEGRATION_DISABLED_MESSAGE }, { status: 503 })
  }

  const messageId = resolveInboundReceiptMessageId({
    endpointId: params.endpointId,
    providerKey: adapter.providerKey,
    headers,
    body,
  })
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

type ResolveInboundReceiptMessageIdInput = {
  endpointId: string
  providerKey: string
  headers: Record<string, string>
  body: string
}

export function buildInboundRateLimitKey(endpointId: string, request: Request, trustProxyDepth: number): string {
  const clientIp = getClientIp(request, trustProxyDepth)
  return clientIp ? `${endpointId}:ip:${clientIp}` : `${endpointId}:global`
}

export function resolveInboundReceiptMessageId(
  input: ResolveInboundReceiptMessageIdInput
): string {
  const explicitMessageId = input.headers['webhook-id'] ?? input.headers['svix-id'] ?? null
  if (typeof explicitMessageId === 'string' && explicitMessageId.trim().length > 0) {
    return explicitMessageId.trim()
  }

  const timestamp =
    input.headers['webhook-timestamp'] ??
    input.headers['svix-timestamp'] ??
    null

  if (typeof timestamp === 'string' && timestamp.trim().length > 0) {
    const digest = createHash('sha256')
      .update(input.providerKey)
      .update(':')
      .update(input.endpointId)
      .update(':')
      .update(timestamp.trim())
      .update(':')
      .update(input.body)
      .digest('hex')

    return `derived:${timestamp.trim()}:${digest}`
  }

  const digest = createHash('sha256')
    .update(input.providerKey)
    .update(':')
    .update(input.endpointId)
    .update(':')
    .update(input.body)
    .digest('hex')

  return `derived:no-timestamp:${digest}`
}
