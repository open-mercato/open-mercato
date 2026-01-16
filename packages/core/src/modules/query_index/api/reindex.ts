import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexReindexRequestSchema } from './openapi'
import { recordIndexerLog } from '@open-mercato/shared/lib/indexers/status-log'

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
  const batchSize = Number.isFinite(body?.batchSize) ? Math.max(1, Math.trunc(body.batchSize)) : undefined
  const partitionCountInput = Number(body?.partitionCount)
  const partitionCount = Number.isFinite(partitionCountInput)
    ? Math.max(1, Math.trunc(partitionCountInput))
    : 1
  const partitionIndexInput = Number(body?.partitionIndex)
  const partitionIndex = Number.isFinite(partitionIndexInput) ? Math.max(0, Math.trunc(partitionIndexInput)) : undefined
  if (partitionIndex !== undefined && partitionIndex >= partitionCount) {
    return NextResponse.json({ error: 'partitionIndex must be < partitionCount' }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  let em: any | null = null
  try {
    em = resolve('em')
  } catch {}
  const bus = resolve('eventBus') as any
  const partitions = partitionIndex !== undefined
    ? [partitionIndex]
    : Array.from({ length: partitionCount }, (_, idx) => idx)
  const firstPartition = partitions[0] ?? 0
  await recordIndexerLog(
    { em: em ?? undefined },
    {
      source: 'query_index',
      handler: 'api:query_index.reindex',
      message: `Reindex requested for ${entityType}`,
      entityType,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      details: {
        force,
        batchSize: batchSize ?? null,
        partitionCount,
        partitionIndex: partitionIndex ?? null,
      },
    },
  ).catch(() => undefined)
  try {
    await Promise.all(
      partitions.map((part) => {
        const payload: Record<string, unknown> = {
          entityType,
          force,
          batchSize,
          partitionCount,
          partitionIndex: part,
          resetCoverage: part === firstPartition,
        }
        if (auth.tenantId !== undefined) {
          payload.tenantId = auth.tenantId ?? null
        }
        if (auth.orgId !== undefined) {
          payload.organizationId = auth.orgId ?? null
        }
        return bus.emitEvent(
          'query_index.reindex',
          payload,
          { persistent: true },
        )
      }),
    )
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.reindex',
        message: `Reindex queued for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: {
          force,
          batchSize: batchSize ?? null,
          partitionCount,
          partitionIndex: partitionIndex ?? null,
        },
      },
    ).catch(() => undefined)
  } catch (error) {
    await recordIndexerLog(
      { em: em ?? undefined },
      {
        source: 'query_index',
        handler: 'api:query_index.reindex',
        level: 'warn',
        message: `Failed to queue reindex for ${entityType}`,
        entityType,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      },
    ).catch(() => undefined)
    throw error
  }
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
