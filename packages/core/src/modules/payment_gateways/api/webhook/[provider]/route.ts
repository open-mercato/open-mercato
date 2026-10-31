import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { checkRateLimit, getClientIp, RATE_LIMIT_ERROR_FALLBACK } from '@open-mercato/shared/lib/ratelimit/helpers'
import type { RateLimiterService } from '@open-mercato/shared/lib/ratelimit/service'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getWebhookHandler,
  WebhookVerificationUnavailableError,
  type WebhookHandlerRegistration,
  type WebhookHttpResponse,
  type WebhookResponseOutcome,
} from '@open-mercato/shared/modules/payment_gateways/types'
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
const WEBHOOK_PAYLOAD_TOO_LARGE = 'Webhook payload too large'
const INTERNAL_SERVER_ERROR = 'Internal server error'
const DEFAULT_TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8'
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/
const JSON_CONTENT_TYPE = /^application\/([\w.+-]+\+)?json(\s*;|$)/

const paymentIdHintSchema = z.guid()

const paymentGatewayWebhookRateLimitConfig = {
  points: 60,
  duration: 60,
  keyPrefix: 'payment_gateways:webhook',
}

type RequestContainer = Awaited<ReturnType<typeof createRequestContainer>>

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> | { provider: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider
  const container = await createRequestContainer()
  const registration = getWebhookHandler(providerKey)
  if (!registration) {
    return NextResponse.json({ error: `No webhook handler for provider: ${providerKey}` }, { status: 404 })
  }

  const rateLimitResponse = await checkProviderWebhookRateLimit(container, req, providerKey)
  const outcome: WebhookResponseOutcome = rateLimitResponse
    ? 'rate_limited'
    : await receiveWebhook(req, providerKey, registration, container)
  const response = respond(registration, outcome, rateLimitResponse)
  const logFields = { providerKey, outcome, status: response.status }
  if (outcome === 'accepted') logger.info('Webhook handled', logFields)
  else logger.warn('Webhook handled', logFields)
  return response
}

async function receiveWebhook(
  req: Request,
  providerKey: string,
  registration: WebhookHandlerRegistration,
  container: RequestContainer,
): Promise<WebhookResponseOutcome> {
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
    if (error instanceof WebhookBodyTooLargeError) return 'payload_too_large'
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
  let sessionIdHint: string | null
  let paymentIdHint: string | null
  try {
    sessionIdHint = normalizeSessionIdHint(registration.readSessionIdHint?.(payload, locatorContext))
    paymentIdHint = normalizePaymentIdHint(registration.readPaymentIdHint?.(payload, locatorContext))
  } catch (error: unknown) {
    reportWebhookError(error, 'payment_gateways.webhook_locator_failed')
    return 'no_candidate'
  }

  try {
    // The webhook endpoint is unauthenticated. Tenant/organization scope MUST come from a
    // GatewayTransaction whose per-tenant credentials successfully verify the inbound
    // signature — NEVER from attacker-controlled payload metadata. If no candidate
    // transaction can be located by the provider-reported session or payment id, or no
    // candidate's credentials can verify the signature, we fail closed. This
    // prevents forged webhooks (e.g. mock gateway PoC) from mutating another tenant's
    // payment state via `event.data.metadata.{organizationId,tenantId}`. When more than one
    // candidate verifies, the scope is ambiguous and we also fail closed.
    let candidates: GatewayTransaction[]
    try {
      candidates = sessionIdHint || paymentIdHint
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
    } catch (error: unknown) {
      reportWebhookError(error, 'payment_gateways.webhook_lookup_failed')
      return 'processing_failed'
    }

    if (candidates.length === 0) return 'no_candidate'

    const verifiedMatches: Array<{
      transaction: GatewayTransaction
      scope: { organizationId: string; tenantId: string }
      event: Awaited<ReturnType<typeof registration.handler>>
    }> = []
    let verificationUnavailable = false

    for (const candidate of candidates) {
      const candidateScope = { organizationId: candidate.organizationId, tenantId: candidate.tenantId }
      let credentials: Record<string, unknown>
      try {
        credentials = await integrationCredentialsService.resolve(`gateway_${providerKey}`, candidateScope) ?? {}
      } catch (error: unknown) {
        reportWebhookError(error, 'payment_gateways.webhook_credentials_failed')
        verificationUnavailable = true
        continue
      }
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
        if (error instanceof WebhookVerificationUnavailableError) verificationUnavailable = true
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
      return 'verification_failed'
    }

    if (verificationUnavailable && verifiedMatches.length === 1) {
      logger.warn('Webhook candidate left unverified; ambiguity cannot be ruled out', {
        providerKey,
        candidateCount: candidates.length,
      })
      return 'verification_unavailable'
    }

    const [match] = verifiedMatches
    if (!match) return verificationUnavailable ? 'verification_unavailable' : 'verification_failed'

    const jobPayload = markQueueJobOrigin({
      providerKey,
      event: match.event,
      transactionId: match.transaction.id,
      scope: match.scope,
    }, 'inbound-webhook')

    try {
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
    } catch (error: unknown) {
      getTelemetryRuntime()?.reportError(error, {
        module: 'payment_gateways',
        code: 'payment_gateways.webhook_processing_failed',
      })
      return 'processing_failed'
    }

    return 'accepted'
  } catch (error: unknown) {
    reportWebhookError(error, 'payment_gateways.webhook_unexpected_failure')
    return 'verification_failed'
  }
}

