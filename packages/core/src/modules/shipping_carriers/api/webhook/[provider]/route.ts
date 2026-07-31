import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { CarrierShipment } from '../../../data/entities'
import { getShippingAdapter } from '../../../lib/adapter-registry'
import { getShippingCarrierQueue } from '../../../lib/queue'
import { shippingCarriersTag } from '../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('shipping_carriers').child({ component: 'webhook' })

export const metadata = {
  path: '/shipping-carriers/webhook/[provider]',
  POST: { requireAuth: false },
}

const WEBHOOK_VERIFICATION_FAILED = 'Webhook verification failed'

const shippingCarrierWebhookRateLimitConfig = {
  points: 60,
  duration: 60,
  keyPrefix: 'shipping_carriers:webhook',
}

function readCarrierShipmentId(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const shipmentId = payload.shipmentId
  if (typeof shipmentId === 'string' && shipmentId.trim().length > 0) return shipmentId.trim()
  const data = payload.data
  if (data && typeof data === 'object') {
    const nested = (data as Record<string, unknown>).shipmentId
    if (typeof nested === 'string' && nested.trim().length > 0) return nested.trim()
  }
  return null
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> | { provider: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider
  const adapter = getShippingAdapter(providerKey)
  if (!adapter) {
    return NextResponse.json({ error: `No shipping adapter for provider: ${providerKey}` }, { status: 404 })
  }

  const container = await createRequestContainer()
  const rateLimitResponse = await checkProviderWebhookRateLimit(container, req, providerKey)
  if (rateLimitResponse) return rateLimitResponse

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const em = container.resolve('em') as EntityManager
  const integrationCredentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const queue = getShippingCarrierQueue('shipping-carriers-webhook')
  const payload = await readJsonSafe<Record<string, unknown>>(rawBody)
  const carrierShipmentId = readCarrierShipmentId(payload)

  try {
    // The webhook endpoint is unauthenticated. Tenant/organization scope MUST come from a
    // CarrierShipment whose per-tenant credentials successfully verify the inbound
    // signature — NEVER from attacker-controlled payload metadata or an unsigned retry.
    // If no candidate shipment can be located by the provider-reported carrierShipmentId,
    // or no candidate's credentials can verify the signature, we fail closed with 401.
    // This mirrors the fix landed for payment_gateways in PR #1311.
    const candidates = carrierShipmentId
      ? await findWithDecryption(
        em,
        CarrierShipment,
        {
          providerKey,
          carrierShipmentId,
          deletedAt: null,
        },
        { limit: 10, orderBy: { createdAt: 'desc' } },
      )
      : []

    let shipment: CarrierShipment | null = null
    let matchedScope: { organizationId: string; tenantId: string } | null = null
    let event: Awaited<ReturnType<typeof adapter.verifyWebhook>> | null = null
    let lastVerificationError: unknown = null

    for (const candidate of candidates) {
      const candidateScope = { organizationId: candidate.organizationId, tenantId: candidate.tenantId }
      const credentials = await integrationCredentialsService.resolve(`carrier_${providerKey}`, candidateScope) ?? {}
      try {
        event = await adapter.verifyWebhook({ rawBody, headers, credentials })
        shipment = candidate
        matchedScope = candidateScope
        break
      } catch (error: unknown) {
        lastVerificationError = error
      }
    }

    if (!event || !shipment || !matchedScope) {
      throw lastVerificationError ?? new Error('Webhook verification failed: no matching shipment')
    }

    await queue.enqueue({
      name: 'shipping-carrier-webhook',
      payload: {
        providerKey,
        event,
        shipmentId: shipment.id,
        scope: matchedScope,
      },
    })

    return NextResponse.json({ received: true, queued: true }, { status: 202 })
  } catch (error: unknown) {
    logger.warn('Webhook verification failed', { providerKey, err: error })
    return NextResponse.json({ error: WEBHOOK_VERIFICATION_FAILED }, { status: 401 })
  }
}

async function checkProviderWebhookRateLimit(
  container: { resolve: (name: string) => unknown },
  req: Request,
  providerKey: string,
): Promise<NextResponse | null> {
  const rateLimiterService = tryResolve<RateLimiterService>(container, 'rateLimiterService')
  if (!rateLimiterService) return null

  return checkRateLimit(
    rateLimiterService,
    shippingCarrierWebhookRateLimitConfig,
    `${providerKey}:${getClientIp(req, rateLimiterService.trustProxyDepth) ?? 'unknown'}`,
    RATE_LIMIT_ERROR_FALLBACK,
  )
}

function tryResolve<T>(container: { resolve: (name: string) => unknown }, name: string): T | null {
  try {
    return container.resolve(name) as T
  } catch {
    return null
  }
}

export const openApi = {
  tags: [shippingCarriersTag],
  summary: 'Receive shipping carrier webhook',
  methods: {
    POST: {
      summary: 'Process inbound carrier webhook',
      tags: [shippingCarriersTag],
      responses: [
        { status: 202, description: 'Webhook accepted for async processing' },
        { status: 401, description: 'Signature verification failed' },
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}
