import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import { markQueueJobOrigin } from '@open-mercato/shared/lib/queue/dispatchOrigin'
import type { IntegrationLogService } from '../../../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { GatewayTransaction } from '../../../data/entities'
import { getPaymentGatewayQueue } from '../../../lib/queue'
import { processPaymentGatewayWebhookJob } from '../../../lib/webhook-processor'
import { paymentGatewaysTag } from '../../openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { readBoundedRequestBody, readBoundedRequestBytes, WebhookBodyTooLargeError } from '@open-mercato/shared/lib/webhooks'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('payment_gateways').child({ component: 'webhook' })

export const metadata = {
  path: '/payment_gateways/webhook/[provider]',
  POST: { requireAuth: false },
}

const WEBHOOK_VERIFICATION_FAILED = 'Webhook verification failed'

const paymentIdHintSchema = z.uuid()

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

  let rawBody: string | Buffer
  let bodyText: string
  try {
    if (registration.rawBody === 'bytes') {
      const bytes = registration.maxBodyBytes === undefined
        ? new Uint8Array(await req.arrayBuffer())
        : await readBoundedRequestBytes(req, { maxBytes: registration.maxBodyBytes })
      rawBody = Buffer.from(bytes)
      bodyText = new TextDecoder().decode(rawBody)
    } else {
      bodyText = registration.maxBodyBytes === undefined
        ? await req.text()
        : await readBoundedRequestBody(req, { maxBytes: registration.maxBodyBytes })
      rawBody = bodyText
    }
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
  const payload = await readJsonSafe<Record<string, unknown>>(bodyText)
  const locatorContext = { rawBody, headers }
  const sessionIdHint = normalizeSessionIdHint(registration.readSessionIdHint?.(payload, locatorContext))
  const paymentIdHint = normalizePaymentIdHint(registration.readPaymentIdHint?.(payload, locatorContext))

  try {
    // The webhook endpoint is unauthenticated. Tenant/organization scope MUST come from a
    // GatewayTransaction whose per-tenant credentials successfully verify the inbound
    // signature — NEVER from attacker-controlled payload metadata. If no candidate
    // transaction can be located by the provider-reported session or payment id, or no
    // candidate's credentials can verify the signature, we fail closed with 401. This
    // prevents forged webhooks (e.g. mock gateway PoC) from mutating another tenant's
    // payment state via `event.data.metadata.{organizationId,tenantId}`. When more than one
    // candidate verifies, the scope is ambiguous and we also fail closed.
    const candidates = sessionIdHint || paymentIdHint
      ? await findWithDecryption(
        em,
        GatewayTransaction,
        {
          providerKey,
          ...(sessionIdHint ? { providerSessionId: sessionIdHint } : {}),
          ...(paymentIdHint ? { paymentId: paymentIdHint } : {}),
          deletedAt: null,
        },
        { limit: 10, orderBy: { createdAt: 'desc' } },
      )
      : []

    const verifiedMatches: Array<{
      transaction: GatewayTransaction
      scope: { organizationId: string; tenantId: string }
      event: Awaited<ReturnType<typeof registration.handler>>
    }> = []
    let lastVerificationError: unknown = null

    for (const candidate of candidates) {
      const candidateScope = { organizationId: candidate.organizationId, tenantId: candidate.tenantId }
      const credentials = await integrationCredentialsService.resolve(`gateway_${providerKey}`, candidateScope) ?? {}
      try {
        const candidateEvent = await registration.handler({
          rawBody,
          headers,
          credentials,
          candidate: {
            transactionId: candidate.id,
            paymentId: candidate.paymentId,
            providerSessionId: candidate.providerSessionId ?? null,
            amount: candidate.amount,
            currencyCode: candidate.currencyCode,
          },
        })
        verifiedMatches.push({ transaction: candidate, scope: candidateScope, event: candidateEvent })
      } catch (error: unknown) {
        lastVerificationError = error
      }
    }

    if (verifiedMatches.length > 1) {
      logger.error('Webhook matched multiple verified candidates', {
        providerKey,
        candidateCount: verifiedMatches.length,
      })
      getTelemetryRuntime()?.reportError(
        new Error('[internal] Webhook matched multiple verified candidates'),
        { module: 'payment_gateways', code: 'payment_gateways.webhook_ambiguous_candidates' },
      )
      return NextResponse.json({ error: WEBHOOK_VERIFICATION_FAILED }, { status: 401 })
    }

    const [match] = verifiedMatches
    if (!match) {
      throw lastVerificationError ?? new Error('Webhook verification failed: no matching transaction')
    }

    const { transaction, event } = match
    const scope = match.scope

    const jobPayload = markQueueJobOrigin({
      providerKey,
      event,
      transactionId: transaction.id,
      scope,
    }, 'inbound-webhook')

    if (process.env.QUEUE_STRATEGY === 'async') {
      await queue.enqueue(jobPayload)
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

function normalizeSessionIdHint(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizePaymentIdHint(value: unknown): string | null {
  const parsed = paymentIdHintSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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
