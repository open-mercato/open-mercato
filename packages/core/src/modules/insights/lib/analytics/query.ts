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

/**
 * True unless the organization's saved X-Ray settings (not soft-deleted) disable it: a disabled
 * organization is never read, whatever rows it still holds until retention prunes them.
 */
function enabledOrganization(tenantId: string, organizationColumn: RawBuilder<unknown>): RawBuilder<unknown> {
  return sql`not exists (
    select 1 from insights_process_settings disabled_settings
    where disabled_settings.tenant_id = ${tenantId}
      and disabled_settings.organization_id = ${organizationColumn}
      and disabled_settings.enabled = false
      and disabled_settings.deleted_at is null
  )`
}

/**
 * `and <alias>.organization_id = any(...)` for an explicit list (the callers have already
 * removed disabled organizations from it); for a tenant-wide reader, every organization of the
 * tenant except those whose settings disable X-Ray.
 */
export function organizationPredicate(alias: string, scope: QueryScope): RawBuilder<unknown> {
  if (scope.organizationIds === null) return sql`and ${enabledOrganization(scope.tenantId, sql.ref(`${alias}.organization_id`))}`
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

export type ProjectionState = {
  computedThrough: string | null
  incomplete: boolean
}

/**
 * The tenant's X-Ray organizations for a tenant-wide reader: those with an ingest cursor
 * (projected events exist only for them) or with a settings row (their k-anonymity and
 * per-person switch must apply even before their first ingest), except organizations whose
 * settings disable X-Ray (they are not read, so they never make the view incomplete).
 */
function tenantOrganizations(tenantId: string): RawBuilder<unknown> {
  return sql`
    select candidates.organization_id from (
      select cursors.organization_id from insights_process_cursors cursors where cursors.tenant_id = ${tenantId}
      union
      select settings.organization_id from insights_process_settings settings where settings.tenant_id = ${tenantId}
    ) candidates(organization_id)
    where ${enabledOrganization(tenantId, sql.ref('candidates.organization_id'))}
  `
}

/**
 * How far the projection is complete for the organizations in scope (each listed organization,
 * or every X-Ray organization of the tenant). `computedThrough` is the oldest ingest cursor
 * position; the scope is `incomplete` (and `computedThrough` is `null`) when an organization has
 * no cursor yet, is backfilling or waiting for a rebuild (`status <> 'idle'`), runs a range scan
 * (backfill or reconciliation), or when the tenant has no X-Ray organization at all.
 */
export async function readProjectionState(trx: AnalyticsDb | AnalyticsTrx, scope: QueryScope): Promise<ProjectionState> {
  if (scope.organizationIds !== null && scope.organizationIds.length === 0) return { computedThrough: null, incomplete: false }
  const scoped = scope.organizationIds === null
    ? tenantOrganizations(scope.tenantId)
    : sql`select distinct listed.organization_id from unnest(${[...scope.organizationIds]}::uuid[]) as listed(organization_id)`
  const result = await sql<{ computed_through: string | null; organizations: string | number; pending: string | number }>`
    with scoped(organization_id) as (${scoped})
    select ${iso(sql`min(cursors.last_created_at)`)} as computed_through,
      count(*) as organizations,
      count(*) filter (
        where cursors.id is null
          or cursors.last_created_at is null
          or cursors.status <> 'idle'
          or cursors.scan_id is not null
      ) as pending
    from scoped
    left join insights_process_cursors cursors
      on cursors.tenant_id = ${scope.tenantId}
      and cursors.organization_id = scoped.organization_id
  `.execute(trx)
  const row = result.rows[0]
  const incomplete = !row || toNumber(row.organizations) === 0 || toNumber(row.pending) > 0
  return { computedThrough: incomplete ? null : row.computed_through ?? null, incomplete }
}

/** The tenant's X-Ray organizations (ingest cursor or settings row), for tenant-wide readers. */
export async function listTenantXrayOrganizations(db: AnalyticsDb | AnalyticsTrx, tenantId: string): Promise<string[]> {
  const result = await sql<{ organization_id: string }>`
    select organizations.organization_id::text as organization_id
    from (${tenantOrganizations(tenantId)}) organizations(organization_id)
    order by organizations.organization_id
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
  case_variant_hash: string | null
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
      cases.status as case_status,
      cases.variant_hash as case_variant_hash
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
          ? { startedAt: row.case_started_at, endedAt: row.case_ended_at, status: row.case_status, variantHash: row.case_variant_hash }
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

/**
 * Registered processes with non-voided events since `since` in one organization: one bounded
 * index probe (`exists … limit 1`) per registered key. Callers run it inside
 * `runAnalyticsQuery` (read-only, under the statement timeout).
 */
export async function listActiveProcessKeys(
  db: AnalyticsDb | AnalyticsTrx,
  query: { tenantId: string; organizationId: string; registeredKeys: readonly string[]; since: string },
): Promise<string[]> {
  const keys = Array.from(new Set(query.registeredKeys))
  if (keys.length === 0) return []
  const result = await sql<{ process_key: string }>`
    select registered.process_key
    from unnest(${keys}::text[]) as registered(process_key)
    where exists (
      select 1 from insights_process_events events
      where events.tenant_id = ${query.tenantId}
        and events.organization_id = ${query.organizationId}
        and events.process_key = registered.process_key
        and not events.voided
        and events.occurred_at >= ${query.since}::timestamptz
      limit 1
    )
    order by registered.process_key
  `.execute(db)
  return result.rows.map((row) => row.process_key)
}

export type ProcessSummaryCounts = {
  cases: number
  openCases: number
}

/**
 * Headline counts of one process in one statement: the cases with a non-voided event in
 * `[from, to)` and the cases open at `asOf` (started before it, not ended before it).
 */
export async function loadProcessSummaryCounts(
  trx: AnalyticsDb | AnalyticsTrx,
  query: { scope: QueryScope; processKey: string; registeredKeys: readonly string[]; from: string; to: string; asOf: string },
): Promise<ProcessSummaryCounts> {
  if (query.scope.organizationIds !== null && query.scope.organizationIds.length === 0) return { cases: 0, openCases: 0 }
  if (!query.registeredKeys.includes(query.processKey)) return { cases: 0, openCases: 0 }
  const scope = query.scope
  const result = await sql<{ cases: string | number; open_cases: string | number }>`
    select
      (
        select count(*) from (
          select distinct events.organization_id, events.case_id
          from insights_process_events events
          where events.tenant_id = ${scope.tenantId} ${organizationPredicate('events', scope)}
            and events.process_key = ${query.processKey}
            and events.process_key = any(${[...query.registeredKeys]}::text[])
            and not events.voided
            and events.occurred_at >= ${query.from}::timestamptz
            and events.occurred_at < ${query.to}::timestamptz
        ) active_cases
      ) as cases,
      (
        select count(*) from insights_process_cases cases
        where cases.tenant_id = ${scope.tenantId} ${organizationPredicate('cases', scope)}
          and cases.process_key = ${query.processKey}
          and cases.process_key = any(${[...query.registeredKeys]}::text[])
          and cases.started_at < ${query.asOf}::timestamptz
          and (cases.ended_at is null or cases.ended_at >= ${query.asOf}::timestamptz)
      ) as open_cases
  `.execute(trx)
  const row = result.rows[0]
  return { cases: toNumber(row?.cases), openCases: toNumber(row?.open_cases) }
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
  /** Also count the distinct actors of the listed population (`CaseListPage.actors`), for the drill-down cell rule. */
  measureActors?: boolean
}

export type ActorFilterFacts = {
  cases: number
  actors: number
}

export type ActorFilterCensus = {
  population: ActorFilterFacts
  roles: ReadonlyMap<string, ActorFilterFacts>
  teams: ReadonlyMap<string, ActorFilterFacts>
}

/**
 * Cases and distinct actors of the in-window, non-voided events matching all requested event
 * filters (the filtered population), and of each requested role and team value on its own
 * (with the other filters kept). A value without a matching event is absent from its map.
 */
export async function loadActorFilterCensus(
  trx: AnalyticsDb | AnalyticsTrx,
  query: { scope: QueryScope; processKey: string; registeredKeys: readonly string[]; from: string; to: string; filters: CaseEventFilters },
): Promise<ActorFilterCensus> {
  const empty: ActorFilterCensus = { population: { cases: 0, actors: 0 }, roles: new Map(), teams: new Map() }
  if (query.scope.organizationIds !== null && query.scope.organizationIds.length === 0) return empty
  if (!query.registeredKeys.includes(query.processKey)) return empty
  const scope = query.scope
  const caseKey = sql`matched.organization_id::text || ':' || matched.case_id::text`
  const result = await sql<{ dimension: string; value: string | null; cases: string | number; actors: string | number }>`
    with matched as (
      select events.organization_id, events.case_id, events.actor_pseudonym, events.actor_role_ids, events.actor_team_id
      from insights_process_events events
      where events.tenant_id = ${scope.tenantId} ${organizationPredicate('events', scope)}
        and events.process_key = ${query.processKey}
        and events.process_key = any(${[...query.registeredKeys]}::text[])
        and not events.voided
        and events.occurred_at >= ${query.from}::timestamptz
        and events.occurred_at < ${query.to}::timestamptz
        ${eventFilterPredicate('events', query.filters)}
    )
    select 'population' as dimension, null::text as value,
      count(distinct ${caseKey}) as cases, count(distinct matched.actor_pseudonym) as actors
    from matched
    union all
    select 'role' as dimension, roles.role_id as value,
      count(distinct ${caseKey}) as cases, count(distinct matched.actor_pseudonym) as actors
    from matched
    cross join lateral unnest(matched.actor_role_ids) as roles(role_id)
    where roles.role_id = any(${[...(query.filters.actorRoleIds ?? [])]}::text[])
    group by roles.role_id
    union all
    select 'team' as dimension, matched.actor_team_id::text as value,
      count(distinct ${caseKey}) as cases, count(distinct matched.actor_pseudonym) as actors
    from matched
    where matched.actor_team_id = any(${[...(query.filters.actorTeamIds ?? [])]}::uuid[])
    group by matched.actor_team_id
  `.execute(trx)
  const roles = new Map<string, ActorFilterFacts>()
  const teams = new Map<string, ActorFilterFacts>()
  let population: ActorFilterFacts = empty.population
  for (const row of result.rows) {
    const facts = { cases: toNumber(row.cases), actors: toNumber(row.actors) }
    if (row.dimension === 'population') population = facts
    else if (row.dimension === 'role' && row.value) roles.set(row.value.toLowerCase(), facts)
    else if (row.dimension === 'team' && row.value) teams.set(row.value.toLowerCase(), facts)
  }
  return { population, roles, teams }
}

export type CaseListPage = {
  total: number
  /** Distinct actor pseudonyms of the population's matching events (only with `measureActors`). */
  actors?: number
  items: Array<{ caseId: string; organizationId: string; lastActivityAt: string }>
  hasMore: boolean
}

function hasValues(values: readonly string[] | undefined): values is readonly string[] {
  return Array.isArray(values) && values.length > 0
}

/** `and <alias>.cause_kind / actor_role_ids / actor_team_id …` for the requested event filters. */
function eventFilterPredicate(alias: string, filters: CaseEventFilters): RawBuilder<unknown> {
  const column = (name: string) => sql.ref(`${alias}.${name}`)
  return sql`
    ${hasValues(filters.causeKinds) ? sql`and ${column('cause_kind')} = any(${[...filters.causeKinds]}::text[])` : sql``}
    ${hasValues(filters.actorRoleIds) ? sql`and ${column('actor_role_ids')} && ${[...filters.actorRoleIds]}::text[]` : sql``}
    ${hasValues(filters.actorTeamIds) ? sql`and ${column('actor_team_id')} = any(${[...filters.actorTeamIds]}::uuid[])` : sql``}
  `
}

function hasEventFilters(filters: CaseEventFilters): boolean {
  return hasValues(filters.causeKinds) || hasValues(filters.actorRoleIds) || hasValues(filters.actorTeamIds)
}

function caseEventExists(query: CaseListQuery, predicate: RawBuilder<unknown>): RawBuilder<unknown> {
  return sql`and exists (
    select 1 from insights_process_events events
    where events.tenant_id = cases.tenant_id and events.organization_id = cases.organization_id
      and events.process_key = cases.process_key and events.case_id = cases.case_id
      and not events.voided
      and events.occurred_at < ${query.to}::timestamptz
      ${predicate}
  )`
}

/**
 * The listing predicates that mirror the analytics populations. Always: a non-voided event in
 * the window (the cases the analytics read). With event filters or an activity key: such an
 * event in the window (the population of the map, rework, bottlenecks and breakdown). For a
 * variant drill-down: the case completed in the window and has a matching event before the
 * window end (the population of the variants).
 */
function populationClauses(query: CaseListQuery): RawBuilder<unknown> {
  const filters = query.eventFilters ?? {}
  const variantDrillDown = hasValues(query.variantHashes)
  const inWindow = sql`and events.occurred_at >= ${query.from}::timestamptz`
  const windowEvent = caseEventExists(query, inWindow)
  const completed = variantDrillDown
    ? sql`and cases.status = 'completed' and cases.ended_at >= ${query.from}::timestamptz and cases.ended_at < ${query.to}::timestamptz`
    : sql``
  if (!query.activityKey && !hasEventFilters(filters)) return sql`${windowEvent} ${completed}`
  const matching = caseEventExists(query, sql`
    ${variantDrillDown && !query.activityKey ? sql`` : inWindow}
    ${query.activityKey ? sql`and events.activity_key = ${query.activityKey}` : sql``}
    ${eventFilterPredicate('events', filters)}
  `)
  return sql`${windowEvent} ${completed} ${matching}`
}

/**
 * Case ids (only) of the analytics population of the window (see `populationClauses`; the
 * summary bounds `started_at < to` and `last_activity_at >= from` are implied prefilters),
 * newest activity first, keyset-paginated on `(last_activity_at, case_id)`. `variantHashes`
 * match the stored `variant_hash` (as `rawVariantHashes` of the variants report it), read from
 * the current case summary.
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
    ${populationClauses(query)}
  `
  const counted = await sql<{ total: string | number }>`
    select count(*) as total from insights_process_cases cases where ${filters}
  `.execute(trx)
  const actors = query.measureActors ? await countListedActors(trx, query, filters) : undefined
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
    ...(actors === undefined ? {} : { actors }),
    items: rows.map((row) => ({ caseId: row.case_id, organizationId: row.organization_id, lastActivityAt: row.last_activity_at })),
    hasMore: page.rows.length > query.pageSize,
  }
}

/**
 * Distinct actor pseudonyms behind a listed population: the non-voided events of the listed
 * cases that make them match (the activity and the event filters, in the window; for a variant
 * drill-down without an activity, every event before the window end, like the variants).
 * Events without an identifiable actor (automation) are not counted.
 */
async function countListedActors(trx: AnalyticsDb | AnalyticsTrx, query: CaseListQuery, filters: RawBuilder<unknown>): Promise<number> {
  const variantOnly = hasValues(query.variantHashes) && !query.activityKey
  const result = await sql<{ actors: string | number }>`
    select count(distinct events.actor_pseudonym) as actors
    from insights_process_cases cases
    join insights_process_events events
      on events.tenant_id = cases.tenant_id and events.organization_id = cases.organization_id
      and events.process_key = cases.process_key and events.case_id = cases.case_id
    where ${filters}
      and not events.voided
      and events.occurred_at < ${query.to}::timestamptz
      ${variantOnly ? sql`` : sql`and events.occurred_at >= ${query.from}::timestamptz`}
      ${query.activityKey ? sql`and events.activity_key = ${query.activityKey}` : sql``}
      ${eventFilterPredicate('events', query.eventFilters ?? {})}
  `.execute(trx)
  return toNumber(result.rows[0]?.actors)
}
