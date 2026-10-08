import { sql, type Kysely, type RawBuilder, type Transaction } from 'kysely'
import { isStatementTimeoutError } from '../projection/errors'
import type { XrayDatabase } from '../projection/types'
import { AnalyticsTimeoutError, AnalyticsTooLargeError } from './errors'
import { XRAY_ANALYTICS_LIMITS, XRAY_STATEMENT_TIMEOUT_MS, type XrayAgeBucket } from './types'
import type { AnalyticsEventRow, CaseRowSummary } from './trace'
import type { OpenCensus, OpenCensusCell } from './durations'
import { AGE_BUCKET_BOUNDS_MS } from './stats'

export type AnalyticsDb = Kysely<XrayDatabase>

export type AnalyticsTrx = Transaction<XrayDatabase>

/**
 * Organizations an analytics query reads: an explicit list (`organization_id = any(...)`) or
 * `null` for an unrestricted tenant-wide reader. An empty list is answered without a query by
 * the callers (it means "no organization", never "all").
 */
export type QueryScope = {
  tenantId: string
  organizationIds: readonly string[] | null
}

const ISO_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'

function iso(expression: RawBuilder<unknown>): RawBuilder<string | null> {
  return sql<string | null>`to_char(${expression} at time zone 'UTC', ${ISO_FORMAT})`
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** `and <alias>.organization_id = any(...)` for an explicit list, nothing for tenant-wide. */
export function organizationPredicate(alias: string, scope: QueryScope): RawBuilder<unknown> {
  if (scope.organizationIds === null) return sql``
  return sql`and ${sql.ref(`${alias}.organization_id`)} = any(${[...scope.organizationIds]}::uuid[])`
}

/**
 * Runs a read in its own read-only, repeatable-read transaction (one consistent snapshot for
 * every statement of the call) under `SET LOCAL statement_timeout` (5 s by default). A
 * statement cancelled by the timeout (SQLSTATE 57014) surfaces as `AnalyticsTimeoutError`.
 */
export async function runAnalyticsQuery<TResult>(
  db: AnalyticsDb,
  run: (trx: AnalyticsTrx) => Promise<TResult>,
  options: { timeoutMs?: number } = {},
): Promise<TResult> {
  const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? XRAY_STATEMENT_TIMEOUT_MS))
  try {
    return await db
      .transaction()
      .setIsolationLevel('repeatable read')
      .setAccessMode('read only')
      .execute(async (trx) => {
        await sql`set local statement_timeout = ${sql.lit(timeoutMs)}`.execute(trx)
        return run(trx)
      })
  } catch (error) {
    if (isStatementTimeoutError(error)) throw new AnalyticsTimeoutError()
    throw error
  }
}

/** The transaction's clock (`now()` = transaction start), ISO with microseconds. */
export async function readTransactionNow(trx: AnalyticsDb | AnalyticsTrx): Promise<string> {
  const result = await sql<{ now: string }>`select to_char(now() at time zone 'UTC', ${ISO_FORMAT}) as now`.execute(trx)
  const value = result.rows[0]?.now
  if (!value) throw new Error('[internal] Database clock unavailable')
  return value
}

/**
 * The instant through which the projection is complete for every organization in scope: the
 * oldest ingest cursor position (`null` when no organization has been projected yet).
 */
export async function readComputedThrough(trx: AnalyticsDb | AnalyticsTrx, scope: QueryScope): Promise<string | null> {
  const result = await sql<{ computed_through: string | null }>`
    select ${iso(sql`min(cursors.last_created_at)`)} as computed_through
    from insights_process_cursors cursors
    where cursors.tenant_id = ${scope.tenantId} ${organizationPredicate('cursors', scope)}
  `.execute(trx)
  return result.rows[0]?.computed_through ?? null
}

/** Organizations of the tenant with a projection (an ingest cursor), for tenant-wide readers. */
export async function listProjectedOrganizations(db: AnalyticsDb | AnalyticsTrx, tenantId: string): Promise<string[]> {
  const result = await sql<{ organization_id: string }>`
    select cursors.organization_id::text as organization_id
    from insights_process_cursors cursors
    where cursors.tenant_id = ${tenantId}
    order by cursors.organization_id
  `.execute(db)
  return result.rows.map((row) => row.organization_id)
}

type EventQueryRow = {
  organization_id: string
  case_id: string
  activity_key: string
  activity_kind: string
  occurred_at: string
  source_log_id: string
  seq: number | string
  actor_pseudonym: string | null
  actor_role_ids: string[] | null
  actor_team_id: string | null
  cause_kind: string | null
  via_sync_run: boolean
  followup_field: string | null
  followup_value: string | null
  case_started_at: string | null
  case_ended_at: string | null
  case_status: string | null
}

