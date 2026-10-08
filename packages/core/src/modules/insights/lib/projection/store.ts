import { randomUUID } from 'node:crypto'
import { sql, type Kysely, type Transaction, type UpdateObject } from 'kysely'
import { PROCESS_LEGACY_CAUSE_KIND } from '@open-mercato/shared/modules/insights/process'
import { compareCodeUnits, type RegisteredProcess } from '../process/registry'
import {
  AUTOMATED_CAUSE_KINDS,
  CASE_EVENT_LIMIT,
  summarizeCase,
  type CaseAggregate,
  type CaseEventPosition,
  type CaseEventRow,
} from '../process/caseSummary'
import type { ProcessCursorStatus, ProcessScanKind } from '../../data/entities'
import { isLockTimeoutError, isStatementTimeoutError } from './errors'
import { ERASED_PSEUDONYM_PREFIX, NO_PSEUDONYM_KEY_FINGERPRINT } from './pseudonym'
import type { ProcessContractChange, ProjectionScope, XrayDatabase } from './types'

export const MAX_LOG_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'

const ISO_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
const INSERT_CHUNK_SIZE = 250
const ID_CHUNK_SIZE = 500
const COMMIT_STATEMENT_TIMEOUT_MS = 30000
const RESERVED_VALUE_COUNT = 2
const VALUE_FIELD_SCAN_LIMIT = 10000

/** How long a lease attempt waits for the cursor row lock before it counts as busy. */
export const LEASE_LOCK_TIMEOUT_MS = 5000

/** Statement timeout of the status counts; on timeout the counts degrade to null. */
export const COUNTS_STATEMENT_TIMEOUT_MS = 3000

/** Rows re-pseudonymized per erasure transaction. */
export const ERASURE_BATCH_SIZE = 5000

/** Cursors per page of a system-wide cursor listing. */
export const CURSOR_PAGE_SIZE = 500

export class ProjectionLeaseLostError extends Error {
  constructor() {
    super('[internal] The X-Ray projection lease was lost to another worker')
    this.name = 'ProjectionLeaseLostError'
  }
}

export class ProjectionScanSupersededError extends Error {
  constructor() {
    super('[internal] The X-Ray range scan was superseded by a newer one')
    this.name = 'ProjectionScanSupersededError'
  }
}

export type ProjectionCursor = {
  id: string
  tenantId: string
  organizationId: string
  lastCreatedAt: string | null
  lastLogId: string | null
  stateWatermark: string | null
  stateLastLogId: string | null
  scanId: string | null
  scanKind: ProcessScanKind | null
  scanFrom: string | null
  scanUntil: string | null
  scanAfterCreatedAt: string | null
  scanAfterLogId: string | null
  scanProgressJobId: string | null
  scanProcessedCount: number
  scanStartedAt: string | null
  scanUpdatedAt: string | null
  scanChainId: string | null
  actorKeyFingerprint: string | null
  lastReconciledAt: string | null
  lastFullReconciledAt: string | null
  lastPrunedAt: string | null
  leaseOwner: string | null
  leaseToken: number
  leaseUntil: string | null
  /** Contract hash per projected process; null until the first slice adopts the current ones. */
  contractHashes: Record<string, string> | null
  /** Processes cleared after a contract change and waiting for their rebuild scan. */
  pendingRebuildKeys: string[]
  /** Processes the running scan is limited to (a per-process rebuild); null for every process. */
  scanProcessKeys: string[] | null
  contractChangedAt: string | null
  contractChange: ProcessContractChange | null
  /** Audit rows from this time on are projected for every process not being rebuilt. */
  coverageFrom: string | null
  /** When a backfill or full reconciliation of every process last completed; null if never. */
  historyScannedAt: string | null
  undecryptableRows: number
  overlapTimeouts: number
  lastOverlapTimeoutAt: string | null
  status: ProcessCursorStatus
  lastRunAt: string | null
  lastError: string | null
}

export type ProjectionLease = {
  cursorId: string
  scope: ProjectionScope
  owner: string
  token: number
}

export type ProjectionEventInsert = {
  processKey: string
  caseKind: string
  caseId: string
  activityKey: string
  activityKind: string
  occurredAt: string
  sourceLogId: string
  seq: number
  /** Not stored: the user behind `actorPseudonym`, checked against the erasure ledger. */
  actorUserId: string | null
  actorPseudonym: string | null
  actorRoleIds: string[] | null
  actorTeamId: string | null
  causeKind: string
  causeId: string | null
  viaSyncRun: boolean
  followupField: string | null
  /** Not stored: the user behind a pseudonymized `user` value, checked against the erasure ledger. */
  followupUserId: string | null
  followupValue: string | null
  voided: boolean
  voidedByLogId: string | null
}

export type ProjectionVoid = {
  sourceLogIds: string[]
  voidedByLogId: string | null
}

export type CursorAdvance =
  | { kind: 'none' }
  | { kind: 'main'; lastCreatedAt: string; lastLogId: string }
  | { kind: 'state'; stateWatermark: string; stateLastLogId: string }
  | { kind: 'scan'; scanId: string; chainId: string; afterCreatedAt: string; afterLogId: string; processedDelta: number }

export type ProjectionCommit = {
  events: ProjectionEventInsert[]
  voids: ProjectionVoid[]
  advance: CursorAdvance
  processes: readonly RegisteredProcess[]
  /** Audit rows of this page skipped as undecryptable, added to the cursor's counter. */
  undecryptable?: number
}

export type ProjectionCommitResult = {
  inserted: number
  voided: number
  casesRecomputed: number
  casesRemoved: number
}

export type ScanStart = {
  scanId: string
  chainId: string
  kind: ProcessScanKind
  from: string | null
  until: string
  progressJobId: string | null
  /** Limits the scan to these processes (a per-process rebuild); omitted or null for all. */
  processKeys?: string[] | null
}

export type ContractTransition = {
  /** The contract hash of every registered process; processes left out are dropped. */
  hashes: Record<string, string>
  /** Processes whose rows were cleared and must be rebuilt by a scan. */
  rebuild: string[]
  /** The transition to record; null when the cursor only adopts its first contracts. */
  change: ProcessContractChange | null
}

export type CursorListFilter =
  | { tenantId: string; organizationId?: string | null }
  | { allTenants: true; after?: ProjectionScope | null; limit?: number }

export type ScanResume = {
  scanId: string
  chainId: string
  progressJobId: string | null
}

export type ActorErasureInput = {
  tenantId: string
  pseudonym: string | null
  replacement: string
  keyFingerprint: string
  userValueFields: ReadonlyArray<{ processKey: string; field: string }>
  batchSize?: number
}

type ValueField = { processKey: string; field: string }

