import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getWebhookHandler } from '@open-mercato/shared/modules/payment_gateways/types'
import type { PaymentGatewayService } from '../../../../lib/gateway-service'
import { checkWebhookIdempotency, markWebhookProcessed } from '../../../../lib/webhook-utils'
import type { EntityManager } from '@mikro-orm/postgresql'
import { paymentGatewaysTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(req: Request, { params }: { params: { provider: string } }) {
  const providerKey = params.provider
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
  const em = container.resolve('em') as EntityManager

  try {
    const event = await registration.handler({
      rawBody,
      headers,
      credentials: {},
    })

    const paymentIntentId = (event.data.id ?? event.data.payment_intent) as string | undefined
    if (!paymentIntentId) {
      return NextResponse.json({ received: true, skipped: true })
    }

    const transaction = await service.findTransactionBySessionId(paymentIntentId, '')

    if (transaction) {
      const scope = { organizationId: transaction.organizationId, tenantId: transaction.tenantId }
      const alreadyProcessed = await checkWebhookIdempotency(em, event.idempotencyKey, providerKey, scope.organizationId)
      if (alreadyProcessed) {
        return NextResponse.json({ received: true, duplicate: true })
      }

      const adapter = (await import('@open-mercato/shared/modules/payment_gateways/types')).getGatewayAdapter(providerKey)
      if (adapter) {
        const newStatus = adapter.mapStatus(event.data.status as string ?? '', event.eventType)
        if (newStatus !== 'unknown') {
          await service.syncTransactionStatus(transaction.id, {
            unifiedStatus: newStatus,
            providerStatus: event.eventType,
            providerData: event.data,
          })
        }
      }

      await markWebhookProcessed(em, event.idempotencyKey, providerKey, event.eventType, scope)
    }

    return NextResponse.json({ received: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Webhook verification failed'
    return NextResponse.json({ error: message }, { status: 400 })
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
        { status: 200, description: 'Webhook received' },
        { status: 400, description: 'Signature verification failed' },
        { status: 404, description: 'Unknown provider' },
      ],
    },
  },
}
