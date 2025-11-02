import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { E as AllEntities } from '@/generated/entities.ids.generated'
import type { EntityManager } from '@mikro-orm/postgresql'
import { readCoverageSnapshot, refreshCoverageSnapshot } from '../lib/coverage'
import type { VectorIndexService } from '@open-mercato/vector'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { queryIndexTag, queryIndexErrorSchema, queryIndexStatusResponseSchema } from './openapi'
import { flattenSystemEntityIds } from '@open-mercato/shared/lib/entities/system-entities'

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
  const tenantRaw = auth.tenantId
  const tenantId = typeof tenantRaw === 'string'
    ? (tenantRaw && tenantRaw !== 'undefined' ? tenantRaw.trim() || null : null)
    : tenantRaw ?? null
  const url = new URL(req.url)
  const forceRefresh = url.searchParams.has('refresh') && url.searchParams.get('refresh') !== '0'

  const generatedIds = flattenSystemEntityIds(AllEntities as Record<string, Record<string, string>>)
  const generated = generatedIds.map((entityId) => ({ entityId, label: entityId }))

  const byId = new Map<string, { entityId: string; label: string }>()
  for (const g of generated) byId.set(g.entityId, g)

  let entityIds = generatedIds.slice()

  let vectorService: VectorIndexService | null = null
  try {
    vectorService = resolve('vectorIndexService') as VectorIndexService
  } catch {
    vectorService = null
  }

  let vectorEnabledEntities = new Set<string>()
  if (vectorService && typeof vectorService.listEnabledEntities === 'function') {
    try {
      vectorEnabledEntities = new Set(vectorService.listEnabledEntities())
    } catch {}
  }

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
  const COVERAGE_STALE_MS = 60_000

  async function fetchJobSummary(entityType: string, tenantIdParam: string | null, organizationIdParam: string | null) {
    try {
      const rows = await knex('entity_index_jobs')
        .where({ entity_type: entityType })
        .andWhere((qb: any) => {
          if (tenantIdParam != null) {
            qb.whereRaw('tenant_id is not distinct from ?', [tenantIdParam])
          } else {
            qb.whereRaw('tenant_id is not distinct from ?', [null])
          }
        })
        .andWhere((qb: any) => {
          if (organizationIdParam != null) {
            qb.whereRaw('organization_id is not distinct from ?', [organizationIdParam]).orWhereNull('organization_id')
          } else {
            qb.whereRaw('organization_id is not distinct from ?', [null])
          }
        })
        .orderBy('started_at', 'desc')

      if (!rows.length) {
        return { status: 'idle' as const, partitions: [] as any[] }
      }

      const preferOrg =
        organizationIdParam != null && rows.some((row: any) => row.organization_id === organizationIdParam)
      const pickPreferred = <T extends { startedTs: number; tenantMatch: boolean; orgMatch: boolean }>(
        existing: T | null,
        candidate: T,
      ): T => {
        if (!existing) return candidate
        if (preferOrg) {
          if (candidate.orgMatch && !existing.orgMatch) return candidate
          if (!candidate.orgMatch && existing.orgMatch) return existing
        }
        if (candidate.tenantMatch && !existing.tenantMatch) return candidate
        if (!candidate.tenantMatch && existing.tenantMatch) return existing
        return candidate.startedTs > existing.startedTs ? candidate : existing
      }

      const partitionRows = new Map<string, { row: any; startedTs: number; tenantMatch: boolean; orgMatch: boolean }>()
      let scopeRow: { row: any; startedTs: number; tenantMatch: boolean; orgMatch: boolean } | null = null
      for (const row of rows) {
        const key = String(row.partition_index ?? '__null__')
        const startedTs = row.started_at ? new Date(row.started_at).getTime() : 0
        const tenantMatch = tenantIdParam != null ? row.tenant_id === tenantIdParam : true
        const orgMatch = organizationIdParam != null ? row.organization_id === organizationIdParam : row.organization_id == null
        const candidate = { row, startedTs, tenantMatch, orgMatch }
        if (row.partition_index == null) {
          scopeRow = pickPreferred(scopeRow, candidate)
          continue
        }
        const existing = partitionRows.get(key)
        partitionRows.set(key, pickPreferred(existing ?? null, candidate))
      }

      const partitions = Array.from(partitionRows.values())
        .filter((entry) => !preferOrg || entry.orgMatch)
        .map(({ row }) => {
          const heartbeatDate = row.heartbeat_at ? new Date(row.heartbeat_at) : null
          const startedDate = row.started_at ? new Date(row.started_at) : null
          const finishedDate = row.finished_at ? new Date(row.finished_at) : null
          const stalled =
            !finishedDate && (!heartbeatDate || Date.now() - heartbeatDate.getTime() > HEARTBEAT_STALE_MS)
          const state = finishedDate
            ? 'completed'
            : stalled
              ? 'stalled'
              : (row.status as string) || 'reindexing'
          return {
            partitionIndex: row.partition_index ?? null,
            partitionCount: row.partition_count ?? null,
            status: state,
            startedAt: startedDate ? startedDate.toISOString() : null,
            finishedAt: finishedDate ? finishedDate.toISOString() : null,
            heartbeatAt: heartbeatDate ? heartbeatDate.toISOString() : null,
            processedCount: row.processed_count ?? null,
            totalCount: row.total_count ?? null,
          }
        })
        .sort((a, b) => (a.partitionIndex ?? 0) - (b.partitionIndex ?? 0))
      const activePartitions = partitions.filter((p) => !p.finishedAt)
      const runningPartitions = activePartitions.filter(
        (p) => p.status === 'reindexing' || p.status === 'purging',
      )
      const stalledPartitions = activePartitions.filter((p) => p.status === 'stalled')
      let status: 'idle' | 'reindexing' | 'purging' | 'stalled' = 'idle'
      if (activePartitions.length) {
        if (runningPartitions.length) {
          status = runningPartitions.some((p) => p.status === 'purging') ? 'purging' : 'reindexing'
        } else if (stalledPartitions.length) {
          status = 'stalled'
        }
      }

      const startedAt = activePartitions[0]?.startedAt ?? partitions[0]?.startedAt ?? null
      const finishedAt = status === 'idle' ? (partitions.find((p) => p.finishedAt)?.finishedAt ?? null) : null
      const heartbeatAt = activePartitions[0]?.heartbeatAt ?? partitions[0]?.heartbeatAt ?? null
      const jobTotalCount = partitions.reduce((sum, p) => sum + (p.totalCount ?? 0), 0)
      const processedSum = partitions.reduce((sum, p) => sum + (p.processedCount ?? 0), 0)
      const processedCount = jobTotalCount ? Math.min(jobTotalCount, processedSum) : processedSum || null
      const scopeCandidate = !preferOrg || !scopeRow || scopeRow.orgMatch ? scopeRow : null

      return {
        status,
        startedAt,
        finishedAt,
        heartbeatAt,
        processedCount: jobTotalCount ? processedCount : scopeCandidate?.row?.processed_count ?? null,
        totalCount: jobTotalCount ? jobTotalCount : scopeCandidate?.row?.total_count ?? null,
        partitions,
        scope: scopeCandidate
          ? {
              status: (() => {
                const heartbeatDate = scopeCandidate!.row.heartbeat_at ? new Date(scopeCandidate!.row.heartbeat_at) : null
                const finishedDate = scopeCandidate!.row.finished_at ? new Date(scopeCandidate!.row.finished_at) : null
                if (finishedDate) return 'completed'
                if (
                  !heartbeatDate ||
                  Date.now() - heartbeatDate.getTime() > HEARTBEAT_STALE_MS
                ) {
                  return 'stalled'
                }
                return (scopeCandidate!.row.status as string) || 'reindexing'
              })(),
              processedCount: scopeCandidate.row.processed_count ?? null,
              totalCount: scopeCandidate.row.total_count ?? null,
            }
          : null,
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

  const coverageSnapshots: Array<Awaited<ReturnType<typeof readCoverageSnapshot>>> = []
  const entitiesNeedingRefresh = new Set<string>()
  for (const entityId of entityIds) {
    const scope = {
      entityType: entityId,
      tenantId: tenantId ?? null,
      organizationId: null,
      withDeleted: false,
    } as const
    const ensureSnapshot = async () => {
      let snapshot = await readCoverageSnapshot(knex, scope)
      const refreshedAt = snapshot?.refreshed_at instanceof Date
        ? snapshot.refreshed_at
        : snapshot?.refreshed_at
          ? new Date(snapshot.refreshed_at)
          : null
      const stale = !snapshot || !refreshedAt || (Date.now() - refreshedAt.getTime() > COVERAGE_STALE_MS)
      if (forceRefresh || stale) {
        await refreshCoverageSnapshot(em, scope, { vectorService }).catch(() => undefined)
        snapshot = await readCoverageSnapshot(knex, scope)
      }
      const finalRefreshed = snapshot?.refreshed_at instanceof Date
        ? snapshot.refreshed_at
        : snapshot?.refreshed_at
          ? new Date(snapshot.refreshed_at)
          : null
      if (!snapshot || !finalRefreshed || (Date.now() - finalRefreshed.getTime() > COVERAGE_STALE_MS)) {
        entitiesNeedingRefresh.add(entityId)
      }
      return snapshot
    }
    coverageSnapshots.push(await ensureSnapshot())
  }

  const jobs = await Promise.all(entityIds.map((eid) => fetchJobSummary(eid, tenantId, orgId)))

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
    const vectorEnabled = vectorEnabledEntities.has(eid)
    const vectorCountNumber = vectorEnabled ? normalizeCount((coverage as any)?.vectorIndexedCount ?? (coverage as any)?.vector_indexed_count) : null
    const ok = (() => {
      if (baseCountNumber == null || indexCountNumber == null) return false
      if (baseCountNumber !== indexCountNumber) return false
      if (!vectorEnabled) return true
      return vectorCountNumber != null && vectorCountNumber === baseCountNumber
    })()
    items.push({
      entityId: eid,
      label,
      baseCount: baseCountNumber,
      indexCount: indexCountNumber,
      vectorCount: vectorEnabled ? vectorCountNumber : null,
      vectorEnabled,
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

  const errorRows = await knex('indexer_error_logs')
    .modify((qb: any) => {
      if (tenantId != null) {
        qb.where((inner: any) => {
          inner.where('tenant_id', tenantId).orWhereNull('tenant_id')
        })
      } else {
        qb.whereNull('tenant_id')
      }
    })
        .andWhere((qb: any) => {
      qb.whereNull('organization_id').orWhere('organization_id', orgId)
    })
    .orderBy('occurred_at', 'desc')
    .limit(100)

  const errors = errorRows.map((row: any) => {
    const occurredAt = row.occurred_at instanceof Date ? row.occurred_at : row.occurred_at ? new Date(row.occurred_at) : null
    return {
      id: String(row.id),
      source: String(row.source ?? ''),
      handler: String(row.handler ?? ''),
      entityType: row.entity_type ?? null,
      recordId: row.record_id ?? null,
      tenantId: row.tenant_id ?? null,
      organizationId: row.organization_id ?? null,
      message: String(row.message ?? ''),
      stack: row.stack ?? null,
      payload: row.payload ?? null,
      occurredAt: occurredAt ? occurredAt.toISOString() : new Date().toISOString(),
    }
  })

  const logRows = await knex('indexer_status_logs')
    .modify((qb: any) => {
      if (tenantId != null) {
        qb.where((inner: any) => {
          inner.where('tenant_id', tenantId).orWhereNull('tenant_id')
        })
      } else {
        qb.whereNull('tenant_id')
      }
    })
    .andWhere((qb: any) => {
      qb.whereNull('organization_id').orWhere('organization_id', orgId)
    })
    .orderBy('occurred_at', 'desc')
    .limit(100)

  const logs = logRows.map((row: any) => {
    const occurredAt = row.occurred_at instanceof Date ? row.occurred_at : row.occurred_at ? new Date(row.occurred_at) : null
    const level = row.level === 'warn' ? 'warn' : 'info'
    return {
      id: String(row.id),
      source: String(row.source ?? ''),
      handler: String(row.handler ?? ''),
      level,
      entityType: row.entity_type ?? null,
      recordId: row.record_id ?? null,
      tenantId: row.tenant_id ?? null,
      organizationId: row.organization_id ?? null,
      message: String(row.message ?? ''),
      details: row.details ?? null,
      occurredAt: occurredAt ? occurredAt.toISOString() : new Date().toISOString(),
    }
  })

  const response = NextResponse.json({ items, errors, logs })
  const partial = items.find((item) => {
    if (item.baseCount == null || item.indexCount == null) return true
    return item.baseCount !== item.indexCount
  })
  if (partial) {
    response.headers.set(
      'x-om-partial-index',
      JSON.stringify({
        type: 'partial_index',
        entity: partial.entityId,
        entityLabel: partial.label ?? partial.entityId,
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
