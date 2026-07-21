import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK, RATE_LIMIT_ERROR_KEY } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { InboundWebhookRequest } from '@open-mercato/shared/lib/webhooks'
import { emitWebhooksEvent } from '../../../events'
import { getWebhookEndpointAdapter } from '../../../lib/adapter-registry'
import { getWebhookSource } from '../../../lib/inbound-registry'
import { enqueueInboundDispatch } from '../../../lib/queue'
import { isWebhookIntegrationEnabled } from '../../../lib/integration-state'
import { json } from '../../helpers'
import { InboundEndpointConfigEntity, WebhookIngestionEntity, WebhookInboundReceiptEntity } from '../../../data/entities'

type IntegrationCredentialsService = {
  resolve: (
    integrationId: string,
    scope: { organizationId: string; tenantId: string },
  ) => Promise<Record<string, unknown> | null>
}

function toStringCredentials(credentials: Record<string, unknown> | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!credentials) return result
  for (const [key, value] of Object.entries(credentials)) {
    if (typeof value === 'string') result[key] = value
  }
  return result
}

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
  const source = getWebhookSource(params.endpointId)
  const adapter = source ? undefined : getWebhookEndpointAdapter(params.endpointId)
  const { translate } = await resolveTranslations()

  if (!source && !adapter) {
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

  if (source) {
    const rawBody = await request.text()
    const sourceHeaders = Object.fromEntries(request.headers.entries())
    let parsedBody: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(rawBody)
      if (parsed && typeof parsed === 'object') parsedBody = parsed as Record<string, unknown>
    } catch {
      parsedBody = {}
    }
    const inboundRequest: InboundWebhookRequest = { body: rawBody, headers: sourceHeaders, parsedBody }

    const credentialsService = tryResolve<IntegrationCredentialsService>(container, 'integrationCredentialsService')
    const configs = await findWithDecryption(
      em,
      InboundEndpointConfigEntity,
      { sourceKey: params.endpointId, isActive: true },
      {},
    )

    let verifiedScope: { organizationId: string; tenantId: string } | null = null
    for (const config of configs) {
      const scope = { organizationId: config.organizationId, tenantId: config.tenantId }
      const credentials = credentialsService
        ? await credentialsService.resolve(`webhook_source_${params.endpointId}`, scope)
        : null
      let valid = false
      try {
        valid = await source.verifier(inboundRequest, toStringCredentials(credentials))
      } catch {
        valid = false
      }
      if (valid) {
        verifiedScope = scope
        break
      }
    }

    if (!verifiedScope) {
      return json({ error: 'Signature verification failed' }, { status: 401 })
    }

    const eventType = source.eventTypeExtractor(parsedBody, sourceHeaders)
    const messageId = source.messageIdExtractor?.(parsedBody, sourceHeaders)
      ?? resolveInboundReceiptMessageId({
        endpointId: params.endpointId,
        providerKey: params.endpointId,
        headers: sourceHeaders,
        body: rawBody,
      })

    try {
      em.persist(em.create(WebhookInboundReceiptEntity, {
        endpointId: params.endpointId,
        messageId,
        providerKey: params.endpointId,
        eventType,
        tenantId: verifiedScope.tenantId,
        organizationId: verifiedScope.organizationId,
        createdAt: new Date(),
      }))
      await em.flush()
    } catch (error) {
      if (isUniqueViolation(error)) {
        return json({ ok: true, duplicate: true })
      }
      throw error
    }

    const ingestion = em.create(WebhookIngestionEntity, {
      sourceKey: params.endpointId,
      eventType,
      externalMessageId: messageId,
      payload: parsedBody,
      headers: sourceHeaders,
      status: 'received',
      handlerCount: 0,
      organizationId: verifiedScope.organizationId,
      tenantId: verifiedScope.tenantId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    em.persist(ingestion)
    await em.flush()

    await enqueueInboundDispatch({
      ingestionId: ingestion.id,
      sourceKey: params.endpointId,
      eventType,
      data: parsedBody,
      headers: sourceHeaders,
      tenantId: verifiedScope.tenantId,
      organizationId: verifiedScope.organizationId,
    })

    await emitWebhooksEvent('webhooks.inbound.received', {
      providerKey: params.endpointId,
      endpointId: params.endpointId,
      messageId,
      eventType,
      payload: parsedBody,
      tenantId: verifiedScope.tenantId,
      organizationId: verifiedScope.organizationId,
    }, { persistent: true })

    return json({ ok: true })
  }

  if (!adapter) {
    return json({ error: 'Webhook endpoint not found' }, { status: 404 })
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
      description: 'The endpoint id resolves to a registered webhook source first (module-level handler dispatch), otherwise to a legacy adapter provider key.',
      pathParams: z.object({ endpointId: z.string().min(1) }),
      responses: [{ status: 200, description: 'Inbound webhook accepted', schema: inboundResponseSchema }],
      errors: [
        { status: 400, description: 'Verification failed', schema: errorSchema },
        { status: 401, description: 'Signature verification failed (source flow)', schema: errorSchema },
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
