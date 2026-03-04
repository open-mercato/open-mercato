import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['gateway_stripe.view'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const container = await createRequestContainer()
  const integrationCredentials = container.resolve('integrationCredentials') as {
    resolve: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<Record<string, unknown> | null>
  }
  const integrationState = container.resolve('integrationState') as {
    setHealth: (
      integrationId: string,
      scope: { tenantId: string; organizationId?: string | null },
      input: { status: 'healthy' | 'unhealthy' | 'unknown'; message?: string | null },
    ) => Promise<void>
  }
  const stripeHealthCheck = container.resolve('stripeHealthCheck') as {
    check: (credentials: Record<string, unknown>) => Promise<{ status: 'healthy' | 'unhealthy'; message: string; details?: Record<string, unknown>; checkedAt: Date }>
  }

  const credentials = await integrationCredentials.resolve('gateway_stripe', {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  const result = await stripeHealthCheck.check(credentials ?? {})

  await integrationState.setHealth('gateway_stripe', {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  }, {
    status: result.status,
    message: result.message,
  })

  return NextResponse.json(result)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Payment Gateways',
  summary: 'Stripe integration health check',
  methods: {
    GET: {
      responses: [{ status: 200, description: 'Health check result' }],
      errors: [{ status: 401, description: 'Unauthorized' }],
    },
  },
}