function respond(
  registration: WebhookHandlerRegistration,
  outcome: WebhookResponseOutcome,
  rateLimitResponse: NextResponse | null,
): NextResponse {
  if (!registration.formatResponse) return legacyResponse(outcome, rateLimitResponse)
  try {
    const response = toValidatedResponse(registration.formatResponse(outcome))
    if (outcome === 'rate_limited' && rateLimitResponse) {
      rateLimitResponse.headers.forEach((value, key) => {
        if (key !== 'content-type' && key !== 'content-length') response.headers.set(key, value)
      })
    }
    return response
  } catch (error: unknown) {
    getTelemetryRuntime()?.reportError(error, {
      module: 'payment_gateways',
      code: 'payment_gateways.webhook_formatter_invalid',
    })
    return NextResponse.json({ error: INTERNAL_SERVER_ERROR }, { status: 500 })
  }
}

function legacyResponse(outcome: WebhookResponseOutcome, rateLimitResponse: NextResponse | null): NextResponse {
  if (outcome === 'rate_limited' && rateLimitResponse) return rateLimitResponse
  if (outcome === 'accepted') return NextResponse.json({ received: true, queued: true }, { status: 202 })
  if (outcome === 'payload_too_large') return NextResponse.json({ error: WEBHOOK_PAYLOAD_TOO_LARGE }, { status: 413 })
  return NextResponse.json({ error: WEBHOOK_VERIFICATION_FAILED }, { status: 401 })
}

function toValidatedResponse(formatted: WebhookHttpResponse): NextResponse {
  const { status, body, contentType } = formatted
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error('[internal] Webhook formatter returned an invalid status')
  }
  if (contentType !== undefined && (typeof contentType !== 'string' || CONTROL_CHARACTERS.test(contentType))) {
    throw new Error('[internal] Webhook formatter returned an invalid content type')
  }
  const normalizedContentType = contentType?.toLowerCase()
  if (typeof body === 'string') {
    if (normalizedContentType !== undefined && !normalizedContentType.startsWith('text/')) {
      throw new Error('[internal] Webhook formatter returned a non-text content type for a text body')
    }
    return new NextResponse(body, { status, headers: { 'content-type': contentType ?? DEFAULT_TEXT_CONTENT_TYPE } })
  }
  if (!isPlainObject(body)) {
    throw new Error('[internal] Webhook formatter returned an invalid body')
  }
  if (normalizedContentType !== undefined && !JSON_CONTENT_TYPE.test(normalizedContentType)) {
    throw new Error('[internal] Webhook formatter returned a non-JSON content type for an object body')
  }
  const response = NextResponse.json(body, { status })
  if (contentType !== undefined) response.headers.set('content-type', contentType)
  return response
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function reportWebhookError(error: unknown, code: string): void {
  getTelemetryRuntime()?.reportError(error, { module: 'payment_gateways', code })
}

function normalizeSessionIdHint(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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
        { status: 200, description: 'Webhook accepted (provider-defined acknowledgement may apply)' },
        { status: 202, description: 'Webhook accepted for processing (default acknowledgement)' },
        { status: 400, description: 'Webhook rejected (provider-defined response may apply)' },
        { status: 401, description: 'Webhook could not be verified or processed (default failure response)' },
        { status: 404, description: 'Unknown provider' },
        { status: 413, description: 'Webhook payload too large' },
        { status: 429, description: 'Too many webhook requests' },
        { status: 500, description: 'Internal server error (provider-defined response may apply)' },
        { status: 503, description: 'Webhook temporarily unavailable (provider-defined response may apply)' },
      ],
    },
  },
}

export default POST
