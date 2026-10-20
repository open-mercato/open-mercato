import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import { summarizeCase } from '../../process/caseSummary'
import { compareCodeUnits } from '../../process/registry'
import type { XrayDatabase } from '../../projection/types'
import { normalizeCauseKind, type AnalyticsEventRow } from '../trace'
import {
  ANALYTICS_ORG,
  BASE_MS,
  DAY_MS,
  HOUR_MS,
  actorOf,
  caseIdOf,
  creation,
  dealProcess,
  stepRow,
} from './analyticsTestSupport'

export type ScriptedStatement =
  | 'statement_timeout'
  | 'transaction_now'
  | 'projection_state'
  | 'rollup'
  | 'case_events'
  | 'actor_census'
  | 'case_count'
  | 'listed_actors'
  | 'case_page'

export type ScriptedListingRow = {
  caseId: string
  organizationId: string
  lastActivityAt: string
}

export type ScriptedAnalyticsData = {
  events: readonly AnalyticsEventRow[]
  listing?: readonly ScriptedListingRow[]
  /** Distinct actors of the listed population (default: of every event of the listed cases). */
  listedActors?: number
  actorCensus?: { cases: number; actors: number }
  computedThrough?: string
  now?: string
}

export type ScriptedAnalyticsDb = {
  db: Kysely<XrayDatabase>
  statements: ScriptedStatement[]
  count: (statement: ScriptedStatement) => number
}

const STATEMENT_MARKERS: ReadonlyArray<[ScriptedStatement, string]> = [
  ['statement_timeout', 'statement_timeout'],
  ['transaction_now', 'as now'],
  ['projection_state', 'with scoped(organization_id)'],
  ['rollup', 'from insights_process_rollups'],
  ['case_events', 'with window_cases as'],
  ['actor_census', 'with matched as'],
  ['case_count', 'select count(*) as total from insights_process_cases'],
  ['listed_actors', 'select count(distinct events.actor_pseudonym) as actors'],
  ['case_page', 'select cases.case_id::text as case_id'],
]

function classify(statement: string): ScriptedStatement {
  const match = STATEMENT_MARKERS.find(([, marker]) => statement.includes(marker))
  if (!match) throw new Error(`[internal] Unscripted analytics statement: ${statement.slice(0, 120)}`)
  return match[0]
}

function compareEventRows(left: AnalyticsEventRow, right: AnalyticsEventRow): number {
  return compareCodeUnits(left.organizationId, right.organizationId)
    || compareCodeUnits(left.caseId, right.caseId)
    || Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
    || compareCodeUnits(left.sourceLogId, right.sourceLogId)
    || left.seq - right.seq
}

function caseKey(row: Pick<AnalyticsEventRow, 'organizationId' | 'caseId'>): string {
  return `${row.organizationId}:${row.caseId}`
}

/** The stored case summary (`insights_process_cases`) the projection writes for these rows. */
export function storedCaseSummary(rows: readonly AnalyticsEventRow[]) {
  const sorted = [...rows].sort(compareEventRows)
  return summarizeCase(dealProcess, sorted.map((row) => ({
    activityKey: row.activityKey,
    activityKind: row.activityKind,
    occurredAt: row.occurredAt,
    sourceLogId: row.sourceLogId,
    seq: row.seq,
    actorPseudonym: row.actorPseudonym,
    causeKind: normalizeCauseKind(row.causeKind),
    viaSyncRun: row.viaSyncRun,
    followupField: row.followupField,
    followupValue: row.followupValue,
  })))
}

function eventQueryRows(events: readonly AnalyticsEventRow[]) {
  const byCase = new Map<string, AnalyticsEventRow[]>()
  for (const row of events) byCase.set(caseKey(row), [...(byCase.get(caseKey(row)) ?? []), row])
  const summaries = new Map(Array.from(byCase.entries()).map(([key, rows]) => [key, storedCaseSummary(rows)]))
  return [...events].sort(compareEventRows).map((row) => {
    const summary = summaries.get(caseKey(row)) ?? null
    return {
      organization_id: row.organizationId,
      case_id: row.caseId,
      activity_key: row.activityKey,
      activity_kind: row.activityKind,
      occurred_at: row.occurredAt,
      source_log_id: row.sourceLogId,
      seq: row.seq,
      actor_pseudonym: row.actorPseudonym,
      actor_role_ids: row.actorRoleIds,
      actor_team_id: row.actorTeamId,
      cause_kind: row.causeKind,
      via_sync_run: row.viaSyncRun,
      followup_field: row.followupField,
      followup_value: row.followupValue,
      case_started_at: summary?.startedAt ?? null,
      case_ended_at: summary?.endedAt ?? null,
      case_status: summary?.status ?? null,
      case_variant_hash: summary?.variantHash ?? null,
    }
  })
}

/**
 * A Kysely instance over a scripted driver: every analytics statement is recognized by its SQL
 * and answered from the given events (with the stored case summaries the projection would
 * write), a complete projection, no rollup and the given case listing. Any other statement
 * fails the test. `statements` records what ran, in order.
 */
