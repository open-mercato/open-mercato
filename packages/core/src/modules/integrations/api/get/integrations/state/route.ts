import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const querySchema = z.object({ integrationId: z.string().trim().min(1) })

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({ integrationId: url.searchParams.get('integrationId') })
  if (!parsed.success) return NextResponse.json({ error: 'integrationId is required' }, { status: 422 })

  const container = await createRequestContainer()
  const service = container.resolve('integrationState') as {
    get: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<{
      isEnabled: boolean
      selectedApiVersion?: string | null
      healthStatus?: string | null
      healthMessage?: string | null
      healthCheckedAt?: Date | null
    } | null>
  }

  const state = await service.get(parsed.data.integrationId, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  return NextResponse.json({
    integrationId: parsed.data.integrationId,
    state: state
      ? {
          isEnabled: state.isEnabled,
          selectedApiVersion: state.selectedApiVersion ?? null,
          healthStatus: state.healthStatus ?? 'unknown',
          healthMessage: state.healthMessage ?? null,
          healthCheckedAt: state.healthCheckedAt ? state.healthCheckedAt.toISOString() : null,
        }
      : null,
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Get integration state',
  methods: {
    GET: {
      query: querySchema,
      responses: [{ status: 200, description: 'State payload' }],
    },
  },
}
