import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import type { PaymentGatewayService } from '../../../lib/gateway-service'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { getPaymentGatewayQueue } from '../../../lib/queue'
import { paymentGatewaysTag } from '../../openapi'

export const metadata = {
  POST: { requireAuth: false },
}

function readJsonSafe(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function readSessionIdHint(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const data = payload.data
  if (data && typeof data === 'object') {
    const nestedObject = (data as Record<string, unknown>).object
    if (nestedObject && typeof nestedObject === 'object') {
      const nestedId = (nestedObject as Record<string, unknown>).id
      if (typeof nestedId === 'string' && nestedId.trim().length > 0) return nestedId.trim()
      const nestedPaymentIntent = (nestedObject as Record<string, unknown>).payment_intent
      if (typeof nestedPaymentIntent === 'string' && nestedPaymentIntent.trim().length > 0) return nestedPaymentIntent.trim()
    }
  }
  const id = payload.id
  if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  return null
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> | { provider: string } }) {
  const resolvedParams = await params
  const providerKey = resolvedParams.provider
  const registration = getWebhookHandler(providerKey)
  if (!registration) {
    return NextResponse.json({ error: `No webhook handler for provider: ${providerKey}` }, { status: 404 })
  }

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const container = await createRequestContainer()
  const service = container.resolve('paymentGatewayService') as PaymentGatewayService
  const integrationCredentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const queue = getPaymentGatewayQueue(registration.queue ?? 'payment-gateways-webhook')
  const payload = readJsonSafe(rawBody)
  const sessionIdHint = readSessionIdHint(payload)

  try {
    const transaction = sessionIdHint
      ? await service.findTransactionBySessionId(sessionIdHint, providerKey)
      : null
    const scope = transaction
      ? { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
      : null
    const credentials = scope
      ? await integrationCredentialsService.resolve(`gateway_${providerKey}`, scope) ?? {}
      : {}

    const event = await registration.handler({
      rawBody,
      headers,
      credentials,
    })

    await queue.enqueue({
      name: 'payment-gateway-webhook',
      payload: {
        providerKey,
        event,
        transactionId: transaction?.id ?? null,
        scope,
      },
    })

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
