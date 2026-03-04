import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { IntegrationLog } from '../../../data/entities'

const querySchema = z.object({
  integrationId: z.string().trim().min(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['integrations.view'] },
} as const

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    integrationId: url.searchParams.get('integrationId'),
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid query', details: parsed.error.flatten() }, { status: 422 })

  const container = await createRequestContainer()
  const em = container.resolve('em') as { find: (entity: unknown, where: Record<string, unknown>, options: Record<string, unknown>) => Promise<IntegrationLog[]> }

  const items = await em.find(IntegrationLog, {
    integrationId: parsed.data.integrationId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
    deletedAt: null,
  }, {
    orderBy: { createdAt: 'desc' },
    limit: parsed.data.pageSize,
  })

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      level: item.level,
      code: item.code,
      message: item.message,
      correlationId: item.correlationId ?? null,
      details: item.detailsJson ?? null,
      createdAt: item.createdAt.toISOString(),
    })),
  })
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Integrations',
  summary: 'List integration logs',
  methods: {
    GET: {
      query: querySchema,
      responses: [{ status: 200, description: 'Log entries' }],
    },
  },
}