export type CaseEventGroup = {
  organizationId: string
  caseId: string
  rows: AnalyticsEventRow[]
  caseRow: CaseRowSummary | null
}

export type EventQuery = {
  scope: QueryScope
  processKey: string
  registeredKeys: readonly string[]
  from: string
  to: string
  perCaseLimit?: number
  maxEvents?: number
}

/**
 * Every case of the process with a non-voided event in `[from, to)`, with its most recent
 * `perCaseLimit + 1` non-voided events before `to` (ascending; the extra row tells the caller
 * the history was cut) and its stored case summary. Voided events never leave the database;
 * only registered process keys are read. More than `maxEvents` rows raise
 * `AnalyticsTooLargeError` instead of a partial answer.
 */
export async function loadCaseEvents(trx: AnalyticsDb | AnalyticsTrx, query: EventQuery): Promise<CaseEventGroup[]> {
  if (query.scope.organizationIds !== null && query.scope.organizationIds.length === 0) return []
  if (!query.registeredKeys.includes(query.processKey)) return []
  const perCaseLimit = query.perCaseLimit ?? XRAY_ANALYTICS_LIMITS.maxEventsPerCase
  const maxEvents = query.maxEvents ?? XRAY_ANALYTICS_LIMITS.maxEvents
  const scope = query.scope
  const result = await sql<EventQueryRow>`
    with window_cases as (
      select distinct events.organization_id, events.case_id
      from insights_process_events events
      where events.tenant_id = ${scope.tenantId} ${organizationPredicate('events', scope)}
        and events.process_key = ${query.processKey}
        and events.process_key = any(${[...query.registeredKeys]}::text[])
        and not events.voided
        and events.occurred_at >= ${query.from}::timestamptz
        and events.occurred_at < ${query.to}::timestamptz
    )
    select window_cases.organization_id::text as organization_id, window_cases.case_id::text as case_id,
      picked.activity_key, picked.activity_kind,
      ${iso(sql`picked.occurred_at`)} as occurred_at,
      picked.source_log_id::text as source_log_id, picked.seq, picked.actor_pseudonym, picked.actor_role_ids,
      picked.actor_team_id::text as actor_team_id, picked.cause_kind, picked.via_sync_run,
      picked.followup_field, picked.followup_value,
      ${iso(sql`cases.started_at`)} as case_started_at,
      ${iso(sql`cases.ended_at`)} as case_ended_at,
      cases.status as case_status
    from window_cases
    cross join lateral (
      select events.activity_key, events.activity_kind, events.occurred_at, events.source_log_id, events.seq,
        events.actor_pseudonym, events.actor_role_ids, events.actor_team_id, events.cause_kind, events.via_sync_run,
        events.followup_field, events.followup_value
      from insights_process_events events
      where events.tenant_id = ${scope.tenantId}
        and events.organization_id = window_cases.organization_id
        and events.process_key = ${query.processKey}
        and events.case_id = window_cases.case_id
        and not events.voided
        and events.occurred_at < ${query.to}::timestamptz
      order by events.occurred_at desc, events.source_log_id desc, events.seq desc
      limit ${perCaseLimit + 1}
    ) picked
    left join insights_process_cases cases
      on cases.tenant_id = ${scope.tenantId}
      and cases.organization_id = window_cases.organization_id
      and cases.process_key = ${query.processKey}
      and cases.case_id = window_cases.case_id
    order by window_cases.organization_id, window_cases.case_id, picked.occurred_at, picked.source_log_id, picked.seq
    limit ${maxEvents + 1}
  `.execute(trx)
  if (result.rows.length > maxEvents) throw new AnalyticsTooLargeError(maxEvents)
  const groups: CaseEventGroup[] = []
  let current: CaseEventGroup | null = null
  for (const row of result.rows) {
    if (!current || current.organizationId !== row.organization_id || current.caseId !== row.case_id) {
      current = {
        organizationId: row.organization_id,
        caseId: row.case_id,
        rows: [],
        caseRow: row.case_started_at || row.case_status
          ? { startedAt: row.case_started_at, endedAt: row.case_ended_at, status: row.case_status }
          : null,
      }
      groups.push(current)
    }
    current.rows.push({
      organizationId: row.organization_id,
      caseId: row.case_id,
      activityKey: row.activity_key,
      activityKind: row.activity_kind,
      occurredAt: row.occurred_at,
      sourceLogId: row.source_log_id,
      seq: toNumber(row.seq),
      actorPseudonym: row.actor_pseudonym,
      actorRoleIds: row.actor_role_ids,
      actorTeamId: row.actor_team_id,
      causeKind: row.cause_kind,
      viaSyncRun: row.via_sync_run === true,
      followupField: row.followup_field,
      followupValue: row.followup_value,
    })
  }
  return groups
}