function uniqueValueFields(fields: readonly ValueField[]): ValueField[] {
  const seen = new Set<string>()
  return fields.filter((entry) => {
    const key = `${entry.processKey}\u001f${entry.field}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export type ActorErasureResult = {
  updated: number
  mismatchedOrganizationIds: string[]
}

export type ProjectionCounts = {
  processKey: string
  events: number
  voidedEvents: number
  cases: number
  openCases: number
  firstOccurredAt: string | null
  lastOccurredAt: string | null
}

type CursorRow = {
  id: string
  tenant_id: string
  organization_id: string
  last_created_at: string | null
  last_log_id: string | null
  state_watermark: string | null
  state_last_log_id: string | null
  scan_id: string | null
  scan_kind: string | null
  scan_from: string | null
  scan_until: string | null
  scan_after_created_at: string | null
  scan_after_log_id: string | null
  scan_progress_job_id: string | null
  scan_processed_count: string | number
  scan_started_at: string | null
  scan_updated_at: string | null
  scan_chain_id: string | null
  actor_key_fingerprint: string | null
  last_reconciled_at: string | null
  last_full_reconciled_at: string | null
  last_pruned_at: string | null
  lease_owner: string | null
  lease_token: string | number
  lease_until: string | null
  contract_hashes: unknown
  pending_rebuild_keys: unknown
  scan_process_keys: unknown
  contract_changed_at: string | null
  contract_change: unknown
  coverage_from: string | null
  history_scanned_at: string | null
  undecryptable_rows: string | number
  overlap_timeouts: string | number
  last_overlap_timeout_at: string | null
  status: string
  last_run_at: string | null
  last_error: string | null
}

function iso(column: string) {
  return sql<string | null>`to_char(${sql.ref(column)} at time zone 'UTC', ${ISO_FORMAT})`
}

function timestamp(value: string) {
  return sql<Date>`${value}::timestamptz`
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return value
  const parsed = Number.parseInt(String(value ?? '0'), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function chunk<TValue>(values: readonly TValue[], size: number): TValue[][] {
  const chunks: TValue[][] = []
  for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size))
  return chunks
}

function readStatus(value: string): ProcessCursorStatus {
  return value === 'backfilling' ? value : 'idle'
}

function readKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string').sort(compareCodeUnits)
}

function readHashes(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const hashes: Record<string, string> = {}
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const hash = (value as Record<string, unknown>)[key]
    if (typeof hash === 'string') hashes[key] = hash
  }
  return hashes
}

function readChange(value: unknown): ProcessContractChange | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  return { changed: readKeyList(record.changed), added: readKeyList(record.added), removed: readKeyList(record.removed) }
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort(compareCodeUnits)
}

function readScanKind(value: string | null): ProcessScanKind | null {
  return value === 'backfill' || value === 'reconcile' || value === 'full_reconcile' ? value : null
}

function mapCursor(row: CursorRow): ProjectionCursor {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    organizationId: row.organization_id,
    lastCreatedAt: row.last_created_at,
    lastLogId: row.last_log_id,
    stateWatermark: row.state_watermark,
    stateLastLogId: row.state_last_log_id,
    scanId: row.scan_id,
    scanKind: readScanKind(row.scan_kind),
    scanFrom: row.scan_from,
    scanUntil: row.scan_until,
    scanAfterCreatedAt: row.scan_after_created_at,
    scanAfterLogId: row.scan_after_log_id,
    scanProgressJobId: row.scan_progress_job_id,
    scanProcessedCount: toNumber(row.scan_processed_count),
    scanStartedAt: row.scan_started_at,
    scanUpdatedAt: row.scan_updated_at,
    scanChainId: row.scan_chain_id,
    actorKeyFingerprint: row.actor_key_fingerprint,
    lastReconciledAt: row.last_reconciled_at,
    lastFullReconciledAt: row.last_full_reconciled_at,
    lastPrunedAt: row.last_pruned_at,
    leaseOwner: row.lease_owner,
    leaseToken: toNumber(row.lease_token),
    leaseUntil: row.lease_until,
    contractHashes: readHashes(row.contract_hashes),
    pendingRebuildKeys: readKeyList(row.pending_rebuild_keys),
    scanProcessKeys: Array.isArray(row.scan_process_keys) ? readKeyList(row.scan_process_keys) : null,
    contractChangedAt: row.contract_changed_at,
    contractChange: readChange(row.contract_change),
    coverageFrom: row.coverage_from,
    historyScannedAt: row.history_scanned_at,
    undecryptableRows: toNumber(row.undecryptable_rows),
    overlapTimeouts: toNumber(row.overlap_timeouts),
    lastOverlapTimeoutAt: row.last_overlap_timeout_at,
    status: readStatus(row.status),
    lastRunAt: row.last_run_at,
    lastError: row.last_error,
  }
}

function selectCursor(db: Kysely<XrayDatabase> | Transaction<XrayDatabase>) {
  return db
    .selectFrom('insights_process_cursors')
    .select([
      'insights_process_cursors.id',
      'insights_process_cursors.tenant_id',
      'insights_process_cursors.organization_id',
      iso('insights_process_cursors.last_created_at').as('last_created_at'),
      'insights_process_cursors.last_log_id',
      iso('insights_process_cursors.state_watermark').as('state_watermark'),
      'insights_process_cursors.state_last_log_id',
      'insights_process_cursors.scan_id',
      'insights_process_cursors.scan_kind',
      iso('insights_process_cursors.scan_from').as('scan_from'),
      iso('insights_process_cursors.scan_until').as('scan_until'),
      iso('insights_process_cursors.scan_after_created_at').as('scan_after_created_at'),
      'insights_process_cursors.scan_after_log_id',
      'insights_process_cursors.scan_progress_job_id',
      'insights_process_cursors.scan_processed_count',
      iso('insights_process_cursors.scan_started_at').as('scan_started_at'),
      iso('insights_process_cursors.scan_updated_at').as('scan_updated_at'),
      'insights_process_cursors.scan_chain_id',
      'insights_process_cursors.actor_key_fingerprint',
      iso('insights_process_cursors.last_reconciled_at').as('last_reconciled_at'),
      iso('insights_process_cursors.last_full_reconciled_at').as('last_full_reconciled_at'),
      iso('insights_process_cursors.last_pruned_at').as('last_pruned_at'),
      'insights_process_cursors.lease_owner',
      'insights_process_cursors.lease_token',
      iso('insights_process_cursors.lease_until').as('lease_until'),
      'insights_process_cursors.contract_hashes',
      'insights_process_cursors.pending_rebuild_keys',
      'insights_process_cursors.scan_process_keys',
      iso('insights_process_cursors.contract_changed_at').as('contract_changed_at'),
      'insights_process_cursors.contract_change',
      iso('insights_process_cursors.coverage_from').as('coverage_from'),
      iso('insights_process_cursors.history_scanned_at').as('history_scanned_at'),
      'insights_process_cursors.undecryptable_rows',
      'insights_process_cursors.overlap_timeouts',
      iso('insights_process_cursors.last_overlap_timeout_at').as('last_overlap_timeout_at'),
      'insights_process_cursors.status',
      iso('insights_process_cursors.last_run_at').as('last_run_at'),
      'insights_process_cursors.last_error',
    ])
}

type FencedCursor = { scanId: string | null; scanChainId: string | null }

async function fence(trx: Transaction<XrayDatabase>, lease: ProjectionLease): Promise<FencedCursor> {
  const row = await trx
    .selectFrom('insights_process_cursors')
    .select(['insights_process_cursors.id', 'insights_process_cursors.scan_id', 'insights_process_cursors.scan_chain_id'])
    .where('insights_process_cursors.id', '=', lease.cursorId)
    .where('insights_process_cursors.tenant_id', '=', lease.scope.tenantId)
    .where('insights_process_cursors.organization_id', '=', lease.scope.organizationId)
    .where('insights_process_cursors.lease_owner', '=', lease.owner)
    .where('insights_process_cursors.lease_token', '=', String(lease.token))
    .forUpdate()
    .executeTakeFirst()
  if (!row) throw new ProjectionLeaseLostError()
  return { scanId: row.scan_id, scanChainId: row.scan_chain_id }
}

async function withFencedTransaction<TResult>(
  db: Kysely<XrayDatabase>,
  lease: ProjectionLease,
  leaseMs: number,
  run: (trx: Transaction<XrayDatabase>, fenced: FencedCursor) => Promise<TResult>,
): Promise<TResult> {
  return db.transaction().execute(async (trx) => {
    await sql`set local statement_timeout = ${sql.lit(COMMIT_STATEMENT_TIMEOUT_MS)}`.execute(trx)
    const fenced = await fence(trx, lease)
    const result = await run(trx, fenced)
    await trx
      .updateTable('insights_process_cursors')
      .set({
        lease_until: sql<Date>`now() + (${leaseMs}::int * interval '1 millisecond')`,
        updated_at: sql<Date>`now()`,
      })
      .where('insights_process_cursors.id', '=', lease.cursorId)
      .execute()
    return result
  })
}

type CursorUpdate = UpdateObject<XrayDatabase, 'insights_process_cursors'>

type CaseWindowRow = {
  case_id: string
  activity_key: string
  activity_kind: string
  occurred_at: string
  source_log_id: string
  seq: number
  actor_pseudonym: string | null
  cause_kind: string
  via_sync_run: boolean
  followup_field: string | null
  followup_value: string | null
}

type CaseTotalsRow = {
  case_id: string
  total: string | number
  last_activity_at: string
  distinct_actors: string | number
  automated: string | number
  legacy_events: string | number
  sync_run_events: string | number
}

type CaseCauseRow = { case_id: string; cause_kind: string; total: string | number }

type CaseLatestRow = {
  case_id: string
  marker: string
  value: string | null
  occurred_at: string
  source_log_id: string
  seq: number
}

function toCaseEvent(row: CaseWindowRow): CaseEventRow {
  return {
    activityKey: row.activity_key,
    activityKind: row.activity_kind,
    occurredAt: row.occurred_at,
    sourceLogId: row.source_log_id,
    seq: toNumber(row.seq),
    actorPseudonym: row.actor_pseudonym,
    causeKind: row.cause_kind,
    viaSyncRun: row.via_sync_run,
    followupField: row.followup_field,
    followupValue: row.followup_value,
  }
}

function toPosition(row: CaseLatestRow): CaseEventPosition {
  return { occurredAt: row.occurred_at, sourceLogId: row.source_log_id, seq: toNumber(row.seq) }
}

/**
 * The first `CASE_EVENT_LIMIT + 1` non-voided events of each case, in projection order
 * (one bounded index range per case, so a huge case never reads all of its events).
 */
async function loadCaseWindows(
  trx: Transaction<XrayDatabase>,
  scope: ProjectionScope,
  processKey: string,
  caseIds: readonly string[],
): Promise<Map<string, CaseEventRow[]>> {
  const result = await sql<CaseWindowRow>`
    select picked_cases.case_id::text as case_id, picked.activity_key, picked.activity_kind,
      to_char(picked.occurred_at at time zone 'UTC', ${ISO_FORMAT}) as occurred_at,
      picked.source_log_id::text as source_log_id, picked.seq, picked.actor_pseudonym, picked.cause_kind,
      picked.via_sync_run, picked.followup_field, picked.followup_value
    from unnest(${[...caseIds]}::uuid[]) as picked_cases(case_id)
    cross join lateral (
      select events.activity_key, events.activity_kind, events.occurred_at, events.source_log_id, events.seq,
        events.actor_pseudonym, events.cause_kind, events.via_sync_run, events.followup_field, events.followup_value
      from insights_process_events events
      where events.tenant_id = ${scope.tenantId} and events.organization_id = ${scope.organizationId}
        and events.process_key = ${processKey} and events.case_id = picked_cases.case_id and not events.voided
      order by events.occurred_at, events.source_log_id, events.seq
      limit ${CASE_EVENT_LIMIT + 1}
    ) picked
    order by picked_cases.case_id, picked.occurred_at, picked.source_log_id, picked.seq
  `.execute(trx)
  const windows = new Map<string, CaseEventRow[]>()
  for (const row of result.rows) {
    const events = windows.get(row.case_id) ?? []
    events.push(toCaseEvent(row))
    windows.set(row.case_id, events)
  }
  return windows
}

/**
 * Exact whole-case figures of cases with more than `CASE_EVENT_LIMIT` events: counts, the
 * last activity, the latest event of each stage field and of each lifecycle activity.
 */
async function loadCaseAggregates(
  trx: Transaction<XrayDatabase>,
  scope: ProjectionScope,
  processKey: string,
  caseIds: readonly string[],
): Promise<Map<string, CaseAggregate>> {
  const ids = [...caseIds]
  const scoped = sql`events.tenant_id = ${scope.tenantId} and events.organization_id = ${scope.organizationId}
    and events.process_key = ${processKey} and events.case_id = any(${ids}::uuid[]) and not events.voided`
  const totals = await sql<CaseTotalsRow>`
    select events.case_id::text as case_id, count(*) as total,
      to_char(max(events.occurred_at) at time zone 'UTC', ${ISO_FORMAT}) as last_activity_at,
      count(distinct events.actor_pseudonym) as distinct_actors,
      count(*) filter (where events.cause_kind = any(${Array.from(AUTOMATED_CAUSE_KINDS)}::text[])) as automated,
      count(*) filter (where events.cause_kind = ${PROCESS_LEGACY_CAUSE_KIND}) as legacy_events,
      count(*) filter (where events.via_sync_run) as sync_run_events
    from insights_process_events events
    where ${scoped}
    group by events.case_id
  `.execute(trx)
  const causes = await sql<CaseCauseRow>`
    select events.case_id::text as case_id, events.cause_kind, count(*) as total
    from insights_process_events events
    where ${scoped}
    group by events.case_id, events.cause_kind
  `.execute(trx)
  const latest = await sql<CaseLatestRow>`
    select distinct on (events.case_id, events.followup_field)
      events.case_id::text as case_id, events.followup_field as marker, events.followup_value as value,
      to_char(events.occurred_at at time zone 'UTC', ${ISO_FORMAT}) as occurred_at,
      events.source_log_id::text as source_log_id, events.seq
    from insights_process_events events
    where ${scoped} and events.activity_kind = 'stage' and events.followup_field is not null and events.followup_value is not null
    order by events.case_id, events.followup_field, events.occurred_at desc, events.source_log_id desc, events.seq desc
  `.execute(trx)
  const lifecycle = await sql<CaseLatestRow>`
    select distinct on (events.case_id, events.activity_key)
      events.case_id::text as case_id, events.activity_key as marker, null as value,
      to_char(events.occurred_at at time zone 'UTC', ${ISO_FORMAT}) as occurred_at,
      events.source_log_id::text as source_log_id, events.seq
    from insights_process_events events
    where ${scoped} and events.activity_kind = 'lifecycle'
    order by events.case_id, events.activity_key, events.occurred_at desc, events.source_log_id desc, events.seq desc
  `.execute(trx)
  const aggregates = new Map<string, CaseAggregate>()
  for (const row of totals.rows) {
    aggregates.set(row.case_id, {
      eventCount: toNumber(row.total),
      lastActivityAt: row.last_activity_at,
      distinctActorCount: toNumber(row.distinct_actors),
      automatedCount: toNumber(row.automated),
      legacyEvents: toNumber(row.legacy_events),
      syncRunEvents: toNumber(row.sync_run_events),
      causeKinds: {},
      latestStages: [],
      latestLifecycle: [],
    })
  }
  for (const row of causes.rows) {
    const aggregate = aggregates.get(row.case_id)
    if (aggregate) aggregate.causeKinds[row.cause_kind] = toNumber(row.total)
  }
  for (const row of latest.rows) {
    const aggregate = aggregates.get(row.case_id)
    if (aggregate && row.value !== null) aggregate.latestStages.push({ ...toPosition(row), field: row.marker, value: row.value })
  }
  for (const row of lifecycle.rows) {
    const aggregate = aggregates.get(row.case_id)
    if (aggregate) aggregate.latestLifecycle.push({ ...toPosition(row), key: row.marker })
  }
  return aggregates
}

async function recomputeCases(
  trx: Transaction<XrayDatabase>,
  scope: ProjectionScope,
  process: RegisteredProcess,
  caseIds: readonly string[],
): Promise<{ recomputed: number; removed: number }> {
  let recomputed = 0
  let removed = 0
  for (const ids of chunk(Array.from(new Set(caseIds)), ID_CHUNK_SIZE)) {
    const windows = await loadCaseWindows(trx, scope, process.processKey, ids)
    const truncatedIds = Array.from(windows.entries())
      .filter(([, events]) => events.length > CASE_EVENT_LIMIT)
      .map(([caseId]) => caseId)
    const aggregates = truncatedIds.length > 0
      ? await loadCaseAggregates(trx, scope, process.processKey, truncatedIds)
      : new Map<string, CaseAggregate>()
    const emptyIds = ids.filter((id) => !windows.has(id))
    if (emptyIds.length > 0) {
      const deleted = await trx
        .deleteFrom('insights_process_cases')
        .where('insights_process_cases.tenant_id', '=', scope.tenantId)
        .where('insights_process_cases.organization_id', '=', scope.organizationId)
        .where('insights_process_cases.process_key', '=', process.processKey)
        .where('insights_process_cases.case_id', 'in', emptyIds)
        .executeTakeFirst()
      removed += Number(deleted.numDeletedRows ?? 0)
    }
    for (const [caseId, events] of windows) {
      const summary = summarizeCase(process, events.slice(0, CASE_EVENT_LIMIT), aggregates.get(caseId) ?? null)
      if (!summary) continue
      await trx
        .insertInto('insights_process_cases')
        .values({
          tenant_id: scope.tenantId,
          organization_id: scope.organizationId,
          process_key: process.processKey,
          case_kind: process.resourceKind,
          case_id: caseId,
          started_at: timestamp(summary.startedAt),
          last_activity_at: timestamp(summary.lastActivityAt),
          ended_at: summary.endedAt ? timestamp(summary.endedAt) : null,
          status: summary.status,
          event_count: summary.eventCount,
          rework_count: summary.reworkCount,
          distinct_actor_count: summary.distinctActorCount,
          automated_share: summary.automatedShare,
          variant_hash: summary.variantHash,
          variant_keys: JSON.stringify(summary.variantKeys),
          dimensions: JSON.stringify(summary.dimensions),
          truncated: summary.truncated,
          recomputed_at: sql<Date>`now()`,
          created_at: sql<Date>`now()`,
          updated_at: sql<Date>`now()`,
        })
        .onConflict((conflict) => conflict
          .columns(['tenant_id', 'organization_id', 'process_key', 'case_id'])
          .doUpdateSet((eb) => ({
            case_kind: eb.ref('excluded.case_kind'),
            started_at: eb.ref('excluded.started_at'),
            last_activity_at: eb.ref('excluded.last_activity_at'),
            ended_at: eb.ref('excluded.ended_at'),
            status: eb.ref('excluded.status'),
            event_count: eb.ref('excluded.event_count'),
            rework_count: eb.ref('excluded.rework_count'),
            distinct_actor_count: eb.ref('excluded.distinct_actor_count'),
            automated_share: eb.ref('excluded.automated_share'),
            variant_hash: eb.ref('excluded.variant_hash'),
            variant_keys: eb.ref('excluded.variant_keys'),
            dimensions: eb.ref('excluded.dimensions'),
            truncated: eb.ref('excluded.truncated'),
            recomputed_at: eb.ref('excluded.recomputed_at'),
            updated_at: eb.ref('excluded.updated_at'),
          })))
        .execute()
      recomputed += 1
    }
  }
  return { recomputed, removed }
}

const SCAN_CLEARED: CursorUpdate = {
  scan_id: null,
  scan_kind: null,
  scan_from: null,
  scan_until: null,
  scan_after_created_at: null,
  scan_after_log_id: null,
  scan_progress_job_id: null,
  scan_chain_id: null,
  scan_process_keys: null,
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * Starts a scan. The processes of a per-process rebuild scan it replaces go back to the rebuild
 * queue, and a scan limited to some processes takes those off the queue; a scan of every
 * process leaves the queue alone (processes cleared before it started still get their own
 * rebuild scan, so an abandoned or cancelled scan never loses one).
 */
function scanStartValues(scan: ScanStart): CursorUpdate {
  const processKeys = scan.processKeys ? uniqueSorted(scan.processKeys) : null
  return {
    scan_id: scan.scanId,
    scan_chain_id: scan.chainId,
    scan_kind: scan.kind,
    scan_from: scan.from ? timestamp(scan.from) : null,
    scan_until: timestamp(scan.until),
    scan_after_created_at: scan.from ? timestamp(scan.from) : null,
    scan_after_log_id: scan.from ? MAX_LOG_ID : null,
    scan_progress_job_id: scan.progressJobId,
    scan_processed_count: 0,
    scan_started_at: sql<Date>`now()`,
    scan_updated_at: sql<Date>`now()`,
    scan_process_keys: processKeys ? jsonValue(processKeys) : null,
    pending_rebuild_keys: sql<string>`coalesce((
      select jsonb_agg(queued.key order by queued.key collate "C")
      from (
        select jsonb_array_elements_text(insights_process_cursors.pending_rebuild_keys) as key
        union
        select jsonb_array_elements_text(coalesce(insights_process_cursors.scan_process_keys, '[]'::jsonb))
      ) as queued
      where not (queued.key = any(${processKeys ?? []}::text[]))
    ), '[]'::jsonb)`,
    status: 'backfilling',
    updated_at: sql<Date>`now()`,
  }
}

/**
 * Erasure ledger entries of the users behind a batch's pseudonyms, read inside the fenced
 * transaction: an erasure committed before the fence lock was taken is always applied.
 */
async function loadErasures(
  trx: Transaction<XrayDatabase>,
  tenantId: string,
  events: readonly ProjectionEventInsert[],
): Promise<Map<string, string>> {
  const userIds = new Set<string>()
  for (const event of events) {
    if (event.actorUserId && event.actorPseudonym !== null) userIds.add(event.actorUserId)
    if (event.followupUserId && event.followupValue !== null) userIds.add(event.followupUserId)
  }
  const erasures = new Map<string, string>()
  for (const ids of chunk(Array.from(userIds), ID_CHUNK_SIZE)) {
    const rows = await trx
      .selectFrom('insights_process_erasures')
      .select(['insights_process_erasures.user_id', 'insights_process_erasures.replacement'])
      .where('insights_process_erasures.tenant_id', '=', tenantId)
      .where('insights_process_erasures.user_id', 'in', ids)
      .execute()
    for (const row of rows) erasures.set(row.user_id, row.replacement)
  }
  return erasures
}

function applyAdvance(advance: CursorAdvance): CursorUpdate | null {
  if (advance.kind === 'main') {
    return { last_created_at: timestamp(advance.lastCreatedAt), last_log_id: advance.lastLogId, last_run_at: sql<Date>`now()`, last_error: null }
  }
  if (advance.kind === 'state') {
    return { state_watermark: timestamp(advance.stateWatermark), state_last_log_id: advance.stateLastLogId }
  }
  if (advance.kind === 'scan') {
    return {
      scan_after_created_at: timestamp(advance.afterCreatedAt),
      scan_after_log_id: advance.afterLogId,
      scan_processed_count: sql<string>`scan_processed_count + ${Math.max(0, Math.trunc(advance.processedDelta))}`,
      scan_updated_at: sql<Date>`now()`,
    }
  }
  return null
}

export type ProjectionStore = ReturnType<typeof createProjectionStore>

/**
 * Data access of the X-Ray projection. Every projection write goes through fenced helpers
 * that open a transaction, lock the cursor row and verify the lease owner and fencing token
 * before writing (a stale worker whose lease was taken over fails with
 * `ProjectionLeaseLostError` and writes nothing). Outside the lease only scan bookkeeping is
 * written (`startScan` by a person, the chain heartbeat and `abandonScan`, both conditional
 * on the scan and its chain) and the tenant-wide erasure (`recordErasure`,
 * `replaceActorPseudonym`, which locks one organization's cursor row per batch). Every query
 * carries the tenant, and the organization unless it is tenant-wide.
 */
export function createProjectionStore(db: Kysely<XrayDatabase>) {
  async function now(): Promise<string> {
    const result = await sql<{ now: string }>`select to_char(now() at time zone 'UTC', ${ISO_FORMAT}) as now`.execute(db)
    const value = result.rows[0]?.now
    if (!value) throw new Error('[internal] Database clock unavailable')
    return value
  }

  async function readCursor(scope: ProjectionScope): Promise<ProjectionCursor | null> {
    const row = await selectCursor(db)
      .where('insights_process_cursors.tenant_id', '=', scope.tenantId)
      .where('insights_process_cursors.organization_id', '=', scope.organizationId)
      .executeTakeFirst()
    return row ? mapCursor(row as CursorRow) : null
  }

  /**
   * Creates the organization's cursor (idempotent) at `now - settleMs`, covered from that
   * time on, without contracts: the first slice adopts the current ones (the projection of a
   * new cursor is empty, so there is nothing to rebuild).
   */
  async function ensureCursor(scope: ProjectionScope, settleMs: number): Promise<ProjectionCursor> {
    const start = sql<Date>`now() - (${settleMs}::int * interval '1 millisecond')`
    await db
      .insertInto('insights_process_cursors')
      .values({
        tenant_id: scope.tenantId,
        organization_id: scope.organizationId,
        last_created_at: start,
        last_log_id: MAX_LOG_ID,
        state_watermark: start,
        state_last_log_id: MAX_LOG_ID,
        contract_hashes: null,
        pending_rebuild_keys: '[]',
        coverage_from: start,
        undecryptable_rows: 0,
        overlap_timeouts: 0,
        status: 'idle',
        scan_processed_count: 0,
        lease_token: 0,
        last_reconciled_at: sql<Date>`now()`,
        last_full_reconciled_at: sql<Date>`now()`,
        last_pruned_at: sql<Date>`now()`,
        created_at: sql<Date>`now()`,
        updated_at: sql<Date>`now()`,
      })
      .onConflict((conflict) => conflict.columns(['tenant_id', 'organization_id']).doNothing())
      .execute()
    const cursor = await readCursor(scope)
    if (!cursor) throw new Error('[internal] X-Ray cursor could not be created')
    return cursor
  }

  /**
   * Compare-and-set lease: granted only when no live lease exists. Waits at most
   * `lockTimeoutMs` for the cursor row lock (held by a fenced commit or an erasure batch);
   * a lock timeout counts as busy.
   */
  async function acquireLease(
    cursor: ProjectionCursor,
    owner: string,
    leaseMs: number,
    options: { lockTimeoutMs?: number } = {},
  ): Promise<ProjectionLease | null> {
    const lockTimeoutMs = Math.max(1, Math.trunc(options.lockTimeoutMs ?? LEASE_LOCK_TIMEOUT_MS))
    let row: { lease_token: string } | undefined
    try {
      row = await db.transaction().execute(async (trx) => {
        await sql`set local lock_timeout = ${sql.lit(lockTimeoutMs)}`.execute(trx)
        return trx
          .updateTable('insights_process_cursors')
          .set({
            lease_owner: owner,
            lease_token: sql<string>`lease_token + 1`,
            lease_until: sql<Date>`now() + (${leaseMs}::int * interval '1 millisecond')`,
            updated_at: sql<Date>`now()`,
          })
          .where('insights_process_cursors.id', '=', cursor.id)
          .where('insights_process_cursors.tenant_id', '=', cursor.tenantId)
          .where('insights_process_cursors.organization_id', '=', cursor.organizationId)
          .where((eb) => eb.or([
            eb('insights_process_cursors.lease_owner', 'is', null),
            eb('insights_process_cursors.lease_until', 'is', null),
            eb('insights_process_cursors.lease_until', '<', sql<Date>`now()`),
          ]))
          .returning(['insights_process_cursors.lease_token'])
          .executeTakeFirst()
      })
    } catch (error) {
      if (isLockTimeoutError(error)) return null
      throw error
    }
    if (!row) return null
    return {
      cursorId: cursor.id,
      scope: { tenantId: cursor.tenantId, organizationId: cursor.organizationId },
      owner,
      token: toNumber(row.lease_token),
    }
  }

  async function releaseLease(lease: ProjectionLease): Promise<void> {
    await db
      .updateTable('insights_process_cursors')
      .set({ lease_owner: null, lease_until: null, updated_at: sql<Date>`now()` })
      .where('insights_process_cursors.id', '=', lease.cursorId)
      .where('insights_process_cursors.lease_owner', '=', lease.owner)
      .where('insights_process_cursors.lease_token', '=', String(lease.token))
      .execute()
  }

  async function commit(lease: ProjectionLease, leaseMs: number, batch: ProjectionCommit): Promise<ProjectionCommitResult> {
    return withFencedTransaction(db, lease, leaseMs, async (trx, fenced) => {
      if (batch.advance.kind === 'scan' && (fenced.scanId !== batch.advance.scanId || fenced.scanChainId !== batch.advance.chainId)) {
        throw new ProjectionScanSupersededError()
      }
      const scope = lease.scope
      const touched = new Map<string, Set<string>>()
      const touch = (processKey: string, caseId: string) => {
        const cases = touched.get(processKey) ?? new Set<string>()
        cases.add(caseId)
        touched.set(processKey, cases)
      }
      const erasures = await loadErasures(trx, scope.tenantId, batch.events)
      let inserted = 0
      for (const rows of chunk(batch.events, INSERT_CHUNK_SIZE)) {
        const result = await trx
          .insertInto('insights_process_events')
          .values(rows.map((event) => ({
            tenant_id: scope.tenantId,
            organization_id: scope.organizationId,
            process_key: event.processKey,
            case_kind: event.caseKind,
            case_id: event.caseId,
            activity_key: event.activityKey,
            activity_kind: event.activityKind,
            occurred_at: timestamp(event.occurredAt),
            source_log_id: event.sourceLogId,
            seq: event.seq,
            actor_pseudonym: event.actorPseudonym !== null && event.actorUserId
              ? erasures.get(event.actorUserId) ?? event.actorPseudonym
              : event.actorPseudonym,
            actor_role_ids: event.actorRoleIds,
            actor_team_id: event.actorTeamId,
            cause_kind: event.causeKind,
            cause_id: event.causeId,
            via_sync_run: event.viaSyncRun,
            followup_field: event.followupField,
            followup_value: event.followupValue !== null && event.followupUserId
              ? erasures.get(event.followupUserId) ?? event.followupValue
              : event.followupValue,
            voided: event.voided,
            voided_by_log_id: event.voidedByLogId,
            created_at: sql<Date>`now()`,
          })))
          .onConflict((conflict) => conflict.columns(['source_log_id', 'process_key', 'seq']).doNothing())
          .returning(['insights_process_events.process_key', 'insights_process_events.case_id'])
          .execute()
        inserted += result.length
        for (const row of result) touch(row.process_key, row.case_id)
      }
      let voided = 0
      for (const voidRequest of batch.voids) {
        for (const ids of chunk(Array.from(new Set(voidRequest.sourceLogIds)), ID_CHUNK_SIZE)) {
          const voidedByLogId = voidRequest.voidedByLogId
          const result = await trx
            .updateTable('insights_process_events')
            .set({ voided: true, voided_by_log_id: voidedByLogId })
            .where('insights_process_events.tenant_id', '=', scope.tenantId)
            .where('insights_process_events.organization_id', '=', scope.organizationId)
            .where('insights_process_events.source_log_id', 'in', ids)
            .where((eb) => voidedByLogId
              ? eb.or([
                eb('insights_process_events.voided', '=', false),
                eb('insights_process_events.voided_by_log_id', 'is', null),
              ])
              : eb('insights_process_events.voided', '=', false))
            .returning(['insights_process_events.process_key', 'insights_process_events.case_id'])
            .execute()
          voided += result.length
          for (const row of result) touch(row.process_key, row.case_id)
        }
      }
      let casesRecomputed = 0
      let casesRemoved = 0
      for (const [processKey, caseIds] of touched) {
        const process = batch.processes.find((candidate) => candidate.processKey === processKey)
        if (!process) continue
        const outcome = await recomputeCases(trx, scope, process, Array.from(caseIds))
        casesRecomputed += outcome.recomputed
        casesRemoved += outcome.removed
      }
      const skipped = Math.max(0, Math.trunc(batch.undecryptable ?? 0))
      const advance: CursorUpdate = {
        ...(applyAdvance(batch.advance) ?? {}),
        ...(skipped > 0 ? { undecryptable_rows: sql<string>`undecryptable_rows + ${skipped}` } : {}),
      }
      if (Object.keys(advance).length > 0) {
        await trx
          .updateTable('insights_process_cursors')
          .set(advance)
          .where('insights_process_cursors.id', '=', lease.cursorId)
          .execute()
      }
      return { inserted, voided, casesRecomputed, casesRemoved }
    })
  }

  /**
   * Records the organization's process contracts under the lease: replaces the contract map
   * (removed processes are dropped from it, their rows stay), queues `rebuild` processes for a
   * rebuild scan (queued processes that are no longer registered are dropped) and stores the
   * change. Returns the cursor as written.
   */
  async function applyContractTransition(lease: ProjectionLease, leaseMs: number, transition: ContractTransition): Promise<ProjectionCursor> {
    return withFencedTransaction(db, lease, leaseMs, async (trx) => {
      const current = await trx
        .selectFrom('insights_process_cursors')
        .select(['insights_process_cursors.pending_rebuild_keys'])
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .executeTakeFirst()
      const registered = new Set(Object.keys(transition.hashes))
      const pending = uniqueSorted([...readKeyList(current?.pending_rebuild_keys), ...transition.rebuild])
        .filter((processKey) => registered.has(processKey))
      const values: CursorUpdate = {
        contract_hashes: jsonValue(readHashes(transition.hashes) ?? {}),
        pending_rebuild_keys: jsonValue(pending),
        updated_at: sql<Date>`now()`,
      }
      if (transition.change) {
        values.contract_changed_at = sql<Date>`now()`
        values.contract_change = jsonValue({
          changed: uniqueSorted(transition.change.changed),
          added: uniqueSorted(transition.change.added),
          removed: uniqueSorted(transition.change.removed),
        })
      }
      await trx.updateTable('insights_process_cursors').set(values).where('insights_process_cursors.id', '=', lease.cursorId).execute()
      const row = await selectCursor(trx).where('insights_process_cursors.id', '=', lease.cursorId).executeTakeFirst()
      if (!row) throw new ProjectionLeaseLostError()
      return mapCursor(row as CursorRow)
    })
  }

  /**
   * Queues processes for a rebuild scan under the lease before their rows are cleared, so the
   * status shows them as rebuilding while a budgeted clearing spans several slices.
   */
  async function queueProcessRebuilds(lease: ProjectionLease, leaseMs: number, processKeys: readonly string[]): Promise<void> {
    await withFencedTransaction(db, lease, leaseMs, async (trx) => {
      const current = await trx
        .selectFrom('insights_process_cursors')
        .select(['insights_process_cursors.pending_rebuild_keys'])
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .executeTakeFirst()
      const pending = uniqueSorted([...readKeyList(current?.pending_rebuild_keys), ...processKeys])
      await trx
        .updateTable('insights_process_cursors')
        .set({ pending_rebuild_keys: jsonValue(pending), updated_at: sql<Date>`now()` })
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .execute()
    })
  }

  /** Counts an overlap re-read that ended on its statement timeout (visible in the status). */
  async function noteOverlapTimeout(lease: ProjectionLease, leaseMs: number): Promise<void> {
    await updateCursor(lease, leaseMs, {
      overlap_timeouts: sql<string>`overlap_timeouts + 1`,
      last_overlap_timeout_at: sql<Date>`now()`,
    })
  }

  async function updateCursor(lease: ProjectionLease, leaseMs: number, values: CursorUpdate): Promise<void> {
    await withFencedTransaction(db, lease, leaseMs, async (trx) => {
      await trx
        .updateTable('insights_process_cursors')
        .set(values)
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .execute()
    })
  }

  /** Starts (or restarts) a scan requested by a person: replaces any running scan. */
  async function startScan(cursor: ProjectionCursor, scan: ScanStart): Promise<void> {
    await db
      .updateTable('insights_process_cursors')
      .set(scanStartValues(scan))
      .where('insights_process_cursors.id', '=', cursor.id)
      .where('insights_process_cursors.tenant_id', '=', cursor.tenantId)
      .where('insights_process_cursors.organization_id', '=', cursor.organizationId)
      .execute()
  }

  /** Starts a scheduled reconciliation under the lease, only when no scan is running. */
  async function startScanIfIdle(lease: ProjectionLease, leaseMs: number, scan: ScanStart): Promise<boolean> {
    return withFencedTransaction(db, lease, leaseMs, async (trx, fenced) => {
      if (fenced.scanId) return false
      const result = await trx
        .updateTable('insights_process_cursors')
        .set(scanStartValues(scan))
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .where('insights_process_cursors.scan_id', 'is', null)
        .executeTakeFirst()
      return Number(result.numUpdatedRows ?? 0) > 0
    })
  }

  /** Heartbeat of the live job chain of a scan; ignored for another scan or a stale chain. */
  async function touchScan(scope: ProjectionScope, scanId: string, chainId: string): Promise<boolean> {
    const result = await db
      .updateTable('insights_process_cursors')
      .set({ scan_updated_at: sql<Date>`now()` })
      .where('insights_process_cursors.tenant_id', '=', scope.tenantId)
      .where('insights_process_cursors.organization_id', '=', scope.organizationId)
      .where('insights_process_cursors.scan_id', '=', scanId)
      .where('insights_process_cursors.scan_chain_id', '=', chainId)
      .executeTakeFirst()
    return Number(result.numUpdatedRows ?? 0) > 0
  }

  /**
   * Hands a scan whose chain showed no sign of life for `staleMs` to a new job chain
   * (compare-and-set under the lease): the old chain's jobs then stop on the chain mismatch,
   * so exactly one chain advances the scan.
   */
  async function resumeStalledScan(lease: ProjectionLease, leaseMs: number, staleMs: number): Promise<ScanResume | null> {
    return withFencedTransaction(db, lease, leaseMs, async (trx) => {
      const chainId = randomUUID()
      const row = await trx
        .updateTable('insights_process_cursors')
        .set({ scan_chain_id: chainId, scan_updated_at: sql<Date>`now()` })
        .where('insights_process_cursors.id', '=', lease.cursorId)
        .where('insights_process_cursors.scan_id', 'is not', null)
        .where((eb) => eb.or([
          eb('insights_process_cursors.scan_updated_at', 'is', null),
          eb('insights_process_cursors.scan_updated_at', '<', sql<Date>`now() - (${staleMs}::int * interval '1 millisecond')`),
        ]))
        .returning(['insights_process_cursors.scan_id', 'insights_process_cursors.scan_progress_job_id'])
        .executeTakeFirst()
      if (!row?.scan_id) return null
      return { scanId: row.scan_id, chainId, progressJobId: row.scan_progress_job_id ?? null }
    })
  }

  /**
   * Clears the finished scan. A scan of every process also records the reconciliation (and,
   * for a backfill or full reconciliation, the history coverage from its lower bound); a
   * per-process rebuild scan records nothing organization-wide.
   */
  async function finishScan(lease: ProjectionLease, leaseMs: number, scanId: string, chainId: string, kind: ProcessScanKind): Promise<boolean> {
    return withFencedTransaction(db, lease, leaseMs, async (trx, fenced) => {
      if (fenced.scanId !== scanId || fenced.scanChainId !== chainId) return false
      const values: CursorUpdate = {
        ...SCAN_CLEARED,
        status: 'idle',
        last_reconciled_at: sql<Date>`case when scan_process_keys is null then now() else last_reconciled_at end`,
        updated_at: sql<Date>`now()`,
      }
      if (kind === 'full_reconcile' || kind === 'backfill') {
        values.last_full_reconciled_at = sql<Date>`case when scan_process_keys is null then now() else last_full_reconciled_at end`
        values.history_scanned_at = sql<Date>`case when scan_process_keys is null then now() else history_scanned_at end`
        values.coverage_from = sql<Date>`case when scan_process_keys is null then least(coverage_from, scan_from) else coverage_from end`
      }
      await trx.updateTable('insights_process_cursors').set(values).where('insights_process_cursors.id', '=', lease.cursorId).execute()
      return true
    })
  }

  /**
   * Clears a scan its live chain gave up on. A scheduled reconciliation counts as attempted,
   * so the next tick does not restart it at once (it is retried at its next due time); the
   * processes of an abandoned per-process rebuild go back to the rebuild queue.
   */
  async function abandonScan(
    scope: ProjectionScope,
    scanId: string,
    chainId: string,
    error: string,
  ): Promise<{ progressJobId: string | null } | null> {
    const current = await db
      .selectFrom('insights_process_cursors')
      .select(['insights_process_cursors.scan_progress_job_id'])
      .where('insights_process_cursors.tenant_id', '=', scope.tenantId)
      .where('insights_process_cursors.organization_id', '=', scope.organizationId)
      .where('insights_process_cursors.scan_id', '=', scanId)
      .where('insights_process_cursors.scan_chain_id', '=', chainId)
      .executeTakeFirst()
    if (!current) return null
    const row = await db
      .updateTable('insights_process_cursors')
      .set({
        ...SCAN_CLEARED,
        last_reconciled_at: sql<Date>`case when scan_process_keys is null and scan_kind in ('reconcile', 'full_reconcile') then now() else last_reconciled_at end`,
        last_full_reconciled_at: sql<Date>`case when scan_process_keys is null and scan_kind = 'full_reconcile' then now() else last_full_reconciled_at end`,
        pending_rebuild_keys: sql<string>`case when scan_process_keys is null then pending_rebuild_keys else coalesce((
          select jsonb_agg(queued.key order by queued.key collate "C")
          from (
            select jsonb_array_elements_text(insights_process_cursors.pending_rebuild_keys) as key
            union
            select jsonb_array_elements_text(insights_process_cursors.scan_process_keys)
          ) as queued
        ), '[]'::jsonb) end`,
        last_error: error.slice(0, 2000),
        status: 'idle',
        updated_at: sql<Date>`now()`,
      })
      .where('insights_process_cursors.tenant_id', '=', scope.tenantId)
      .where('insights_process_cursors.organization_id', '=', scope.organizationId)
      .where('insights_process_cursors.scan_id', '=', scanId)
      .where('insights_process_cursors.scan_chain_id', '=', chainId)
      .returning(['insights_process_cursors.id'])
      .executeTakeFirst()
    return row ? { progressJobId: current.scan_progress_job_id ?? null } : null
  }

  async function recordError(cursor: ProjectionCursor, error: string | null): Promise<void> {
    await db
      .updateTable('insights_process_cursors')
      .set({ last_error: error ? error.slice(0, 2000) : null, updated_at: sql<Date>`now()` })
      .where('insights_process_cursors.id', '=', cursor.id)
      .where('insights_process_cursors.tenant_id', '=', cursor.tenantId)
      .where('insights_process_cursors.organization_id', '=', cursor.organizationId)
      .execute()
  }

  /**
   * The given values already stored for a field: one index point lookup per value on
   * `insights_process_events_value_idx` (stops at the first match, never reads duplicates).
   */
  async function findKnownValues(scope: ProjectionScope, processKey: string, field: string, values: readonly string[]): Promise<string[]> {
    const candidates = uniqueSorted(values)
    if (candidates.length === 0) return []
    const result = await sql<{ value: string }>`
      select candidate.value
      from unnest(${candidates}::text[]) as candidate(value)
      where exists (
        select 1 from insights_process_events events
        where events.tenant_id = ${scope.tenantId} and events.organization_id = ${scope.organizationId}
          and events.process_key = ${processKey} and events.followup_field = ${field}
          and events.followup_value = candidate.value
      )
    `.execute(db)
    return result.rows.map((row) => row.value)
  }

  /**
   * Distinct stored values of a field (reserved `other` / `none` excluded), counted up to
   * `limit`: a loose index scan over `insights_process_events_value_idx` (one index seek per
   * distinct value), so a field with millions of duplicate rows costs at most `limit + 2` seeks.
   */
  async function countDistinctValues(scope: ProjectionScope, processKey: string, field: string, limit: number): Promise<number> {
    const bound = Math.max(0, Math.trunc(limit))
    if (bound === 0) return 0
    const scoped = sql`events.tenant_id = ${scope.tenantId} and events.organization_id = ${scope.organizationId}
      and events.process_key = ${processKey} and events.followup_field = ${field}`
    const result = await sql<{ total: string | number }>`
      with recursive walk(value, depth) as (
        (
          select events.followup_value, 1
          from insights_process_events events
          where ${scoped} and events.followup_value is not null
          order by events.followup_value
          limit 1
        )
        union all
        select (
          select events.followup_value
          from insights_process_events events
          where ${scoped} and events.followup_value > walk.value
          order by events.followup_value
          limit 1
        ), walk.depth + 1
        from walk
        where walk.value is not null and walk.depth < ${bound + RESERVED_VALUE_COUNT}
      )
      select count(*) filter (where walk.value is not null and walk.value not in ('other', 'none')) as total from walk
    `.execute(db)
    return Math.min(bound, toNumber(result.rows[0]?.total))
  }

  /** Removes one batch of the organization's projection rows (of one process when given). */
  async function clearProjectionBatch(
    lease: ProjectionLease,
    leaseMs: number,
    table: 'insights_process_events' | 'insights_process_cases' | 'insights_process_rollups',
    batchSize: number,
    processKey?: string,
  ): Promise<number> {
    return withFencedTransaction(db, lease, leaseMs, async (trx) => {
      const scope = lease.scope
      const ofProcess = processKey === undefined ? sql`` : sql`and process_key = ${processKey}`
      const result = await sql<{ id: string }>`
        delete from ${sql.table(table)}
        where id in (
          select id from ${sql.table(table)}
          where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId} ${ofProcess}
          limit ${batchSize}
        )
        returning id
      `.execute(trx)
      return result.rows.length
    })
  }

  async function pruneProjectionBatch(
    lease: ProjectionLease,
    leaseMs: number,
    table: 'insights_process_events' | 'insights_process_cases' | 'insights_process_rollups',
    cutoff: string,
    batchSize: number,
  ): Promise<number> {
    return withFencedTransaction(db, lease, leaseMs, async (trx) => {
      const scope = lease.scope
      const candidates = table === 'insights_process_events'
        ? sql`
            select events.id from insights_process_events events
            where events.tenant_id = ${scope.tenantId} and events.organization_id = ${scope.organizationId}
              and events.occurred_at < ${cutoff}::timestamptz
              and (
                events.voided
                or not exists (
                  select 1 from insights_process_cases cases
                  where cases.tenant_id = events.tenant_id and cases.organization_id = events.organization_id
                    and cases.process_key = events.process_key and cases.case_id = events.case_id
                    and cases.last_activity_at >= ${cutoff}::timestamptz
                )
              )
            limit ${batchSize}
          `
        : table === 'insights_process_cases'
          ? sql`
              select id from insights_process_cases
              where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}
                and last_activity_at < ${cutoff}::timestamptz
              limit ${batchSize}
            `
          : sql`
              select id from insights_process_rollups
              where tenant_id = ${scope.tenantId} and organization_id = ${scope.organizationId}
                and window_end < ${cutoff}::timestamptz
              limit ${batchSize}
            `
      const result = await sql<{ id: string }>`
        delete from ${sql.table(table)} where id in (${candidates}) returning id
      `.execute(trx)
      return result.rows.length
    })
  }

  /**
   * Resets the cursor after a cleared projection: positions at `now - settleMs`, no contracts
   * (the next slice adopts the current ones), no rebuild queue, no pseudonym key, no scan, and
   * no completed full reconciliation, so the next caught-up tick schedules one if the backfill
   * that should follow never starts.
   */
  async function resetCursor(lease: ProjectionLease, leaseMs: number, settleMs: number): Promise<void> {
    const start = sql<Date>`now() - (${settleMs}::int * interval '1 millisecond')`
    await updateCursor(lease, leaseMs, {
      ...SCAN_CLEARED,
      last_created_at: start,
      last_log_id: MAX_LOG_ID,
      state_watermark: start,
      state_last_log_id: MAX_LOG_ID,
      scan_processed_count: 0,
      scan_started_at: null,
      scan_updated_at: null,
      actor_key_fingerprint: null,
      contract_hashes: null,
      pending_rebuild_keys: '[]',
      contract_changed_at: null,
      contract_change: null,
      coverage_from: start,
      history_scanned_at: null,
      last_full_reconciled_at: null,
      undecryptable_rows: 0,
      overlap_timeouts: 0,
      last_overlap_timeout_at: null,
      status: 'idle',
      last_error: null,
    })
  }

  /**
   * Per-process counts for the status, under a short statement timeout: on timeout the counts
   * are unavailable (null) instead of failing the status.
   */
  async function counts(scope: ProjectionScope, options: { statementTimeoutMs?: number } = {}): Promise<ProjectionCounts[] | null> {
    const timeoutMs = Math.max(1, Math.trunc(options.statementTimeoutMs ?? COUNTS_STATEMENT_TIMEOUT_MS))
    try {
      return await db.transaction().execute(async (trx) => {
        await sql`set local statement_timeout = ${sql.lit(timeoutMs)}`.execute(trx)
        const events = await trx
          .selectFrom('insights_process_events')
          .select([
            'insights_process_events.process_key',
            sql<string>`count(*) filter (where not insights_process_events.voided)`.as('events'),
            sql<string>`count(*) filter (where insights_process_events.voided)`.as('voided_events'),
            sql<string | null>`to_char(min(insights_process_events.occurred_at) at time zone 'UTC', ${ISO_FORMAT})`.as('first_occurred_at'),
            sql<string | null>`to_char(max(insights_process_events.occurred_at) at time zone 'UTC', ${ISO_FORMAT})`.as('last_occurred_at'),
          ])
          .where('insights_process_events.tenant_id', '=', scope.tenantId)
          .where('insights_process_events.organization_id', '=', scope.organizationId)
          .groupBy('insights_process_events.process_key')
          .execute()
        const cases = await trx
          .selectFrom('insights_process_cases')
          .select([
            'insights_process_cases.process_key',
            sql<string>`count(*)`.as('cases'),
            sql<string>`count(*) filter (where insights_process_cases.status = 'open')`.as('open_cases'),
          ])
          .where('insights_process_cases.tenant_id', '=', scope.tenantId)
          .where('insights_process_cases.organization_id', '=', scope.organizationId)
          .groupBy('insights_process_cases.process_key')
          .execute()
        const byProcess = new Map<string, ProjectionCounts>()
        const entryFor = (processKey: string): ProjectionCounts => {
          const existing = byProcess.get(processKey)
          if (existing) return existing
          const created: ProjectionCounts = { processKey, events: 0, voidedEvents: 0, cases: 0, openCases: 0, firstOccurredAt: null, lastOccurredAt: null }
          byProcess.set(processKey, created)
          return created
        }
        for (const row of events) {
          const entry = entryFor(row.process_key)
          entry.events = toNumber(row.events)
          entry.voidedEvents = toNumber(row.voided_events)
          entry.firstOccurredAt = row.first_occurred_at
          entry.lastOccurredAt = row.last_occurred_at
        }
        for (const row of cases) {
          const entry = entryFor(row.process_key)
          entry.cases = toNumber(row.cases)
          entry.openCases = toNumber(row.open_cases)
        }
        return Array.from(byProcess.values()).sort((left, right) => compareCodeUnits(left.processKey, right.processKey))
      })
    } catch (error) {
      if (isStatementTimeoutError(error)) return null
      throw error
    }
  }

  /**
   * Cursors of one tenant (optionally one organization), or — only when `allTenants` is set
   * explicitly, for system fan-outs — one page of every tenant's cursors in
   * `(tenant_id, organization_id)` order after `after`.
   */
  async function listCursors(filter: CursorListFilter): Promise<ProjectionCursor[]> {
    let query = selectCursor(db)
    if ('allTenants' in filter) {
      if (filter.allTenants !== true) return []
      const after = filter.after
      if (after) {
        query = query.where((eb) => eb.or([
          eb('insights_process_cursors.tenant_id', '>', after.tenantId),
          eb.and([
            eb('insights_process_cursors.tenant_id', '=', after.tenantId),
            eb('insights_process_cursors.organization_id', '>', after.organizationId),
          ]),
        ]))
      }
      const limit = Math.min(CURSOR_PAGE_SIZE, Math.max(1, Math.trunc(filter.limit ?? CURSOR_PAGE_SIZE)))
      const rows = await query
        .orderBy('insights_process_cursors.tenant_id')
        .orderBy('insights_process_cursors.organization_id')
        .limit(limit)
        .execute()
      return rows.map((row) => mapCursor(row as CursorRow))
    }
    if (typeof filter.tenantId !== 'string' || filter.tenantId.length === 0) return []
    query = query.where('insights_process_cursors.tenant_id', '=', filter.tenantId)
    if (filter.organizationId) query = query.where('insights_process_cursors.organization_id', '=', filter.organizationId)
    const rows = await query.orderBy('insights_process_cursors.organization_id').execute()
    return rows.map((row) => mapCursor(row as CursorRow))
  }

  /**
   * GDPR erasure, step 1: records the user in the tenant's erasure ledger (idempotent) and
   * returns the random replacement pseudonym. Every fenced commit applies the ledger, so no
   * later re-projection (backfill, reconciliation, rebuild, re-key) restores the pseudonym.
   */
  async function recordErasure(tenantId: string, userId: string): Promise<string> {
    await db
      .insertInto('insights_process_erasures')
      .values({
        tenant_id: tenantId,
        user_id: userId,
        replacement: `${ERASED_PSEUDONYM_PREFIX}${randomUUID()}`,
        created_at: sql<Date>`now()`,
      })
      .onConflict((conflict) => conflict.columns(['tenant_id', 'user_id']).doNothing())
      .execute()
    const ledger = await db
      .selectFrom('insights_process_erasures')
      .select(['insights_process_erasures.replacement'])
      .where('insights_process_erasures.tenant_id', '=', tenantId)
      .where('insights_process_erasures.user_id', '=', userId)
      .executeTakeFirst()
    if (!ledger) throw new Error('[internal] The X-Ray erasure ledger row could not be recorded')
    return ledger.replacement
  }

  /**
   * The `(process_key, followup_field)` pairs holding values in an organization's events: a
   * loose index scan over `insights_process_events_value_idx` (one seek per pair), so the
   * erasure also reaches value fields of processes no longer registered (their rows stay).
   */
  async function loadValueFields(trx: Transaction<XrayDatabase>, tenantId: string, organizationId: string): Promise<ValueField[]> {
    const result = await sql<{ process_key: string; followup_field: string }>`
      with recursive pairs(process_key, followup_field, depth) as (
        (
          select events.process_key, events.followup_field, 1
          from insights_process_events events
          where events.tenant_id = ${tenantId} and events.organization_id = ${organizationId}
            and events.followup_field is not null
          order by events.process_key, events.followup_field
          limit 1
        )
        union all
        select next_pair.process_key, next_pair.followup_field, pairs.depth + 1
        from pairs
        cross join lateral (
          select events.process_key, events.followup_field
          from insights_process_events events
          where events.tenant_id = ${tenantId} and events.organization_id = ${organizationId}
            and events.followup_field is not null
            and (events.process_key, events.followup_field) > (pairs.process_key, pairs.followup_field)
          order by events.process_key, events.followup_field
          limit 1
        ) as next_pair
        where pairs.depth < ${VALUE_FIELD_SCAN_LIMIT}
      )
      select process_key, followup_field from pairs
    `.execute(trx)
    return result.rows.map((row) => ({ processKey: row.process_key, field: row.followup_field }))
  }

  /**
   * Re-pseudonymizes one bounded batch of an organization's rows (actor, then values) while
   * holding that organization's cursor row lock, which waits for an in-flight fenced commit of
   * the organization. The value fields are read under the lock of the first batch (after every
   * commit that started before the ledger row finished). `skipped` when the organization has no
   * rows under a pseudonym key, `mismatched` when they were written under another key (nothing
   * is changed then).
   */
  async function replacePseudonymBatch(
    input: ActorErasureInput,
    pseudonym: string,
    target: { id: string; organizationId: string },
    knownFields: ValueField[] | null,
    batchSize: number,
  ): Promise<{ updated: number; mismatched: boolean; skipped: boolean; fields: ValueField[] | null }> {
    return db.transaction().execute(async (trx) => {
      await sql`set local statement_timeout = ${sql.lit(COMMIT_STATEMENT_TIMEOUT_MS)}`.execute(trx)
      const locked = await trx
        .selectFrom('insights_process_cursors')
        .select(['insights_process_cursors.actor_key_fingerprint'])
        .where('insights_process_cursors.id', '=', target.id)
        .where('insights_process_cursors.tenant_id', '=', input.tenantId)
        .where('insights_process_cursors.organization_id', '=', target.organizationId)
        .forUpdate()
        .executeTakeFirst()
      const stored = locked?.actor_key_fingerprint ?? null
      if (!locked || stored === null || stored === NO_PSEUDONYM_KEY_FINGERPRINT) return { updated: 0, mismatched: false, skipped: true, fields: knownFields }
      if (stored !== input.keyFingerprint) return { updated: 0, mismatched: true, skipped: true, fields: knownFields }
      const fields = knownFields ?? uniqueValueFields([...input.userValueFields, ...await loadValueFields(trx, input.tenantId, target.organizationId)])
      const actors = await sql<{ id: string }>`
        update insights_process_events set actor_pseudonym = ${input.replacement}
        where id in (
          select events.id from insights_process_events events
          where events.tenant_id = ${input.tenantId} and events.organization_id = ${target.organizationId}
            and events.actor_pseudonym = ${pseudonym}
          limit ${batchSize}
        )
        returning id
      `.execute(trx)
      let updated = actors.rows.length
      for (const field of fields) {
        const remaining = batchSize - updated
        if (remaining <= 0) break
        const values = await sql<{ id: string }>`
          update insights_process_events set followup_value = ${input.replacement}
          where id in (
            select events.id from insights_process_events events
            where events.tenant_id = ${input.tenantId} and events.organization_id = ${target.organizationId}
              and events.process_key = ${field.processKey} and events.followup_field = ${field.field}
              and events.followup_value = ${pseudonym}
            limit ${remaining}
          )
          returning id
        `.execute(trx)
        updated += values.rows.length
      }
      return { updated, mismatched: false, skipped: false, fields }
    })
  }

  /**
   * GDPR erasure, step 2 (after the ledger row is committed): organization by organization,
   * replaces the user's pseudonym with the replacement — as actor and as a value of any field,
   * also of processes no longer registered — in bounded batches, each in its own transaction
   * holding only that organization's cursor row lock (so it waits for an in-flight commit of
   * that organization and never blocks the others). Every fenced commit that locks the cursor
   * after the ledger row was committed applies the ledger itself, so once a batch of an
   * organization comes back short nothing can re-introduce the old pseudonym there.
   * Organizations written under another key are returned in `mismatchedOrganizationIds`: their
   * rows cannot be matched until the key is back or a rebuild re-projects them through the
   * ledger.
   */
  async function replaceActorPseudonym(input: ActorErasureInput): Promise<ActorErasureResult> {
    const pseudonym = input.pseudonym
    if (!pseudonym) return { updated: 0, mismatchedOrganizationIds: [] }
    const batchSize = Math.max(1, Math.trunc(input.batchSize ?? ERASURE_BATCH_SIZE))
    const cursors = await db
      .selectFrom('insights_process_cursors')
      .select(['insights_process_cursors.id', 'insights_process_cursors.organization_id'])
      .where('insights_process_cursors.tenant_id', '=', input.tenantId)
      .orderBy('insights_process_cursors.organization_id')
      .execute()
    let updated = 0
    const mismatchedOrganizationIds: string[] = []
    for (const cursor of cursors) {
      let fields: ValueField[] | null = null
      for (;;) {
        const batch = await replacePseudonymBatch(input, pseudonym, { id: cursor.id, organizationId: cursor.organization_id }, fields, batchSize)
        if (batch.mismatched) mismatchedOrganizationIds.push(cursor.organization_id)
        updated += batch.updated
        fields = batch.fields
        if (batch.skipped || batch.updated < batchSize) break
      }
    }
    return { updated, mismatchedOrganizationIds }
  }

  return {
    now,
    readCursor,
    ensureCursor,
    acquireLease,
    releaseLease,
    commit,
    updateCursor,
    startScan,
    startScanIfIdle,
    touchScan,
    resumeStalledScan,
    finishScan,
    abandonScan,
    applyContractTransition,
    queueProcessRebuilds,
    noteOverlapTimeout,
    recordError,
    findKnownValues,
    countDistinctValues,
    clearProjectionBatch,
    pruneProjectionBatch,
    resetCursor,
    counts,
    listCursors,
    recordErasure,
    replaceActorPseudonym,
  }
}
