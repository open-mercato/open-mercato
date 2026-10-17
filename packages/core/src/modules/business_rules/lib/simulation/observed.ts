import { sql, type Kysely } from 'kysely'

/**
 * Observed tier of the rule backtest (spec `2026-10-08-insights-change-simulator`, decision S3):
 * reads run-tagged `rule_execution_logs` rows of one organization and entity type, in
 * `(executed_at, id)` order, through the partial `rule_execution_logs_simulation_idx`. Values are
 * always bound parameters. Rows carry the sanitized `input_context.data` as logged; callers keep
 * only the rows the CRUD trigger subscriber wrote (`isCrudTriggerRow`).
 */

export const CRUD_RULE_TRIGGER_SUBSCRIBER_ID = 'business_rules:crud-rule-trigger'

export const OBSERVED_RULE_LOG_MAX_LIMIT = 1000

export type ObservedRuleLogTable = {
  id: string
  rule_id: string
  entity_id: string
  entity_type: string
  input_context: unknown
  executed_at: Date
  tenant_id: string
  organization_id: string | null
  run_id: string | null
  causation_json: unknown
}

export type ObservedRuleLogDatabase = {
  rule_execution_logs: ObservedRuleLogTable
}

/** `executedAt` is `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, microseconds); `id` is the bigint id in decimal. */
export type ObservedRuleLogCursor = { executedAt: string; id: string }

export type ObservedRuleLogRow = {
  id: string
  entityId: string
  entityType: string
  eventType: string | null
  executedAt: string
  data: unknown
  dataHash: string
  innermostFrameKind: string | null
  innermostFrameId: string | null
  correlationId: string | null
  causedByLogId: string | null
  payloadBytes: number
}

export type ObservedRuleLogPage = {
  rows: ObservedRuleLogRow[]
  lastCursor: ObservedRuleLogCursor | null
  exhausted: boolean
  payloadBytes: number
}

export type ObservedRuleLogQuery = {
  tenantId: string
  organizationId: string
  entityType: string
  from: Date
  to: Date
  after: ObservedRuleLogCursor | null
  limit: number
  maxBytes: number
}

export type ObservedCoverageQuery = {
  tenantId: string
  organizationId: string
  entityType: string
  entityIds: string[]
  from: Date
  to: Date
}

