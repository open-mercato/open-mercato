import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import { readCoverageSnapshot, refreshCoverageSnapshot } from '../lib/coverage'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexStatusResponseSchema } from './openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['query_index.status.view'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const knex = (em as any).getConnection().getKnex()
  const orgId = auth.orgId
  const tenantId = auth.tenantId ?? null
  const url = new URL(req.url)
  const forceRefresh = url.searchParams.has('refresh') && url.searchParams.get('refresh') !== '0'

  // Generated entities from code
  const generated: { entityId: string; label: string }[] = []
  for (const modId of Object.keys(AllEntities)) {
    const entities = (AllEntities as any)[modId] as Record<string, string>
    for (const k of Object.keys(entities)) {
      const id = entities[k]
      generated.push({ entityId: id, label: id })
    }
  }

  // Only include code-defined entities in Query Index status.
  // User-defined entities are stored outside the index and should not appear here.
  const byId = new Map<string, { entityId: string; label: string }>()
  for (const g of generated) byId.set(g.entityId, g)

  let entityIds = Array.from(byId.values()).map((x) => x.entityId).sort()

  // Limit to entities that have active custom field definitions in current scope
  try {
    const cfRows = await knex('custom_field_defs')
      .distinct('entity_id')
      .where({ is_active: true })
      .modify((qb: any) => {
        qb.andWhere((b: any) => b.where({ organization_id: orgId }).orWhereNull('organization_id'))
        if (tenantId != null) qb.andWhere((b: any) => b.where({ tenant_id: tenantId }).orWhereNull('tenant_id'))
      })
    const enabled = new Set<string>((cfRows || []).map((r: any) => String(r.entity_id)))
    entityIds = entityIds.filter((id) => enabled.has(id))
  } catch {}

  const HEARTBEAT_STALE_MS = 60_000

  async function fetchJobSummary(entityType: string, tenantIdParam: string | null) {
    try {
      const rows = await knex('entity_index_jobs')
        .where({ entity_type: entityType })
        .modify((qb: any) => {
          qb.andWhereRaw('tenant_id is not distinct from ?', [tenantIdParam ?? null])
        })
        .orderBy('started_at', 'desc')

      if (!rows.length) {
        return { status: 'idle' as const, partitions: [] as any[] }
      }

      const partitions = rows.map((row: any) => {
        const heartbeatAt = row.heartbeat_at ? new Date(row.heartbeat_at) : null
        const stalled = !row.finished_at && (!heartbeatAt || (Date.now() - heartbeatAt.getTime()) > HEARTBEAT_STALE_MS)
        const state = row.finished_at
          ? 'completed'
          : stalled
            ? 'stalled'
            : (row.status as string) || 'reindexing'
        return {
          partitionIndex: row.partition_index ?? null,
          partitionCount: row.partition_count ?? null,
          status: state,
          startedAt: row.started_at ?? null,
          finishedAt: row.finished_at ?? null,
          heartbeatAt: row.heartbeat_at ?? null,
          processedCount: row.processed_count ?? null,
          totalCount: row.total_count ?? null,
        }
      })

      const activePartitions = partitions.filter((p) => !p.finishedAt)
      let status: 'idle' | 'reindexing' | 'purging' | 'stalled' = 'idle'
      if (activePartitions.length) {
        if (activePartitions.some((p) => p.status === 'stalled')) status = 'stalled'
        else if (activePartitions.some((p) => p.status === 'purging')) status = 'purging'
        else status = 'reindexing'
      }

      const startedAt = activePartitions[0]?.startedAt ?? partitions[0]?.startedAt ?? null
      const finishedAt = status === 'idle' ? (partitions.find((p) => p.finishedAt)?.finishedAt ?? null) : null
      const heartbeatAt = activePartitions[0]?.heartbeatAt ?? partitions[0]?.heartbeatAt ?? null
      const processedCount = activePartitions.reduce((acc, p) => acc + (p.processedCount ?? 0), 0)
      const totalCount = activePartitions.reduce((acc, p) => acc + (p.totalCount ?? 0), 0)

      return {
        status,
        startedAt,
        finishedAt,
        heartbeatAt,
        processedCount: totalCount > 0 ? processedCount : null,
        totalCount: totalCount > 0 ? totalCount : null,
        partitions: activePartitions,
      }
    } catch {
      return { status: 'idle' as const, partitions: [] as any[] }
    }
  }

  const normalizeCount = (value: unknown): number | null => {
    if (value == null) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const COVERAGE_STALE_MS = 60_000

  if (forceRefresh) {
    await Promise.all(
      entityIds.map((entityId) =>
        refreshCoverageSnapshot(em, {
          entityType: entityId,
          tenantId: tenantId ?? null,
          organizationId: null,
          withDeleted: false,
        }).catch(() => undefined)
      )
    )
  }

  const coverageSnapshots = await Promise.all(
    entityIds.map((entityId) =>
      readCoverageSnapshot(knex, {
        entityType: entityId,
        tenantId: tenantId ?? null,
        organizationId: null,
        withDeleted: false,
      })
    )
  )

  const jobs = await Promise.all(entityIds.map((eid) => fetchJobSummary(eid, tenantId)))

  const entitiesNeedingRefresh = new Set<string>()
  const items: any[] = []
  for (let idx = 0; idx < entityIds.length; idx += 1) {
    const eid = entityIds[idx]
    let coverage = coverageSnapshots[idx]

    const refreshedAt = coverage?.refreshed_at instanceof Date ? coverage.refreshed_at : coverage?.refreshed_at ? new Date(coverage.refreshed_at) : null
    const isStale = !coverage || !refreshedAt || (Date.now() - refreshedAt.getTime() > COVERAGE_STALE_MS)
    if (isStale) entitiesNeedingRefresh.add(eid)

    const job = jobs[idx]
    const label = (byId.get(eid)?.label) || eid
    const baseCountNumber = normalizeCount(coverage?.baseCount)
    const indexCountNumber = normalizeCount(coverage?.indexedCount)
    const ok = baseCountNumber != null && indexCountNumber != null ? baseCountNumber === indexCountNumber : false
    items.push({
      entityId: eid,
      label,
      baseCount: baseCountNumber,
      indexCount: indexCountNumber,
      ok,
      job,
      refreshedAt: refreshedAt ?? null,
    })
  }

  if (!forceRefresh) {
    try {
      const eventBus = resolve('eventBus')
      if (entitiesNeedingRefresh.size > 0) {
        await Promise.all(
          Array.from(entitiesNeedingRefresh).map((entityId) =>
            eventBus
              .emitEvent('query_index.coverage.refresh', {
                entityType: entityId,
                tenantId: tenantId ?? null,
                organizationId: null,
                delayMs: 0,
              })
              .catch(() => undefined)
          )
        )
      }
    } catch {}
  }

  const response = NextResponse.json({ items })
  const partial = items.find((item) => item.ok === false)
  if (partial) {
    response.headers.set(
      'x-om-partial-index',
      JSON.stringify({
        type: 'partial_index',
        entity: partial.entityId,
        baseCount: partial.baseCount,
        indexedCount: partial.indexCount,
        scope: 'global',
      })
    )
  }
  return response
}

const queryIndexStatusDoc: OpenApiMethodDoc = {
  summary: 'Inspect query index coverage',
  description: 'Returns entity counts comparing base tables with the query index along with the latest job status.',
  tags: [queryIndexTag],
  responses: [
    { status: 200, description: 'Current query index status.', schema: queryIndexStatusResponseSchema },
  ],
  errors: [
    { status: 401, description: 'Authentication required', schema: queryIndexErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: queryIndexTag,
  summary: 'Query index status',
  methods: {
    GET: queryIndexStatusDoc,
  },
}
