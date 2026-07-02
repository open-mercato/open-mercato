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
import { GatewaySubscriptionMapping, GatewayTransaction } from '../../../data/entities'
import { getPaymentGatewayQueue } from '../../../lib/queue'
import { processPaymentGatewayWebhookJob } from '../../../lib/webhook-processor'
import { processSubscriptionWebhookJob } from '../../../lib/subscription-webhook-processor'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  path: '/payment_gateways/webhook/[provider]',
  POST: { requireAuth: false },
}

type ScopeMatch = { organizationId: string; tenantId: string }

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

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const em = container.resolve('em') as EntityManager
  const integrationCredentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const payload = await readJsonSafe<Record<string, unknown>>(rawBody)

  const classification = registration.classifyEvent?.(payload) ?? 'transaction'

  if (classification === 'subscription') {
    const subscriptionQueue = getPaymentGatewayQueue(
      registration.subscriptionQueue ?? 'payment-gateways-subscription-webhook',
    )
    const ref = registration.readSubscriptionRef?.(payload) ?? null
    const subscriptionIdHint = ref?.providerSubscriptionId ?? null
    const customerIdHint = ref?.providerCustomerId ?? null

    try {
      const candidates: GatewaySubscriptionMapping[] = []
      if (subscriptionIdHint) {
        const bySubscription = await findWithDecryption(
          em,
          GatewaySubscriptionMapping,
          {
            providerKey,
            providerSubscriptionId: subscriptionIdHint,
          },
          { limit: 10, orderBy: { createdAt: 'desc' } },
        )
        candidates.push(...bySubscription)
      }
      if (customerIdHint && candidates.length === 0) {
        const byCustomer = await findWithDecryption(
          em,
          GatewaySubscriptionMapping,
          {
            providerKey,
            providerCustomerId: customerIdHint,
          },
          { limit: 10, orderBy: { createdAt: 'desc' } },
        )
        candidates.push(...byCustomer)
      }

      let mapping: GatewaySubscriptionMapping | null = null
      let matchedScope: ScopeMatch | null = null
      let event: Awaited<ReturnType<typeof registration.handler>> | null = null
      let lastVerificationError: unknown = null

      const seenScopes = new Set<string>()
      for (const candidate of candidates) {
        const candidateScope = { organizationId: candidate.organizationId, tenantId: candidate.tenantId }
        const scopeKey = `${candidateScope.organizationId}::${candidateScope.tenantId}`
        if (seenScopes.has(scopeKey)) continue
        seenScopes.add(scopeKey)
        const credentials = await integrationCredentialsService.resolve(`gateway_${providerKey}`, candidateScope) ?? {}
        try {
          event = await registration.handler({ rawBody, headers, credentials })
          mapping = candidate
          matchedScope = candidateScope
          break
        } catch (error: unknown) {
          lastVerificationError = error
        }
      }

      if (!event || !mapping || !matchedScope) {
        throw lastVerificationError ?? new Error('Subscription webhook verification failed: no matching mapping')
      }

      const jobPayload = {
        providerKey,
        event,
        scope: {
          organizationId: matchedScope.organizationId,
          tenantId: matchedScope.tenantId,
          externalAccountId: mapping.externalAccountId,
          subscriptionId: mapping.subscriptionId ?? null,
          subjectEntityType: mapping.subjectEntityType ?? null,
          subjectEntityId: mapping.subjectEntityId ?? null,
        },
        ref: {
          providerSubscriptionId: ref?.providerSubscriptionId ?? mapping.providerSubscriptionId ?? null,
          providerCustomerId: ref?.providerCustomerId ?? mapping.providerCustomerId,
          providerInvoiceId: ref?.providerInvoiceId ?? null,
          providerChargeId: ref?.providerChargeId ?? null,
        },
      }

      if (process.env.QUEUE_STRATEGY === 'async') {
        await subscriptionQueue.enqueue(jobPayload)
      } else {
        let integrationLogService: IntegrationLogService | undefined
        try {
          integrationLogService = container.resolve('integrationLogService') as IntegrationLogService
        } catch {
          integrationLogService = undefined
        }
        await processSubscriptionWebhookJob({ em, integrationLogService }, jobPayload)
      }

      return NextResponse.json({ received: true, queued: true }, { status: 202 })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Subscription webhook verification failed'
      return NextResponse.json({ error: message }, { status: 401 })
    }
  }

  if (classification === 'unknown') {
    return NextResponse.json({ received: true, processed: false }, { status: 200 })
  }

  const queue = getPaymentGatewayQueue(registration.queue ?? 'payment-gateways-webhook')
  const sessionIdHint = registration.readSessionIdHint?.(payload) ?? null

  try {
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
    let matchedScope: ScopeMatch | null = null
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
    console.warn(`[payment_gateways] Webhook verification failed for provider "${providerKey}"`, err)
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
      summary: 'Process inbound webhook from payment provider (transactions or subscriptions)',
      tags: [paymentGatewaysTag],
      responses: [
        { status: 200, description: 'Event acknowledged (unknown classification, no side effects)' },
        { status: 202, description: 'Webhook accepted for async processing' },
        { status: 401, description: 'Signature verification failed' },
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}

export default POST
