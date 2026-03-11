import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../../../../integrations/lib/credentials-service'
import { getShippingAdapter } from '../../../lib/adapter-registry'
import type { ShippingCarrierService } from '../../../lib/shipping-service'
import { getShippingCarrierQueue } from '../../../lib/queue'
import { shippingCarriersTag } from '../../openapi'

export const metadata = {
  path: '/shipping-carriers/webhook/[provider]',
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

  const rawBody = await req.text()
  const headers: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    headers[key] = value
  })

  const container = await createRequestContainer()
  const service = container.resolve('shippingCarrierService') as ShippingCarrierService
  const integrationCredentialsService = container.resolve('integrationCredentialsService') as CredentialsService
  const queue = getShippingCarrierQueue('shipping-carriers-webhook')
  const payload = readJsonSafe(rawBody)
  const carrierShipmentId = readCarrierShipmentId(payload)

  try {
    const shipment = carrierShipmentId
      ? await service.findShipmentByCarrierId(providerKey, carrierShipmentId, '')
      : null
    const scope = shipment
      ? { organizationId: shipment.organizationId, tenantId: shipment.tenantId }
      : null
    const credentials = scope
      ? await integrationCredentialsService.resolve(`carrier_${providerKey}`, scope) ?? {}
      : {}

    const event = await adapter.verifyWebhook({ rawBody, headers, credentials })
    await queue.enqueue({
      name: 'shipping-carrier-webhook',
      payload: {
        providerKey,
        event,
        shipmentId: shipment?.id ?? null,
        scope,
      },
    })

    return NextResponse.json({ received: true, queued: true }, { status: 202 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Webhook verification failed'
    return NextResponse.json({ error: message }, { status: 401 })
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
