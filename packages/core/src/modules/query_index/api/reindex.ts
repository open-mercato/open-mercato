import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexOkSchema, queryIndexReindexRequestSchema } from './openapi'
import { DEFAULT_REINDEX_PARTITIONS } from '../lib/reindexer'

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
    : DEFAULT_REINDEX_PARTITIONS
  const partitionIndexInput = Number(body?.partitionIndex)
  const partitionIndex = Number.isFinite(partitionIndexInput) ? Math.max(0, Math.trunc(partitionIndexInput)) : undefined
  if (partitionIndex !== undefined && partitionIndex >= partitionCount) {
    return NextResponse.json({ error: 'partitionIndex must be < partitionCount' }, { status: 400 })
  }

  const { resolve } = await createRequestContainer()
  const bus = resolve('eventBus') as any
  const partitions = partitionIndex !== undefined
    ? [partitionIndex]
    : Array.from({ length: partitionCount }, (_, idx) => idx)
  const firstPartition = partitions[0] ?? 0
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
      return bus.emitEvent(
        'query_index.reindex',
        payload,
        { persistent: true },
      )
    }),
  )
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
