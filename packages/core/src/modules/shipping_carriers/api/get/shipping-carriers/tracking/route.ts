import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getCarrierTracking } from '../../../../lib/shipping-service'

const querySchema = z.object({
  providerKey: z.string().trim().min(1),
  trackingNumber: z.string().trim().min(1),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['shipping_carriers.view'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    providerKey: url.searchParams.get('providerKey'),
    trackingNumber: url.searchParams.get('trackingNumber'),
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 422 })

  const container = await createRequestContainer()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }
  const credentials = await integrationCredentials.resolve(`carrier_${parsed.data.providerKey}`, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  })

  try {
    const tracking = await getCarrierTracking(parsed.data.providerKey, {
      trackingNumber: parsed.data.trackingNumber,
      credentials: credentials ?? {},
    })
    return NextResponse.json(tracking)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to fetch tracking' }, { status: 502 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Shipping Carriers',
  summary: 'Get tracking status',
  methods: {
    GET: {
      query: querySchema,
      responses: [{ status: 200, description: 'Tracking data' }],
      errors: [{ status: 422, description: 'Validation failed' }, { status: 502, description: 'Carrier upstream error' }],
    },
  },
}