export type ObservedCoverageRow = {
  eventType: string | null
  entityId: string
  correlationId: string | null
  causedByLogId: string | null
  innermostFrameKind: string | null
  innermostFrameId: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/
const CURSOR_ID_PATTERN = /^\d{1,19}$/
const MAX_BIGINT_ID = BigInt('9223372036854775807')
const SECOND_PRECISION_LENGTH = 19

const executedAtCursorSql = sql<string>`to_char(rule_execution_logs.executed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const innermostFrameKindSql = sql<string | null>`rule_execution_logs.causation_json -> 'frames' -> -1 ->> 'kind'`
const innermostFrameIdSql = sql<string | null>`rule_execution_logs.causation_json -> 'frames' -> -1 ->> 'id'`
const correlationIdSql = sql<string | null>`rule_execution_logs.causation_json ->> 'correlationId'`
const causedByLogIdSql = sql<string | null>`rule_execution_logs.causation_json ->> 'causedByLogId'`
const eventTypeSql = sql<string | null>`rule_execution_logs.input_context ->> 'eventType'`

function isValidCursorTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !CURSOR_TIMESTAMP_PATTERN.test(value)) return false
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return false
  return new Date(parsed).toISOString().slice(0, SECOND_PRECISION_LENGTH) === value.slice(0, SECOND_PRECISION_LENGTH)
}

function isValidCursorId(value: unknown): value is string {
  return typeof value === 'string' && CURSOR_ID_PATTERN.test(value) && BigInt(value) <= MAX_BIGINT_ID
}

export function isValidObservedRuleLogCursor(cursor: unknown): cursor is ObservedRuleLogCursor {
  if (!cursor || typeof cursor !== 'object') return false
  const candidate = cursor as Partial<ObservedRuleLogCursor>
  return isValidCursorTimestamp(candidate.executedAt) && isValidCursorId(candidate.id)
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime())
}

function assertObservedScope(query: { tenantId: string; organizationId: string; entityType: string; from: Date; to: Date }): void {
  if (typeof query.tenantId !== 'string' || !UUID_PATTERN.test(query.tenantId)) {
    throw new TypeError('[internal] Invalid observed rule log tenant id')
  }
  if (typeof query.organizationId !== 'string' || !UUID_PATTERN.test(query.organizationId)) {
    throw new TypeError('[internal] Invalid observed rule log organization id')
  }
  if (typeof query.entityType !== 'string' || query.entityType.length === 0) {
    throw new TypeError('[internal] Invalid observed rule log entity type')
  }
  if (!isValidDate(query.from) || !isValidDate(query.to)) {
    throw new TypeError('[internal] Invalid observed rule log window')
  }
}

function clampObservedLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 1
  return Math.min(Math.max(Math.trunc(limit), 1), OBSERVED_RULE_LOG_MAX_LIMIT)
}

function normalizeByteBudget(maxBytes: number): number {
  if (typeof maxBytes !== 'number' || Number.isNaN(maxBytes)) return 0
  return Math.max(0, maxBytes)
}

function countWithinByteBudget(sizes: readonly number[], maxBytes: number): number {
  let total = 0
  let count = 0
  for (const size of sizes) {
    const next = total + Math.max(0, size)
    if (count > 0 && next > maxBytes) break
    total = next
    count += 1
  }
  return count
}

function toByteCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function scopedRuns(db: Kysely<ObservedRuleLogDatabase>, query: Omit<ObservedCoverageQuery, 'entityIds'>) {
  return db
    .selectFrom('rule_execution_logs')
    .where('rule_execution_logs.tenant_id', '=', query.tenantId)
    .where('rule_execution_logs.organization_id', '=', query.organizationId)
    .where('rule_execution_logs.entity_type', '=', query.entityType)
    .where('rule_execution_logs.run_id', 'is not', null)
    .where('rule_execution_logs.executed_at', '>=', query.from)
    .where('rule_execution_logs.executed_at', '<', query.to)
}

/**
 * One page of run-tagged rule logs after `after` (exclusive), within `[from, to)`. Probes
 * `limit + 1` rows to know whether the window is exhausted, then keeps the longest prefix whose
 * `pg_column_size(input_context)` total fits `maxBytes` (never fewer than one row) and loads only
 * those payloads. `lastCursor` is the last kept row (null when the page is empty).
 */
export async function readObservedRuleLogs(
  db: Kysely<ObservedRuleLogDatabase>,
  query: ObservedRuleLogQuery,
): Promise<ObservedRuleLogPage> {
  assertObservedScope(query)
  if (query.after !== null && !isValidObservedRuleLogCursor(query.after)) {
    throw new TypeError('[internal] Invalid observed rule log cursor')
  }
  const empty: ObservedRuleLogPage = { rows: [], lastCursor: null, exhausted: true, payloadBytes: 0 }
  if (query.from.getTime() >= query.to.getTime()) return empty
  const limit = clampObservedLimit(query.limit)
  const maxBytes = normalizeByteBudget(query.maxBytes)
  const after = query.after

  let probe = scopedRuns(db, query).select([
    sql<string>`rule_execution_logs.id::text`.as('id'),
    executedAtCursorSql.as('cursor_at'),
    sql<number>`coalesce(pg_column_size(rule_execution_logs.input_context), 0)`.as('payload_bytes'),
  ])
  if (after) {
    const cursorAt = sql<Date>`${after.executedAt}::timestamptz`
    const cursorId = sql<string>`${after.id}::bigint`
    probe = probe
      .where('rule_execution_logs.executed_at', '>=', cursorAt)
      .where((eb) => eb.or([
        eb('rule_execution_logs.executed_at', '>', cursorAt),
        eb.and([
          eb('rule_execution_logs.executed_at', '=', cursorAt),
          eb('rule_execution_logs.id', '>', cursorId),
        ]),
      ]))
  }
  const probeRows = await probe
    .orderBy('rule_execution_logs.executed_at', 'asc')
    .orderBy('rule_execution_logs.id', 'asc')
    .limit(limit + 1)
    .execute()

  const candidates = probeRows.slice(0, limit)
  const sizes = candidates.map((row) => toByteCount(row.payload_bytes))
  const taken = countWithinByteBudget(sizes, maxBytes)
  const picked = candidates.slice(0, taken)
  const exhausted = taken === candidates.length && probeRows.length <= limit
  const lastPicked = picked.at(-1)
  if (!lastPicked) return { ...empty, exhausted }

  const loaded = await scopedRuns(db, query)
    .select([
      sql<string>`rule_execution_logs.id::text`.as('id'),
      'rule_execution_logs.entity_id',
      'rule_execution_logs.entity_type',
      eventTypeSql.as('event_type'),
      sql<unknown>`rule_execution_logs.input_context -> 'data'`.as('data'),
      sql<string>`encode(sha256(convert_to(coalesce((rule_execution_logs.input_context -> 'data')::text, 'null'), 'UTF8')), 'hex')`.as('data_hash'),
      innermostFrameKindSql.as('innermost_frame_kind'),
      innermostFrameIdSql.as('innermost_frame_id'),
      correlationIdSql.as('correlation_id'),
      causedByLogIdSql.as('caused_by_log_id'),
      executedAtCursorSql.as('cursor_at'),
      sql<number>`coalesce(pg_column_size(rule_execution_logs.input_context), 0)`.as('payload_bytes'),
    ])
    .where(sql<boolean>`rule_execution_logs.id = any(${picked.map((row) => row.id)}::bigint[])`)
    .orderBy('rule_execution_logs.executed_at', 'asc')
    .orderBy('rule_execution_logs.id', 'asc')
    .execute()

  const rows: ObservedRuleLogRow[] = loaded.map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    entityType: row.entity_type,
    eventType: row.event_type ?? null,
    executedAt: row.cursor_at,
    data: row.data ?? null,
    dataHash: row.data_hash,
    innermostFrameKind: row.innermost_frame_kind ?? null,
    innermostFrameId: row.innermost_frame_id ?? null,
    correlationId: row.correlation_id ?? null,
    causedByLogId: row.caused_by_log_id ?? null,
    payloadBytes: toByteCount(row.payload_bytes),
  }))

  return {
    rows,
    lastCursor: { executedAt: lastPicked.cursor_at, id: lastPicked.id },
    exhausted,
    payloadBytes: sizes.slice(0, taken).reduce((sum, size) => sum + size, 0),
  }
}

/**
 * Every run-tagged rule log of the given entities within `[from, to)` (any writer), ordered by
 * `(executed_at, id)`, so a caller can tell which observed events came from the CRUD trigger and
 * which from other paths. An empty id list issues no query.
 */
export async function findObservedCoverage(
  db: Kysely<ObservedRuleLogDatabase>,
  query: ObservedCoverageQuery,
): Promise<ObservedCoverageRow[]> {
  assertObservedScope(query)
  const entityIds = Array.from(new Set(
    (Array.isArray(query.entityIds) ? query.entityIds : []).filter(
      (entityId): entityId is string => typeof entityId === 'string' && entityId.length > 0,
    ),
  ))
  if (entityIds.length === 0 || query.from.getTime() >= query.to.getTime()) return []

  const rows = await scopedRuns(db, query)
    .select([
      eventTypeSql.as('event_type'),
      'rule_execution_logs.entity_id',
      correlationIdSql.as('correlation_id'),
      causedByLogIdSql.as('caused_by_log_id'),
      innermostFrameKindSql.as('innermost_frame_kind'),
      innermostFrameIdSql.as('innermost_frame_id'),
    ])
    .where(sql<boolean>`rule_execution_logs.entity_id = any(${entityIds}::text[])`)
    .orderBy('rule_execution_logs.executed_at', 'asc')
    .orderBy('rule_execution_logs.id', 'asc')
    .execute()

  return rows.map((row) => ({
    eventType: row.event_type ?? null,
    entityId: row.entity_id,
    correlationId: row.correlation_id ?? null,
    causedByLogId: row.caused_by_log_id ?? null,
    innermostFrameKind: row.innermost_frame_kind ?? null,
    innermostFrameId: row.innermost_frame_id ?? null,
  }))
}

/** Whether the innermost causation frame of a rule log is the CRUD rule trigger subscriber. */
export function isCrudTriggerRow(row: { innermostFrameKind: string | null; innermostFrameId: string | null }): boolean {
  return row.innermostFrameKind === 'subscriber' && row.innermostFrameId === CRUD_RULE_TRIGGER_SUBSCRIBER_ID
}
