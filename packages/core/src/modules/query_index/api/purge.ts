import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexPurgeRequestSchema } from './openapi'
import { recordIndexerLog } from '@/lib/indexers/status-log'

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
  let em: any | null = null
  try {
    em = resolve('em')
  } catch {}
  const bus = resolve('eventBus') as any
  await recordIndexerLog(
    { em: em ?? undefined },
    {
      source: 'query_index',
      handler: 'api:query_index.purge',
      message: `Purge requested for ${entityType}`,
      entityType,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    },
  ).catch(() => undefined)
  try {
    await bus.emitEvent('query_index.purge', { entityType, organizationId: auth.orgId, tenantId: auth.tenantId }, { persistent: true })
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.purge',
        message: `Purge queued for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
      },
    ).catch(() => undefined)
  } catch (error) {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.purge',
        level: 'warn',
        message: `Failed to queue purge for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: { error: error instanceof Error ? error.message : String(error) },
      },
    ).catch(() => undefined)
    throw error
  }
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
