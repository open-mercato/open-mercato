import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import type { IntegrationLogService } from '../../../../integrations/lib/log-service'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { GatewayTransaction } from '../../../data/entities'
import { getPaymentGatewayQueue } from '../../../lib/queue'
import { processPaymentGatewayWebhookJob } from '../../../lib/webhook-processor'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  path: '/payment_gateways/webhook/[provider]',
  POST: { requireAuth: false },
}

function readScopeFromEventData(data: Record<string, unknown>): { organizationId: string; tenantId: string } | null {
  const metadata = data.metadata
  if (!metadata || typeof metadata !== 'object') return null

  const metadataRecord = metadata as Record<string, unknown>
  const organizationId = typeof metadataRecord.organizationId === 'string'
    ? metadataRecord.organizationId.trim()
    : ''
  const tenantId = typeof metadataRecord.tenantId === 'string'
    ? metadataRecord.tenantId.trim()
    : ''

  if (!organizationId || !tenantId) return null
  return { organizationId, tenantId }
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> | { provider: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider
  const container = await createRequestContainer()
  const registration = getWebhookHandler(providerKey)
  if (!registration) {
    return NextResponse.json({ error: `No webhook handler for provider: ${providerKey}` }, { status: 404 })
  }

  const rawBody = await req.text()
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

    if (!event) {
      try {
        event = await registration.handler({ rawBody, headers, credentials: {} })
      } catch (error: unknown) {
        throw lastVerificationError ?? error
      }
    }
    if (!event) {
      throw new Error('Webhook verification failed')
    }

    if (!transaction && sessionIdHint) {
      const derivedScope = readScopeFromEventData(event.data)
      if (derivedScope) {
        transaction = await service.findTransactionBySessionId(sessionIdHint, derivedScope, providerKey)
        matchedScope = transaction
          ? { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
          : derivedScope
      }
    }

    const scope = transaction
      ? { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
      : matchedScope ?? readScopeFromEventData(event.data)

    const jobPayload = {
      providerKey,
      event,
      transactionId: transaction?.id ?? null,
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
    const message = err instanceof Error ? err.message : 'Webhook verification failed'
    return NextResponse.json({ error: message }, { status: 401 })
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
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}

export default POST
