import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const bodySchema = z.object({
  integrationId: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  selectedApiVersion: z.string().trim().nullable().optional(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['integrations.manage'] },
} as const

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 422 })

  const container = await createRequestContainer()
  const service = container.resolve('integrationState') as {
    setEnabled: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }, enabled: boolean) => Promise<unknown>
    setVersion: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }, version: string | null) => Promise<unknown>
  }

  const scope = { tenantId: auth.tenantId, organizationId: auth.orgId ?? null }

  if (parsed.data.enabled !== undefined) {
    await service.setEnabled(parsed.data.integrationId, scope, parsed.data.enabled)
  }
  if (parsed.data.selectedApiVersion !== undefined) {
    await service.setVersion(parsed.data.integrationId, scope, parsed.data.selectedApiVersion)
  }

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Update integration state',
  methods: {
    POST: {
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Updated' }],
    },
  },
}
