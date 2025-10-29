import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexReindexRequestSchema } from './openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['query_index.reindex'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as any
  const entityType = String(body?.entityType || '')
  if (!entityType) return NextResponse.json({ error: 'Missing entityType' }, { status: 400 })
  const force = Boolean(body?.force)

  const { resolve } = await createRequestContainer()
  const bus = resolve('eventBus') as any
  await bus.emitEvent('query_index.reindex', { entityType, tenantId: auth.tenantId, force }, { persistent: true })
  return NextResponse.json({ ok: true })
}

const queryIndexReindexDoc: OpenApiMethodDoc = {
  summary: 'Trigger query index rebuild',
  description: 'Queues a reindex job for the specified entity type within the current tenant scope.',
  tags: [queryIndexTag],
  requestBody: {
    contentType: 'application/json',
    schema: queryIndexReindexRequestSchema,
    description: 'Entity identifier and optional force flag.',
  },
  responses: [
    { status: 200, description: 'Reindex job accepted.', schema: queryIndexOkSchema },
  ],
  errors: [
    { status: 400, description: 'Missing entity type', schema: queryIndexErrorSchema },
    { status: 401, description: 'Authentication required', schema: queryIndexErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: queryIndexTag,
  summary: 'Queue a query index rebuild',
  methods: {
    POST: queryIndexReindexDoc,
  },
}
