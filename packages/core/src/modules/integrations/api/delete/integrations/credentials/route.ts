import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const bodySchema = z.object({ integrationId: z.string().trim().min(1) })

export const metadata = {
  DELETE: { requireAuth: true, requireFeatures: ['integrations.credentials'] },
} as const

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'integrationId is required' }, { status: 422 })

  const container = await createRequestContainer()
  const service = container.resolve('integrationCredentials') as {
    remove: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }) => Promise<void>
  }

  await service.remove(parsed.data.integrationId, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Delete integration credentials',
  methods: {
    DELETE: {
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Deleted' }],
      errors: [{ status: 401, description: 'Unauthorized' }, { status: 422, description: 'Invalid body' }],
    },
  },
}
