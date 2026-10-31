import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'

type PersonRecord = Record<string, unknown> & { id?: string }

type IncidentsSummary = {
  activeCount: number
  hasMajor: boolean
}

type PersonIncidentsEnrichment = {
  _incidents: IncidentsSummary
}

type SqlConnection = {
  execute<T = unknown>(sql: string, params?: unknown[]): Promise<T>
}

type IncidentImpactAggregateRow = {
  target_id: string | null
  active_count: number | string | null
  has_major: boolean | string | null
}

const DEFAULT_INCIDENTS_SUMMARY: IncidentsSummary = {
  activeCount: 0,
  hasMajor: false,
}

const ENRICHER_TIMEOUT_MS = 2000

function resolveSqlConnection(em: unknown): SqlConnection | null {
  const maybeEntityManager = em as { getConnection?: () => unknown } | null
  const connection = maybeEntityManager?.getConnection?.()
  if (!connection || typeof (connection as SqlConnection).execute !== 'function') {
    return null
  }
  return connection as SqlConnection
}

function parseCount(value: number | string | null): number {
  const count = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(count) ? count : 0
}

function parseBoolean(value: boolean | string | null): boolean {
  return value === true || value === 'true' || value === 't'
}

const personIncidentsEnricher: ResponseEnricher<
  PersonRecord,
  PersonIncidentsEnrichment
> = {
  id: 'incidents.person-active-incidents',
  targetEntity: 'customers.person',
  features: ['incidents.incident.view'],
  priority: 10,
  timeout: ENRICHER_TIMEOUT_MS,
  critical: false,
  fallback: { _incidents: DEFAULT_INCIDENTS_SUMMARY },

  async enrichOne(record, ctx) {
    const enriched = await this.enrichMany!([record], ctx)
    return enriched[0]
  },

  async enrichMany(records, ctx: EnricherContext) {
    if (records.length === 0) return []

    const ids = records
      .map((record) => record.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)

    if (ids.length === 0) {
      return records.map((record) => ({
        ...record,
        _incidents: DEFAULT_INCIDENTS_SUMMARY,
      }))
    }

    const connection = resolveSqlConnection(ctx.em)
    if (!connection) {
      return records.map((record) => ({
        ...record,
        _incidents: DEFAULT_INCIDENTS_SUMMARY,
      }))
    }

    const placeholders = ids.map(() => '?').join(', ')
    const rows = await connection.execute<IncidentImpactAggregateRow[]>(
      `select
          ii.target_id::text as target_id,
          count(distinct i.id) as active_count,
          bool_or(ii.impact_status = 'major_outage') as has_major
        from incident_impacts ii
        inner join incidents i
          on i.id = ii.incident_id
          and i.organization_id = ii.organization_id
          and i.tenant_id = ii.tenant_id
        where ii.organization_id = ?
          and ii.tenant_id = ?
          and ii.target_type = 'customer_person'
          and ii.target_id in (${placeholders})
          and ii.deleted_at is null
          and i.deleted_at is null
          and i.status not in ('resolved', 'closed')
        group by ii.target_id`,
      [ctx.organizationId, ctx.tenantId, ...ids],
    )

    const byTargetId = new Map<string, IncidentsSummary>()
    for (const row of rows) {
      if (!row.target_id) continue
      byTargetId.set(row.target_id, {
        activeCount: parseCount(row.active_count),
        hasMajor: parseBoolean(row.has_major),
      })
    }

    return records.map((record) => ({
      ...record,
      _incidents: typeof record.id === 'string'
        ? (byTargetId.get(record.id) ?? DEFAULT_INCIDENTS_SUMMARY)
        : DEFAULT_INCIDENTS_SUMMARY,
    }))
  },
}

export const enrichers: ResponseEnricher[] = [personIncidentsEnricher]
