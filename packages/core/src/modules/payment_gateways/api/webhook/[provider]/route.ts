import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '../../../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { GatewayTransaction } from '../../../data/entities'
import { getPaymentGatewayQueue } from '../../../lib/queue'
import { processPaymentGatewayWebhookJob } from '../../../lib/webhook-processor'
import { paymentGatewaysTag } from '../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readBoundedRequestBody, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'

const logger = createLogger('payment_gateways').child({ component: 'webhook' })

export const metadata = {
  path: '/payment_gateways/webhook/[provider]',
  POST: { requireAuth: false },
}

const WEBHOOK_VERIFICATION_FAILED = 'Webhook verification failed'

const paymentGatewayWebhookRateLimitConfig = {
  points: 60,
  duration: 60,
  keyPrefix: 'payment_gateways:webhook',
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> | { provider: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider
  const container = await createRequestContainer()
  const registration = getWebhookHandler(providerKey)
  if (!registration) {
    return NextResponse.json({ error: `No webhook handler for provider: ${providerKey}` }, { status: 404 })
  }

  const rateLimitResponse = await checkProviderWebhookRateLimit(container, req, providerKey)
  if (rateLimitResponse) return rateLimitResponse

  let rawBody: string
  try {
    rawBody = await readBoundedRequestBody(req)
  } catch (error) {
    if (error instanceof WebhookBodyTooLargeError) {
      return NextResponse.json({ error: 'Webhook payload too large' }, { status: 413 })
    }
    throw error
  }
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const em = container.resolve('em') as EntityManager
  const integrationCredentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const queue = getPaymentGatewayQueue(registration.queue ?? 'payment-gateways-webhook')
  const payload = await readJsonSafe<Record<string, unknown>>(rawBody)
  const sessionIdHint = registration.readSessionIdHint?.(payload) ?? null

  try {
    // The webhook endpoint is unauthenticated. Tenant/organization scope MUST come from a
    // GatewayTransaction whose per-tenant credentials successfully verify the inbound
    // signature — NEVER from attacker-controlled payload metadata. If no candidate
    // transaction can be located by the provider-reported session id, or no candidate's
    // credentials can verify the signature, we fail closed with 401. This prevents
    // forged webhooks (e.g. mock gateway PoC) from mutating another tenant's payment
    // state via `event.data.metadata.{organizationId,tenantId}`.
    const candidates = sessionIdHint
      ? await findWithDecryption(
        em,
        GatewayTransaction,
        {
          providerKey,
          providerSessionId: sessionIdHint,
          deletedAt: null,
        },
        { limit: 10, orderBy: { createdAt: 'desc' } },
      )
      : []

    let transaction: GatewayTransaction | null = null
    let matchedScope: { organizationId: string; tenantId: string } | null = null
    let event: Awaited<ReturnType<typeof registration.handler>> | null = null
    let lastVerificationError: unknown = null

    for (const candidate of candidates) {
      const candidateScope = { organizationId: candidate.organizationId, tenantId: candidate.tenantId }
      const credentials = await integrationCredentialsService.resolve(`gateway_${providerKey}`, candidateScope) ?? {}
      try {
        event = await registration.handler({ rawBody, headers, credentials })
        transaction = candidate
        matchedScope = candidateScope
        break
      } catch (error: unknown) {
        lastVerificationError = error
      }
    }

    if (!event || !transaction || !matchedScope) {
      throw lastVerificationError ?? new Error('Webhook verification failed: no matching transaction')
    }

    const scope = matchedScope

    const jobPayload = {
      providerKey,
      event,
      transactionId: transaction.id,
      scope,
    }

    if (process.env.QUEUE_STRATEGY === 'async') {
      await queue.enqueue({
        name: 'payment-gateway-webhook',
        payload: jobPayload,
      })
    } else {
      await processPaymentGatewayWebhookJob(
        {
          em: container.resolve('em') as EntityManager,
          paymentGatewayService: service,
          integrationLogService: container.resolve('integrationLogService') as IntegrationLogService,
        },
        jobPayload,
      )
    }

    return NextResponse.json({ received: true, queued: true }, { status: 202 })
  } catch (err: unknown) {
    logger.warn('Webhook verification failed', { providerKey, err })
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
    paymentGatewayWebhookRateLimitConfig,
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
  tags: [paymentGatewaysTag],
  summary: 'Receive payment gateway webhook',
  methods: {
    POST: {
      summary: 'Process inbound webhook from payment provider',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 202, description: 'Webhook accepted for async processing' },
        { status: 401, description: 'Signature verification failed' },
        { status: 413, description: 'Webhook payload too large' },
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}

export default POST
