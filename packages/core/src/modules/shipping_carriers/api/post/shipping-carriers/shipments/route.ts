import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createCarrierShipment } from '../../../../lib/shipping-service'
import { CarrierShipment } from '../../../../data/entities'

const addressSchema = z.object({
  countryCode: z.string().trim().length(2),
  postalCode: z.string().trim().optional(),
  city: z.string().trim().optional(),
  line1: z.string().trim().optional(),
  line2: z.string().trim().optional(),
  state: z.string().trim().optional(),
})

const bodySchema = z.object({
  providerKey: z.string().trim().min(1),
  orderId: z.string().uuid(),
  origin: addressSchema,
  destination: addressSchema,
  packages: z.array(z.object({
    weightKg: z.coerce.number().positive().optional(),
    lengthCm: z.coerce.number().positive().optional(),
    widthCm: z.coerce.number().positive().optional(),
    heightCm: z.coerce.number().positive().optional(),
  })).default([]),
  serviceCode: z.string().trim().min(1),
  labelFormat: z.enum(['pdf', 'zpl', 'png']).optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['shipping_carriers.manage'] },
} as const

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const em = (container.resolve('em') as any).fork()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }

  const credentials = await integrationCredentials.resolve(`carrier_${parsed.data.providerKey}`, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  try {
    const result = await createCarrierShipment(parsed.data.providerKey, {
      orderId: parsed.data.orderId,
      origin: parsed.data.origin,
      destination: parsed.data.destination,
      packages: parsed.data.packages,
      serviceCode: parsed.data.serviceCode,
      labelFormat: parsed.data.labelFormat,
      credentials: credentials ?? {},
    })

    const row = em.create(CarrierShipment, {
      providerKey: parsed.data.providerKey,
      orderId: parsed.data.orderId,
      carrierShipmentId: result.shipmentId,
      trackingNumber: result.trackingNumber,
      status: result.status,
      labelUrl: result.labelUrl ?? null,
      carrierData: {
        estimatedDelivery: result.estimatedDelivery ? result.estimatedDelivery.toISOString() : null,
      },
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    })
    await em.persistAndFlush(row)

    return NextResponse.json({
      shipmentId: row.id,
      carrierShipmentId: result.shipmentId,
      trackingNumber: result.trackingNumber,
      status: result.status,
    }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to create shipment' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Shipping Carriers',
  summary: 'Create shipment',
  methods: {
    POST: {
      requestBody: { schema: bodySchema },
      responses: [{ status: 201, description: 'Shipment created' }],
      errors: [{ status: 422, description: 'Validation failed' }, { status: 502, description: 'Carrier upstream error' }],
    },
  },
}