export function createScriptedAnalyticsDb(data: ScriptedAnalyticsData): ScriptedAnalyticsDb {
  const statements: ScriptedStatement[] = []
  const computedThrough = data.computedThrough ?? '2026-01-05T08:00:00.000000Z'
  const now = data.now ?? '2026-01-05T09:00:00.000000Z'
  const answer = (kind: ScriptedStatement): unknown[] => {
    if (kind === 'transaction_now') return [{ now }]
    if (kind === 'projection_state') return [{ computed_through: computedThrough, organizations: 1, pending: 0 }]
    if (kind === 'case_events') return eventQueryRows(data.events)
    if (kind === 'actor_census') {
      const census = data.actorCensus ?? { cases: 0, actors: 0 }
      return [{ dimension: 'population', value: null, cases: census.cases, actors: census.actors }]
    }
    if (kind === 'case_count') return [{ total: (data.listing ?? []).length }]
    if (kind === 'listed_actors') {
      const listed = new Set((data.listing ?? []).map((row) => row.caseId))
      const actors = new Set(data.events.filter((row) => listed.has(row.caseId) && row.actorPseudonym).map((row) => row.actorPseudonym))
      return [{ actors: data.listedActors ?? actors.size }]
    }
    if (kind === 'case_page') {
      return (data.listing ?? []).map((row) => ({ case_id: row.caseId, organization_id: row.organizationId, last_activity_at: row.lastActivityAt }))
    }
    return []
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection(): Promise<DatabaseConnection> {
      return {
        executeQuery: async <TRow>(compiled: CompiledQuery): Promise<QueryResult<TRow>> => {
          const kind = classify(compiled.sql)
          statements.push(kind)
          return { rows: answer(kind) as TRow[] }
        },
        streamQuery: () => {
          throw new Error('[internal] Streaming is not used by the analytics')
        },
      }
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<XrayDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (database) => new PostgresIntrospector(database),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db, statements, count: (statement) => statements.filter((recorded) => recorded === statement).length }
}

export type DrillDownPopulation = {
  events: AnalyticsEventRow[]
  cases: { won: string[]; qualifiedLost: string[]; lost: string[]; priority: string[] }
  storedHashes: { won: string; qualifiedLost: string; lost: string }
}

function storedHashOf(events: readonly AnalyticsEventRow[], caseId: string): string {
  const summary = storedCaseSummary(events.filter((row) => row.caseId === caseId))
  if (!summary) throw new Error('[internal] The scripted case has no summary')
  return summary.variantHash
}

/**
 * Fifteen deals of one organization, all inside the default 30-day window of `BASE_MS`, three
 * actors per group except the two `lost` deals (two actors). Under k = 5:
 * - map: `priority:high` (2 cases) is suppressed, and `status:won` (7 cases, 3 actors — enough
 *   on its own) is complementary-suppressed as the smallest sibling; `created`, `status:open`,
 *   `status:qualified` and `status:lost` stay visible;
 * - variants: `won` (7 cases) is visible, `lost` (2 cases) is suppressed and `qualifiedLost`
 *   (6 cases, enough on its own) is complementary-suppressed.
 */
export function drillDownPopulation(organizationId: string = ANALYTICS_ORG): DrillDownPopulation {
  const startMs = BASE_MS - 20 * DAY_MS
  const events: AnalyticsEventRow[] = []
  const cases: DrillDownPopulation['cases'] = { won: [], qualifiedLost: [], lost: [], priority: [] }
  const addCase = (caseId: string, index: number, steps: string[], priority: boolean) => {
    const atMs = startMs + index * HOUR_MS
    const actor = actorOf((index % 3) + 1)
    events.push(...creation(caseId, atMs, { actor }, organizationId))
    steps.forEach((key, position) => {
      events.push(stepRow(caseId, { key, atMs: atMs + (position + 1) * DAY_MS, actor }, organizationId))
    })
    if (priority) {
      events.push(stepRow(caseId, { key: 'priority:high', kind: 'followup', atMs: atMs + DAY_MS + HOUR_MS, actor }, organizationId))
      cases.priority.push(caseId)
    }
  }
  for (let index = 0; index < 7; index += 1) {
    const caseId = caseIdOf(100 + index)
    addCase(caseId, index, ['status:qualified', 'status:won'], index < 2)
    cases.won.push(caseId)
  }
  for (let index = 0; index < 6; index += 1) {
    const caseId = caseIdOf(200 + index)
    addCase(caseId, index, ['status:qualified', 'status:lost'], false)
    cases.qualifiedLost.push(caseId)
  }
  for (let index = 0; index < 2; index += 1) {
    const caseId = caseIdOf(300 + index)
    addCase(caseId, index, ['status:lost'], false)
    cases.lost.push(caseId)
  }
  return {
    events,
    cases,
    storedHashes: {
      won: storedHashOf(events, cases.won[0]),
      qualifiedLost: storedHashOf(events, cases.qualifiedLost[0]),
      lost: storedHashOf(events, cases.lost[0]),
    },
  }
}

/** Listing rows (newest first) of the given cases, as the case page query returns them. */
export function listingOf(caseIds: readonly string[], organizationId: string = ANALYTICS_ORG): ScriptedListingRow[] {
  return caseIds.map((caseId, index) => ({
    caseId,
    organizationId,
    lastActivityAt: new Date(BASE_MS - (index + 1) * HOUR_MS).toISOString().replace('Z', '000Z'),
  }))
}