type CensusRow = {
  organization_id: string | null
  is_total: boolean
  n: string | number
  median_ms: string | number | null
  p90_ms: string | number | null
  lt_1d: string | number
  d1_7: string | number
  d7_30: string | number
  d30_90: string | number
  gte_90d: string | number
}

function toCensusCell(row: CensusRow | undefined): OpenCensusCell {
  if (!row) return { n: 0, medianMs: null, p90Ms: null, buckets: {} }
  const buckets: Partial<Record<XrayAgeBucket, number>> = {
    lt_1d: toNumber(row.lt_1d),
    '1d_7d': toNumber(row.d1_7),
    '7d_30d': toNumber(row.d7_30),
    '30d_90d': toNumber(row.d30_90),
    gte_90d: toNumber(row.gte_90d),
  }
  return { n: toNumber(row.n), medianMs: toNullableNumber(row.median_ms), p90Ms: toNullableNumber(row.p90_ms), buckets }
}

/**
 * Census of the cases open at `asOf` (started before it, not ended before it), aggregated in
 * SQL per organization and overall: count, median and p90 age, age histogram. These are the
 * right-censored cases; reads the stored case summaries, so event filters do not apply.
 */
export async function loadOpenCensus(
  trx: AnalyticsDb | AnalyticsTrx,
  query: { scope: QueryScope; processKey: string; registeredKeys: readonly string[]; asOf: string },
): Promise<OpenCensus> {
  const empty: OpenCensus = { asOf: query.asOf, overall: toCensusCell(undefined), byOrganization: new Map() }
  if (query.scope.organizationIds !== null && query.scope.organizationIds.length === 0) return empty
  if (!query.registeredKeys.includes(query.processKey)) return empty
  const scope = query.scope
  const result = await sql<CensusRow>`
    select open_cases.organization_id::text as organization_id,
      grouping(open_cases.organization_id) = 1 as is_total,
      count(*) as n,
      percentile_cont(0.5) within group (order by open_cases.age_ms) as median_ms,
      percentile_cont(0.9) within group (order by open_cases.age_ms) as p90_ms,
      count(*) filter (where open_cases.age_ms < ${AGE_BUCKET_BOUNDS_MS.day}) as lt_1d,
      count(*) filter (where open_cases.age_ms >= ${AGE_BUCKET_BOUNDS_MS.day} and open_cases.age_ms < ${AGE_BUCKET_BOUNDS_MS.week}) as d1_7,
      count(*) filter (where open_cases.age_ms >= ${AGE_BUCKET_BOUNDS_MS.week} and open_cases.age_ms < ${AGE_BUCKET_BOUNDS_MS.month}) as d7_30,
      count(*) filter (where open_cases.age_ms >= ${AGE_BUCKET_BOUNDS_MS.month} and open_cases.age_ms < ${AGE_BUCKET_BOUNDS_MS.quarter}) as d30_90,
      count(*) filter (where open_cases.age_ms >= ${AGE_BUCKET_BOUNDS_MS.quarter}) as gte_90d
    from (
      select cases.organization_id,
        greatest(0, extract(epoch from (${query.asOf}::timestamptz - cases.started_at)) * 1000)::double precision as age_ms
      from insights_process_cases cases
      where cases.tenant_id = ${scope.tenantId} ${organizationPredicate('cases', scope)}
        and cases.process_key = ${query.processKey}
        and cases.process_key = any(${[...query.registeredKeys]}::text[])
        and cases.started_at < ${query.asOf}::timestamptz
        and (cases.ended_at is null or cases.ended_at >= ${query.asOf}::timestamptz)
    ) open_cases
    group by grouping sets ((open_cases.organization_id), ())
  `.execute(trx)
  const byOrganization = new Map<string, OpenCensusCell>()
  let overall: CensusRow | undefined
  for (const row of result.rows) {
    if (row.is_total) overall = row
    else if (row.organization_id) byOrganization.set(row.organization_id, toCensusCell(row))
  }
  return { asOf: query.asOf, overall: toCensusCell(overall), byOrganization }
}

/** Registered processes with non-voided events since `since` in one organization. */
export async function listActiveProcessKeys(
  db: AnalyticsDb | AnalyticsTrx,
  query: { tenantId: string; organizationId: string; registeredKeys: readonly string[]; since: string },
): Promise<string[]> {
  if (query.registeredKeys.length === 0) return []
  const result = await sql<{ process_key: string }>`
    select distinct events.process_key
    from insights_process_events events
    where events.tenant_id = ${query.tenantId}
      and events.organization_id = ${query.organizationId}
      and events.process_key = any(${[...query.registeredKeys]}::text[])
      and not events.voided
      and events.occurred_at >= ${query.since}::timestamptz
    order by events.process_key
  `.execute(db)
  return result.rows.map((row) => row.process_key)
}

