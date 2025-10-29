import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexPurgeRequestSchema } from './openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['query_index.purge'] },
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({})) as any
  const entityType = String(body?.entityType || '')
  if (!entityType) return NextResponse.json({ error: 'Missing entityType' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const bus = resolve('eventBus') as any
  await bus.emitEvent('query_index.purge', { entityType, organizationId: auth.orgId, tenantId: auth.tenantId }, { persistent: true })
  return NextResponse.json({ ok: true })
}

const queryIndexPurgeDoc: OpenApiMethodDoc = {
  summary: 'Purge query index records',
  description: 'Queues a purge job to remove indexed records for an entity type within the active scope.',
  tags: [queryIndexTag],
  requestBody: {
    contentType: 'application/json',
    schema: queryIndexPurgeRequestSchema,
    description: 'Entity identifier whose index entries should be removed.',
  },
  responses: [
    { status: 200, description: 'Purge job accepted.', schema: queryIndexOkSchema },
  ],
  errors: [
    { status: 400, description: 'Missing entity type', schema: queryIndexErrorSchema },
    { status: 401, description: 'Authentication required', schema: queryIndexErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: queryIndexTag,
  summary: 'Queue a query index purge',
  methods: {
    POST: queryIndexPurgeDoc,
  },
}

