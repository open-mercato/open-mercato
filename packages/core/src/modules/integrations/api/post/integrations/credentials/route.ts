import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

const bodySchema = z.object({
  integrationId: z.string().trim().min(1),
  credentials: z.record(z.string(), z.unknown()),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['integrations.credentials'] },
} as const

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 422 })
  }

  const container = await createRequestContainer()
  const service = container.resolve('integrationCredentials') as {
    save: (integrationId: string, scope: { tenantId: string; organizationId?: string | null }, credentials: Record<string, unknown>) => Promise<void>
  }

  await service.save(parsed.data.integrationId, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  }, parsed.data.credentials)

  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'Save integration credentials',
  methods: {
    POST: {
      requestBody: { schema: bodySchema },
      responses: [{ status: 200, description: 'Saved' }],
      errors: [{ status: 401, description: 'Unauthorized' }, { status: 422, description: 'Invalid body' }],
    },
  },
}