export type CaseListCursor = {
  at: string
  id: string
}

export type CaseEventFilters = {
  causeKinds?: readonly string[]
  actorRoleIds?: readonly string[]
  actorTeamIds?: readonly string[]
}

export type CaseListQuery = {
  scope: QueryScope
  processKey: string
  registeredKeys: readonly string[]
  from: string
  to: string
  statuses?: readonly string[]
  variantHashes?: readonly string[]
  activityKey?: string
  eventFilters?: CaseEventFilters
  after: CaseListCursor | null
  pageSize: number
}

export type CaseListPage = {
  total: number
  items: Array<{ caseId: string; organizationId: string; lastActivityAt: string }>
  hasMore: boolean
}

function eventExistsClause(query: CaseListQuery): RawBuilder<unknown> {
  const filters = query.eventFilters ?? {}
  const hasCauses = Boolean(filters.causeKinds && filters.causeKinds.length > 0)
  const hasRoles = Boolean(filters.actorRoleIds && filters.actorRoleIds.length > 0)
  const hasTeams = Boolean(filters.actorTeamIds && filters.actorTeamIds.length > 0)
  if (!query.activityKey && !hasCauses && !hasRoles && !hasTeams) return sql``
  return sql`and exists (
    select 1 from insights_process_events events
    where events.tenant_id = cases.tenant_id and events.organization_id = cases.organization_id
      and events.process_key = cases.process_key and events.case_id = cases.case_id
      and not events.voided
      and events.occurred_at >= ${query.from}::timestamptz and events.occurred_at < ${query.to}::timestamptz
      ${query.activityKey ? sql`and events.activity_key = ${query.activityKey}` : sql``}
      ${hasCauses ? sql`and events.cause_kind = any(${[...(filters.causeKinds ?? [])]}::text[])` : sql``}
      ${hasRoles ? sql`and events.actor_role_ids && ${[...(filters.actorRoleIds ?? [])]}::text[]` : sql``}
      ${hasTeams ? sql`and events.actor_team_id = any(${[...(filters.actorTeamIds ?? [])]}::uuid[])` : sql``}
  )`
}

/**
 * Case ids (only) of the process active in the window (started before its end, last activity
 * after its start), newest activity first, keyset-paginated on `(last_activity_at, case_id)`.
 * `variantHashes` match the stored (raw) variant; `activityKey` and the event filters require
 * a non-voided matching event in the window.
 */
export async function listCaseIds(trx: AnalyticsDb | AnalyticsTrx, query: CaseListQuery): Promise<CaseListPage> {
  if (query.scope.organizationIds !== null && query.scope.organizationIds.length === 0) return { total: 0, items: [], hasMore: false }
  if (!query.registeredKeys.includes(query.processKey)) return { total: 0, items: [], hasMore: false }
  const scope = query.scope
  const filters = sql`
    cases.tenant_id = ${scope.tenantId} ${organizationPredicate('cases', scope)}
    and cases.process_key = ${query.processKey}
    and cases.process_key = any(${[...query.registeredKeys]}::text[])
    and cases.started_at < ${query.to}::timestamptz
    and cases.last_activity_at >= ${query.from}::timestamptz
    ${query.statuses && query.statuses.length > 0 ? sql`and cases.status = any(${[...query.statuses]}::text[])` : sql``}
    ${query.variantHashes && query.variantHashes.length > 0 ? sql`and cases.variant_hash = any(${[...query.variantHashes]}::text[])` : sql``}
    ${eventExistsClause(query)}
  `
  const counted = await sql<{ total: string | number }>`
    select count(*) as total from insights_process_cases cases where ${filters}
  `.execute(trx)
  const after = query.after
  const page = await sql<{ case_id: string; organization_id: string; last_activity_at: string }>`
    select cases.case_id::text as case_id, cases.organization_id::text as organization_id,
      ${iso(sql`cases.last_activity_at`)} as last_activity_at
    from insights_process_cases cases
    where ${filters}
      ${after ? sql`and (cases.last_activity_at, cases.case_id) < (${after.at}::timestamptz, ${after.id}::uuid)` : sql``}
    order by cases.last_activity_at desc, cases.case_id desc
    limit ${query.pageSize + 1}
  `.execute(trx)
  const rows = page.rows.slice(0, query.pageSize)
  return {
    total: toNumber(counted.rows[0]?.total),
    items: rows.map((row) => ({ caseId: row.case_id, organizationId: row.organization_id, lastActivityAt: row.last_activity_at })),
    hasMore: page.rows.length > query.pageSize,
  }
}
