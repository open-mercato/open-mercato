import { createHash, randomUUID } from 'node:crypto'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type {
  ActionLogScanCursor,
  ActionLogScanPage,
  ActionLogScanQuery,
  ActionLogStateChangePage,
  ActionLogStateChangeQuery,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import {
  PROCESS_MAX_DISTINCT_VALUES_PER_FIELD,
  PROCESS_OTHER_VALUE,
} from '@open-mercato/shared/modules/insights/process'
import {
  deriveLogActivities,
  type DerivedActivity,
  type DerivedEventBase,
  type ProcessSourceEntry,
} from '../process/activities'
import { compareCodeUnits, restrictProcessRegistry, type ProcessRegistrySnapshot, type RegisteredProcess } from '../process/registry'
import { capActivityValue, isReservedActivityValue, valueCapScope, type ValueCapState } from '../process/values'
import { isStatementTimeoutError } from './errors'
import { comparePseudonymKeys, type ActorPseudonymizer } from './pseudonym'
import {
  MAX_LOG_ID,
  XRAY_FULL_RECONCILE_INTERVAL_MS,
  XRAY_RECONCILE_INTERVAL_MS,
  ProjectionLeaseLostError,
  ProjectionScanSupersededError,
  type CursorAdvance,
  type ProjectionCursor,
  type ProjectionEventInsert,
  type ProjectionLease,
  type ProjectionStore,
  type ProjectionVoid,
  type ScanResume,
  type ScanStart,
} from './store'
import type { ProcessContractChange, ProjectionScope } from './types'
import type { ProcessScanKind } from '../../data/entities'

const DAY_MS = 24 * 60 * 60_000

const logger = createLogger('insights').child({ component: 'xray-ingest' })

const PROJECTION_TABLES = ['insights_process_events', 'insights_process_cases', 'insights_process_rollups'] as const

export const XRAY_SETTLE_MS = 60_000
export const XRAY_LEASE_MS = 120_000
export const XRAY_PAGE_LIMIT = 200
export const XRAY_PAGE_MAX_BYTES = 8 * 1024 * 1024
export const XRAY_SLICE_MAX_PAGES = 25
export const XRAY_SLICE_MAX_BYTES = 64 * 1024 * 1024
export const XRAY_SLICE_MAX_MS = 20_000
export const XRAY_OVERLAP_MS = 15 * 60_000
export const XRAY_OVERLAP_STEP_MS = 3 * 60_000
export const XRAY_OVERLAP_MAX_PAGES = 10
export const XRAY_OVERLAP_MAX_BYTES = 16 * 1024 * 1024
export const XRAY_OVERLAP_MAX_MS = 5_000
export const XRAY_STATE_OVERLAP_MAX_PAGES = 5
export const XRAY_WINDOW_INITIAL_MS = 60 * 60_000
export const XRAY_WINDOW_MIN_MS = 1_000
export const XRAY_WINDOW_MAX_MS = 7 * DAY_MS
export const XRAY_WINDOW_FAST_PROBE_MS = 1_000
export { XRAY_FULL_RECONCILE_INTERVAL_MS, XRAY_RECONCILE_INTERVAL_MS }
export const XRAY_RECONCILE_WINDOW_MS = 2 * DAY_MS
export const XRAY_PRUNE_INTERVAL_MS = DAY_MS
export const XRAY_PRUNE_BATCH = 5000
export const XRAY_SCAN_STALL_MS = 10 * 60_000

export const XRAY_KEY_MISMATCH_ERROR =
  '[internal] Process X-Ray pseudonyms of this organization were written under another key; ingest is paused until the key is back or `mercato insights xray:rebuild` re-projects the organization'

export type XrayLogSource = {
  scanDecrypted: (query: ActionLogScanQuery) => Promise<ActionLogScanPage>
  scanStateChanges: (query: ActionLogStateChangeQuery) => Promise<ActionLogStateChangePage>
}

export type ActorDimensions = { roleIds: string[] | null; teamId: string | null }

export type XrayIngestDeps = {
  store: ProjectionStore
  logSource: XrayLogSource
  registry: ProcessRegistrySnapshot
  pseudonymizer: ActorPseudonymizer
  resolveActorDimensions: (userIds: string[]) => Promise<Map<string, ActorDimensions>>
  redactedFields: ReadonlySet<string>
  owner: string
  clock?: () => number
}

export type XraySliceStatus =
  | 'no_processes'
  | 'key_mismatch'
  | 'lease_busy'
  | 'lease_lost'
  | 'superseded'
  | 'stale_chain'
  | 'caught_up'
  | 'budget_exhausted'
  | 'completed'

export type XraySliceResult = {
  status: XraySliceStatus
  pages: number
  rows: number
  inserted: number
  voided: number
  casesRecomputed: number
  pruned: number
  /** Rows skipped as undecryptable in every read of the slice (re-reads included). */
  undecryptable: number
  /** Whether the overlap re-read ended on its statement timeout (counted on the cursor). */
  overlapTimedOut: boolean
  /** The process contract transition this slice applied, if any. */
  contractChange: ProcessContractChange | null
  scanStarted: ScanStart | null
  scanResumed: ScanResume | null
  scanProgress: { position: string | null; from: string | null; until: string | null; processed: number } | null
}

type SliceBudget = {
  pages: number
  bytes: number
  startedAt: number
}

type BudgetLimits = { pages: number; bytes: number; ms: number }

const SLICE_LIMITS: BudgetLimits = { pages: XRAY_SLICE_MAX_PAGES, bytes: XRAY_SLICE_MAX_BYTES, ms: XRAY_SLICE_MAX_MS }

const OVERLAP_LIMITS: BudgetLimits = { pages: XRAY_OVERLAP_MAX_PAGES, bytes: XRAY_OVERLAP_MAX_BYTES, ms: XRAY_OVERLAP_MAX_MS }

type ScanWindow = { ms: number }

type SliceTotals = Pick<XraySliceResult, 'pages' | 'rows' | 'inserted' | 'voided' | 'casesRecomputed' | 'pruned' | 'undecryptable' | 'overlapTimedOut' | 'contractChange'> & {
  /** Rows the main pass skipped as undecryptable (each row is read once by it), added to the cursor counter. */
  undecryptableCounted: number
}

function emptyTotals(): SliceTotals {
  return { pages: 0, rows: 0, inserted: 0, voided: 0, casesRecomputed: 0, pruned: 0, undecryptable: 0, undecryptableCounted: 0, overlapTimedOut: false, contractChange: null }
}

function result(status: XraySliceStatus, totals: SliceTotals, extra: Partial<XraySliceResult> = {}): XraySliceResult {
  const { undecryptableCounted: _counted, ...reported } = totals
  return { status, ...reported, scanStarted: null, scanResumed: null, scanProgress: null, ...extra }
}

function newBudget(clock: () => number): SliceBudget {
  return { pages: 0, bytes: 0, startedAt: clock() }
}

function budgetLeft(budget: SliceBudget, clock: () => number, limits: BudgetLimits = SLICE_LIMITS): boolean {
  return budget.pages < limits.pages && budget.bytes < limits.bytes && clock() - budget.startedAt < limits.ms
}

/** Shifts an ISO-8601 UTC timestamp by whole milliseconds, keeping its sub-millisecond digits. */
export function shiftIso(value: string, deltaMs: number): string {
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) throw new TypeError('[internal] Invalid X-Ray timestamp')
  const shifted = new Date(parsed + Math.trunc(deltaMs)).toISOString()
  const micros = /\.\d{3}(\d{1,3})Z$/.exec(value)
  return micros ? shifted.replace(/Z$/, `${micros[1].padEnd(3, '0')}Z`) : shifted
}

function isoMicros(value: string): number {
  const micros = /\.\d{3}(\d{1,3})Z$/.exec(value)
  return Date.parse(value) * 1000 + (micros ? Number.parseInt(micros[1].padEnd(3, '0'), 10) : 0)
}

/** Compares two ISO-8601 UTC timestamps at microsecond precision. */
export function compareIso(left: string, right: string): number {
  const leftAt = isoMicros(left)
  const rightAt = isoMicros(right)
  return leftAt === rightAt ? 0 : leftAt < rightAt ? -1 : 1
}

function earlierIso(left: string, right: string): string {
  return compareIso(left, right) <= 0 ? left : right
}

function compareCursor(left: ActionLogScanCursor, right: ActionLogScanCursor): number {
  const byTime = compareIso(left.createdAt, right.createdAt)
  if (byTime !== 0) return byTime
  if (left.id === right.id) return 0
  return left.id < right.id ? -1 : 1
}

type PreparedActivity = {
  activity: DerivedActivity
  value: string | null
  userPseudonym: string | null
  followupUserId: string | null
  capScope: string | null
}

/**
 * Seeds the cardinality cap for the incoming values: the values not yet known are looked up
 * (one point lookup each); the stored distinct values of a field are counted only when one of
 * its incoming values is not stored yet, once per field and run.
 */
async function loadCapState(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  prepared: readonly PreparedActivity[],
  capState: ValueCapState,
): Promise<void> {
  const incoming = new Map<string, { processKey: string; field: string; values: Set<string> }>()
  for (const item of prepared) {
    if (!item.capScope || item.value === null || isReservedActivityValue(item.value) || !item.activity.followupField) continue
    if (capState.get(item.capScope)?.known.has(item.value)) continue
    const target = incoming.get(item.capScope) ?? { processKey: item.activity.processKey, field: item.activity.followupField, values: new Set<string>() }
    target.values.add(item.value)
    incoming.set(item.capScope, target)
  }
  for (const [capScope, target] of incoming) {
    const entry = capState.get(capScope) ?? { known: new Set<string>(), distinct: null }
    capState.set(capScope, entry)
    const candidates = Array.from(target.values)
    for (const value of await deps.store.findKnownValues(scope, target.processKey, target.field, candidates)) entry.known.add(value)
    const unseen = candidates.some((value) => !entry.known.has(value))
    if (unseen && entry.distinct === null) {
      entry.distinct = await deps.store.countDistinctValues(scope, target.processKey, target.field, PROCESS_MAX_DISTINCT_VALUES_PER_FIELD + 1)
    }
  }
}

/**
 * Turns one page of audit rows into projection writes: derives activities, applies the
 * per-tenant redaction and the value cardinality cap, pseudonymizes actors and `user`
 * values and resolves actor dimensions in one batch. Without a pseudonym key a `user` value
 * becomes `other` and the actor is not recorded. A row found undone or redone also voids the
 * events it projected earlier, so a re-scan converges even when the undo row itself is not
 * scanned. Rows of other organizations are ignored (defensive).
 */
export async function buildPageWrites(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  entries: readonly ProcessSourceEntry[],
  capState: ValueCapState,
): Promise<{ events: ProjectionEventInsert[]; voids: ProjectionVoid[] }> {
  const processes = deps.registry.processes
  const voidsByLog = new Map<string, Set<string>>()
  const undoneSources = new Set<string>()
  const derived: Array<{ base: DerivedEventBase; activities: PreparedActivity[] }> = []
  for (const entry of entries) {
    if (entry.organizationId && entry.organizationId !== scope.organizationId) continue
    const derivation = deriveLogActivities(entry, processes)
    if (derivation.kind === 'void') {
      const sources = voidsByLog.get(derivation.voidedByLogId) ?? new Set<string>()
      sources.add(derivation.sourceLogId)
      voidsByLog.set(derivation.voidedByLogId, sources)
      continue
    }
    if (derivation.kind !== 'events') continue
    const activities = derivation.activities.map((activity): PreparedActivity => {
      let value = activity.followupValue
      let userPseudonym: string | null = null
      let followupUserId: string | null = null
      if (value !== null && activity.valueKind === 'user' && isUuid(value)) {
        userPseudonym = deps.pseudonymizer.pseudonymize(value)
        followupUserId = userPseudonym ? value.toLowerCase() : null
        value = userPseudonym ?? PROCESS_OTHER_VALUE
      }
      const capScope = value !== null && activity.followupField ? valueCapScope(activity.processKey, activity.followupField) : null
      if (capScope && deps.redactedFields.has(capScope)) value = PROCESS_OTHER_VALUE
      return { activity, value, userPseudonym, followupUserId, capScope }
    })
    derived.push({ base: derivation.base, activities })
    if (derivation.base.voided) undoneSources.add(derivation.base.sourceLogId)
  }
  const actorIds = Array.from(new Set(derived.map((item) => item.base.actorUserId).filter((id): id is string => Boolean(id))))
  const dimensions = actorIds.length > 0 ? await deps.resolveActorDimensions(actorIds) : new Map<string, ActorDimensions>()
  await loadCapState(deps, scope, derived.flatMap((item) => item.activities), capState)
  const events: ProjectionEventInsert[] = []
  for (const item of derived) {
    const actor = item.base.actorUserId
    const actorDimensions = actor ? dimensions.get(actor) : undefined
    const pseudonym = actor ? deps.pseudonymizer.pseudonymize(actor) : null
    for (const prepared of item.activities) {
      const activity = prepared.activity
      const value = prepared.value !== null && prepared.capScope ? capActivityValue(capState, prepared.capScope, prepared.value) : prepared.value
      events.push({
        processKey: activity.processKey,
        caseKind: activity.caseKind,
        caseId: activity.caseId,
        activityKey: activity.keyIncludesValue && value !== null ? `${activity.keyPrefix}${value}` : activity.activityKey,
        activityKind: activity.activityKind,
        occurredAt: item.base.occurredAt,
        sourceLogId: item.base.sourceLogId,
        seq: activity.seq,
        actorUserId: pseudonym ? actor : null,
        actorPseudonym: pseudonym,
        actorRoleIds: actorDimensions?.roleIds ?? null,
        actorTeamId: actorDimensions?.teamId ?? null,
        causeKind: item.base.causeKind,
        causeId: item.base.causeId,
        viaSyncRun: item.base.viaSyncRun,
        followupField: activity.followupField,
        followupUserId: prepared.userPseudonym !== null && value === prepared.userPseudonym ? prepared.followupUserId : null,
        followupValue: value,
        voided: item.base.voided,
        voidedByLogId: null,
      })
    }
  }
  const voids: ProjectionVoid[] = Array.from(voidsByLog.entries()).map(([voidedByLogId, sources]) => ({
    voidedByLogId,
    sourceLogIds: Array.from(sources),
  }))
  if (undoneSources.size > 0) voids.push({ voidedByLogId: null, sourceLogIds: Array.from(undoneSources) })
  return { events, voids }
}

type PageCommitOptions = {
  /** Count the page's undecryptable rows on the cursor (main pass: the only read that sees each row once). */
  countUndecryptable: boolean
  /** Processes whose touched cases are recomputed (the whole registry, also in a rebuild scan). */
  recompute?: readonly RegisteredProcess[]
}

async function commitPage(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  scope: ProjectionScope,
  page: ActionLogScanPage,
  capState: ValueCapState,
  advance: CursorAdvance,
  totals: SliceTotals,
  options: PageCommitOptions,
): Promise<void> {
  const writes = await buildPageWrites(deps, scope, page.entries, capState)
  const undecryptable = options.countUndecryptable ? page.undecryptable : 0
  const outcome = await deps.store.commit(lease, XRAY_LEASE_MS, {
    events: writes.events,
    voids: writes.voids,
    advance,
    processes: options.recompute ?? deps.registry.processes,
    undecryptable,
  })
  totals.undecryptableCounted += undecryptable
  totals.pages += 1
  totals.rows += page.entries.length
  totals.inserted += outcome.inserted
  totals.voided += outcome.voided
  totals.casesRecomputed += outcome.casesRecomputed
}

function scanQuery(
  scope: ProjectionScope,
  registry: ProcessRegistrySnapshot,
  after: ActionLogScanCursor | null,
  until: string,
): ActionLogScanQuery {
  return {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    after,
    until,
    limit: XRAY_PAGE_LIMIT,
    maxBytes: XRAY_PAGE_MAX_BYTES,
    resourceKinds: registry.logResourceKinds,
  }
}

/**
 * Reads the next page after `after`, bounded by a time window ending at most at `target`.
 * The window bounds how many audit rows of the tenant one probe may walk (other
 * organizations and resource kinds share the `(tenant_id, created_at)` index range), so a
 * sparse range never runs into the statement timeout: a timed-out probe halves the window
 * and retries, a fast probe that covered its window doubles it.
 */
async function scanWindowed(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  after: ActionLogScanCursor | null,
  target: string,
  window: ScanWindow,
  clock: () => number,
): Promise<{ page: ActionLogScanPage; upper: string; final: boolean }> {
  for (;;) {
    const bounded = after ? earlierIso(target, shiftIso(after.createdAt, window.ms)) : target
    const final = compareIso(bounded, target) === 0
    const startedAt = clock()
    try {
      const page = await deps.logSource.scanDecrypted(scanQuery(scope, deps.registry, after, bounded))
      if (page.exhausted && !final && clock() - startedAt < XRAY_WINDOW_FAST_PROBE_MS) {
        window.ms = Math.min(XRAY_WINDOW_MAX_MS, window.ms * 2)
      }
      return { page, upper: bounded, final }
    } catch (error) {
      if (!isStatementTimeoutError(error) || !after || window.ms <= XRAY_WINDOW_MIN_MS) throw error
      window.ms = Math.max(XRAY_WINDOW_MIN_MS, Math.floor(window.ms / 2))
    }
  }
}

/**
 * Re-reads the 15 minutes before the main cursor for rows that committed late (a writer
 * whose transaction outlived the settle lag), newest minutes first, under its own small
 * budget so it never starves the main pass. Rows already projected are skipped by the
 * idempotency key. A statement timeout ends the pass (the nightly reconciliation covers it):
 * it is logged and counted on the cursor (`overlap_timeouts`, shown in the status).
 */
async function runOverlapPass(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  scope: ProjectionScope,
  cursor: ProjectionCursor,
  capState: ValueCapState,
  totals: SliceTotals,
  clock: () => number,
): Promise<void> {
  if (!cursor.lastCreatedAt) return
  const budget = newBudget(clock)
  for (let offset = 0; offset < XRAY_OVERLAP_MS; offset += XRAY_OVERLAP_STEP_MS) {
    const upper = shiftIso(cursor.lastCreatedAt, -offset)
    let after: ActionLogScanCursor | null = { createdAt: shiftIso(cursor.lastCreatedAt, -(offset + XRAY_OVERLAP_STEP_MS)), id: MAX_LOG_ID }
    while (after && budgetLeft(budget, clock, OVERLAP_LIMITS)) {
      let page: ActionLogScanPage
      try {
        page = await deps.logSource.scanDecrypted(scanQuery(scope, deps.registry, after, upper))
      } catch (error) {
        if (!isStatementTimeoutError(error)) throw error
        logger.warn('[internal] X-Ray overlap re-read hit the statement timeout; the nightly reconciliation covers its range', {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        await deps.store.noteOverlapTimeout(lease, XRAY_LEASE_MS)
        totals.overlapTimedOut = true
        return
      }
      budget.pages += 1
      budget.bytes += page.payloadBytes
      totals.undecryptable += page.undecryptable
      if (page.entries.length > 0) await commitPage(deps, lease, scope, page, capState, { kind: 'none' }, totals, { countUndecryptable: false })
      after = page.exhausted ? null : page.lastCursor
    }
    if (!budgetLeft(budget, clock, OVERLAP_LIMITS)) return
  }
}

async function runMainPass(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  scope: ProjectionScope,
  cursor: ProjectionCursor,
  until: string,
  capState: ValueCapState,
  budget: SliceBudget,
  totals: SliceTotals,
  clock: () => number,
): Promise<boolean> {
  let after: ActionLogScanCursor | null = cursor.lastCreatedAt
    ? { createdAt: cursor.lastCreatedAt, id: cursor.lastLogId ?? MAX_LOG_ID }
    : null
  if (after && compareIso(after.createdAt, until) > 0) return true
  const window: ScanWindow = { ms: XRAY_WINDOW_INITIAL_MS }
  while (budgetLeft(budget, clock)) {
    const { page, upper, final } = await scanWindowed(deps, scope, after, until, window, clock)
    budget.pages += 1
    budget.bytes += page.payloadBytes
    totals.undecryptable += page.undecryptable
    const covered = page.exhausted || !page.lastCursor
    const reached: ActionLogScanCursor = covered || !page.lastCursor ? { createdAt: upper, id: MAX_LOG_ID } : page.lastCursor
    const position = after && compareCursor(reached, after) < 0 ? after : reached
    if (page.entries.length > 0 || !after || compareCursor(position, after) !== 0) {
      await commitPage(deps, lease, scope, page, capState, { kind: 'main', lastCreatedAt: position.createdAt, lastLogId: position.id }, totals, { countUndecryptable: true })
    }
    if (covered && final) return true
    after = position
  }
  return false
}

async function runStatePass(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  scope: ProjectionScope,
  cursor: ProjectionCursor,
  until: string,
  budget: SliceBudget,
  totals: SliceTotals,
  clock: () => number,
): Promise<boolean> {
  const watermark = cursor.stateWatermark
  const overlapStart = watermark ? { updatedAt: shiftIso(watermark, -XRAY_OVERLAP_MS), id: MAX_LOG_ID } : null
  const passes: Array<{ after: { updatedAt: string; id: string } | null; upper: string; advance: boolean; maxPages: number }> = [
    ...(watermark && overlapStart ? [{ after: overlapStart, upper: earlierIso(watermark, until), advance: false, maxPages: XRAY_STATE_OVERLAP_MAX_PAGES }] : []),
    { after: watermark ? { updatedAt: watermark, id: cursor.stateLastLogId ?? MAX_LOG_ID } : null, upper: until, advance: true, maxPages: XRAY_SLICE_MAX_PAGES },
  ]
  let caughtUp = true
  for (const pass of passes) {
    if (pass.after && compareIso(pass.after.updatedAt, pass.upper) > 0) continue
    let after = pass.after
    let pages = 0
    let finished = false
    while (pages < pass.maxPages && budgetLeft(budget, clock)) {
      const page = await deps.logSource.scanStateChanges({
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        after,
        until: pass.upper,
        limit: XRAY_PAGE_LIMIT,
        resourceKinds: deps.registry.logResourceKinds,
      })
      budget.pages += 1
      pages += 1
      const reached = page.exhausted || !page.lastCursor ? { updatedAt: pass.upper, id: MAX_LOG_ID } : page.lastCursor
      const advance: CursorAdvance = pass.advance
        ? { kind: 'state', stateWatermark: reached.updatedAt, stateLastLogId: reached.id }
        : { kind: 'none' }
      if (page.entries.length > 0 || (pass.advance && page.exhausted)) {
        const outcome = await deps.store.commit(lease, XRAY_LEASE_MS, {
          events: [],
          voids: page.entries.length > 0 ? [{ sourceLogIds: page.entries.map((entry) => entry.logId), voidedByLogId: null }] : [],
          advance,
          processes: deps.registry.processes,
        })
        totals.voided += outcome.voided
        totals.casesRecomputed += outcome.casesRecomputed
      }
      if (page.exhausted || !page.lastCursor) {
        finished = true
        break
      }
      after = page.lastCursor
    }
    if (pass.advance && !finished) caughtUp = false
  }
  return caughtUp
}

async function runPrune(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  retentionDays: number,
  dbNow: string,
  budget: SliceBudget,
  totals: SliceTotals,
  clock: () => number,
): Promise<boolean> {
  const cutoff = shiftIso(dbNow, -Math.max(1, retentionDays) * DAY_MS)
  for (const table of PROJECTION_TABLES) {
    while (budgetLeft(budget, clock)) {
      const removed = await deps.store.pruneProjectionBatch(lease, XRAY_LEASE_MS, table, cutoff, XRAY_PRUNE_BATCH)
      totals.pruned += removed
      if (removed < XRAY_PRUNE_BATCH) break
    }
    if (!budgetLeft(budget, clock)) return false
  }
  return true
}

function dueScan(cursor: ProjectionCursor, dbNow: string, retentionDays: number): { kind: ProcessScanKind; from: string } | null {
  if (cursor.scanId) return null
  const nowMs = Date.parse(dbNow)
  const retentionFrom = shiftIso(dbNow, -Math.max(1, retentionDays) * DAY_MS)
  const lastFull = cursor.lastFullReconciledAt ? Date.parse(cursor.lastFullReconciledAt) : 0
  if (nowMs - lastFull >= XRAY_FULL_RECONCILE_INTERVAL_MS) return { kind: 'full_reconcile', from: retentionFrom }
  const lastReconcile = cursor.lastReconciledAt ? Date.parse(cursor.lastReconciledAt) : 0
  if (nowMs - lastReconcile >= XRAY_RECONCILE_INTERVAL_MS) {
    const windowFrom = shiftIso(dbNow, -XRAY_RECONCILE_WINDOW_MS)
    return { kind: 'reconcile', from: compareIso(windowFrom, retentionFrom) > 0 ? windowFrom : retentionFrom }
  }
  return null
}

function hasOwn(record: Record<string, string>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

/**
 * The contract hash of each registered process for one organization: the process definition
 * hash and the fields of the process the tenant encrypts through its own encryption maps
 * (projected as `other`), so a change of either re-projects that process only.
 */
export function resolveContractHashes(registry: ProcessRegistrySnapshot, redactedFields: ReadonlySet<string>): Record<string, string> {
  const redacted = Array.from(redactedFields).sort(compareCodeUnits)
  const hashes: Record<string, string> = {}
  for (const [processKey, definitionHash] of registry.processContractHashes) {
    const prefix = valueCapScope(processKey, '')
    const fields = redacted.filter((capScope) => capScope.startsWith(prefix)).map((capScope) => capScope.slice(prefix.length))
    hashes[processKey] = createHash('sha256').update(JSON.stringify({ definition: definitionHash, redactedFields: fields })).digest('hex')
  }
  return hashes
}

type ContractOutcome = { cursor: ProjectionCursor; change: ProcessContractChange | null } | 'budget_exhausted'

/**
 * Brings the organization's projection to this worker's process contracts, under the lease.
 * A cursor without contracts adopts them (its projection is empty). A process whose contract
 * changed or that was added is queued for a full reconciliation limited to it (queued first,
 * so the status shows it while its rows go) and its events, cases and rollups are cleared (in
 * fenced batches, resumed by the next slice when the budget runs out); only then is its new
 * hash recorded. A removed process (module disabled) keeps its rows, which reads filter to
 * registered processes and retention prunes. Every transition is logged with its process keys
 * and recorded on the cursor.
 */
async function reconcileContracts(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  lease: ProjectionLease,
  cursor: ProjectionCursor,
  budget: SliceBudget,
  clock: () => number,
): Promise<ContractOutcome> {
  const expected = resolveContractHashes(deps.registry, deps.redactedFields)
  const stored = cursor.contractHashes
  if (stored === null) {
    const adopted = await deps.store.applyContractTransition(lease, XRAY_LEASE_MS, { hashes: expected, rebuild: [], change: null })
    return { cursor: adopted, change: null }
  }
  const expectedKeys = Object.keys(expected)
  const change: ProcessContractChange = {
    changed: expectedKeys.filter((processKey) => hasOwn(stored, processKey) && stored[processKey] !== expected[processKey]),
    added: expectedKeys.filter((processKey) => !hasOwn(stored, processKey)),
    removed: Object.keys(stored).filter((processKey) => !hasOwn(expected, processKey)).sort(compareCodeUnits),
  }
  if (change.changed.length + change.added.length + change.removed.length === 0) return { cursor, change: null }
  logger.warn('[internal] Process X-Ray contracts changed; rebuilding the changed and added processes', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    changed: change.changed,
    added: change.added,
    removed: change.removed,
  })
  const rebuild = [...change.changed, ...change.added]
  if (rebuild.length > 0) await deps.store.queueProcessRebuilds(lease, XRAY_LEASE_MS, rebuild)
  for (const processKey of rebuild) {
    for (const table of PROJECTION_TABLES) {
      for (;;) {
        if (!budgetLeft(budget, clock)) return 'budget_exhausted'
        const removedRows = await deps.store.clearProjectionBatch(lease, XRAY_LEASE_MS, table, XRAY_PRUNE_BATCH, processKey)
        budget.pages += 1
        if (removedRows < XRAY_PRUNE_BATCH) break
      }
    }
  }
  const next = await deps.store.applyContractTransition(lease, XRAY_LEASE_MS, { hashes: expected, rebuild, change })
  return { cursor: next, change }
}

type PreparedCursor = { cursor: ProjectionCursor } | { status: 'no_processes' }

async function prepareCursor(deps: XrayIngestDeps, scope: ProjectionScope): Promise<PreparedCursor> {
  if (!deps.registry.ready || deps.registry.processes.length === 0) return { status: 'no_processes' }
  const cursor = await deps.store.ensureCursor(scope, XRAY_SETTLE_MS)
  return { cursor }
}

/**
 * Re-reads the cursor once the lease is held (the authoritative positions: only the lease
 * holder moves them) and pins the pseudonym key: a cursor without rows under any key adopts
 * the current one, a cursor written under another key is refused.
 */
async function readLeasedCursor(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  lease: ProjectionLease,
): Promise<ProjectionCursor | 'key_mismatch'> {
  const cursor = await deps.store.readCursor(scope)
  if (!cursor || cursor.id !== lease.cursorId) throw new ProjectionLeaseLostError()
  const keys = comparePseudonymKeys(cursor.actorKeyFingerprint, deps.pseudonymizer.fingerprint)
  if (keys === 'mismatch') {
    if (cursor.lastError !== XRAY_KEY_MISMATCH_ERROR) await deps.store.updateCursor(lease, XRAY_LEASE_MS, { last_error: XRAY_KEY_MISMATCH_ERROR })
    return 'key_mismatch'
  }
  if (keys === 'adopt') {
    await deps.store.updateCursor(lease, XRAY_LEASE_MS, { actor_key_fingerprint: deps.pseudonymizer.fingerprint })
    return { ...cursor, actorKeyFingerprint: deps.pseudonymizer.fingerprint }
  }
  return cursor
}

function undecryptableMessage(rows: number): string {
  return `[internal] Process X-Ray skipped ${rows} audit row${rows === 1 ? '' : 's'} sealed under another key than the tenant key in use; their activities are missing from the projection`
}

/**
 * Reports audit rows skipped as undecryptable (counts only, never values): the rows the main
 * pass met (each once) or a backfill met in the history. Re-reads (overlap, reconciliations,
 * rebuild scans) are not reported again; the slice result still carries them. Runs whatever
 * the slice outcome, so rows the cursor already moved past are always reported.
 */
function reportUndecryptableRows(scope: ProjectionScope, rows: number, phase: 'ingest' | 'backfill'): void {
  if (rows <= 0) return
  logger.warn('[internal] X-Ray skipped audit rows whose encrypted columns could not be opened', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    rows,
    phase,
  })
  getTelemetryRuntime()?.reportError(new Error(undecryptableMessage(rows)), {
    module: 'insights',
    code: 'insights.xray_undecryptable_rows',
    attributes: { rows, phase },
  })
}

/** Shows skipped undecryptable rows in the status (`last_error`, counts only) until a later main advance clears it. */
async function recordUndecryptableRows(deps: XrayIngestDeps, lease: ProjectionLease, rows: number): Promise<void> {
  if (rows > 0) await deps.store.updateCursor(lease, XRAY_LEASE_MS, { last_error: undecryptableMessage(rows) })
}

/**
 * One bounded incremental ingest run for an organization: brings the projection to the
 * current per-process contracts (clearing and queueing changed or added processes), an
 * overlap re-scan of the 15 minutes before the cursor (late-committed rows), the main pass up
 * to `now - 60 s`, the undo/redo state pass on `updated_at`, the start of a per-process
 * rebuild scan when one is queued and no scan runs, then — when caught up — retention pruning
 * and the start of a due nightly 48 h or weekly full reconciliation scan (a started scan is
 * returned in `scanStarted`; the caller enqueues it). A scan whose job chain showed no sign of
 * life for 10 minutes is handed to a new chain (`scanResumed`). Every write is fenced by the
 * organization's lease; the lease is released at the end.
 */
export async function runIngestSlice(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  options: { retentionDays: number },
): Promise<XraySliceResult> {
  const clock = deps.clock ?? Date.now
  const totals = emptyTotals()
  const prepared = await prepareCursor(deps, scope)
  if ('status' in prepared) return result(prepared.status, totals)
  const lease = await deps.store.acquireLease(prepared.cursor, deps.owner, XRAY_LEASE_MS)
  if (!lease) return result('lease_busy', totals)
  try {
    const leased = await readLeasedCursor(deps, scope, lease)
    if (typeof leased === 'string') return result(leased, totals)
    const contracts = await reconcileContracts(deps, scope, lease, leased, newBudget(clock), clock)
    if (contracts === 'budget_exhausted') return result('budget_exhausted', totals)
    totals.contractChange = contracts.change
    const cursor = contracts.cursor
    const capState: ValueCapState = new Map()
    const dbNow = await deps.store.now()
    const until = shiftIso(dbNow, -XRAY_SETTLE_MS)
    const retentionFrom = shiftIso(dbNow, -Math.max(1, options.retentionDays) * DAY_MS)
    await runOverlapPass(deps, lease, scope, cursor, capState, totals, clock)
    const budget = newBudget(clock)
    const mainCaughtUp = await runMainPass(deps, lease, scope, cursor, until, capState, budget, totals, clock)
    const stateCaughtUp = await runStatePass(deps, lease, scope, cursor, until, budget, totals, clock)
    let scanStarted: ScanStart | null = null
    if (!cursor.scanId && cursor.pendingRebuildKeys.length > 0) {
      const rebuild: ScanStart = {
        scanId: randomUUID(),
        chainId: randomUUID(),
        kind: 'full_reconcile',
        from: cursor.coverageFrom && compareIso(cursor.coverageFrom, retentionFrom) > 0 ? cursor.coverageFrom : retentionFrom,
        until,
        progressJobId: null,
        processKeys: cursor.pendingRebuildKeys,
      }
      if (await deps.store.startScanIfIdle(lease, XRAY_LEASE_MS, rebuild)) scanStarted = rebuild
    }
    if (mainCaughtUp && stateCaughtUp) {
      const pruneDue = !cursor.lastPrunedAt || Date.parse(dbNow) - Date.parse(cursor.lastPrunedAt) >= XRAY_PRUNE_INTERVAL_MS
      if (pruneDue) {
        const pruned = await runPrune(deps, lease, options.retentionDays, dbNow, budget, totals, clock)
        if (pruned) await deps.store.updateCursor(lease, XRAY_LEASE_MS, { last_pruned_at: new Date(Date.parse(dbNow)) })
      }
      const due = scanStarted ? null : dueScan(cursor, dbNow, options.retentionDays)
      if (due) {
        const candidate: ScanStart = { scanId: randomUUID(), chainId: randomUUID(), kind: due.kind, from: due.from, until, progressJobId: null }
        if (await deps.store.startScanIfIdle(lease, XRAY_LEASE_MS, candidate)) scanStarted = candidate
      }
    }
    const stalled = !scanStarted && cursor.scanId
      && (!cursor.scanUpdatedAt || Date.parse(dbNow) - Date.parse(cursor.scanUpdatedAt) >= XRAY_SCAN_STALL_MS)
    const scanResumed = stalled ? await deps.store.resumeStalledScan(lease, XRAY_LEASE_MS, XRAY_SCAN_STALL_MS) : null
    await recordUndecryptableRows(deps, lease, totals.undecryptableCounted)
    return result(mainCaughtUp && stateCaughtUp ? 'caught_up' : 'budget_exhausted', totals, { scanStarted, scanResumed })
  } catch (error) {
    if (error instanceof ProjectionLeaseLostError) return result('lease_lost', totals)
    throw error
  } finally {
    reportUndecryptableRows(scope, totals.undecryptableCounted, 'ingest')
    await deps.store.releaseLease(lease)
  }
}

/**
 * One bounded slice of the organization's active range scan (backfill, reconciliation or a
 * per-process rebuild), resumable from the persisted scan position. The projection is first
 * brought to this worker's process contracts (as in `runIngestSlice`); a scan limited to some
 * processes reads and projects only those. Only the scan's live job chain (`chainId`) may
 * advance it: a job of a replaced chain returns `stale_chain`, a job of a replaced scan
 * `superseded`. Returns `completed` when the scan reached its upper bound (the scan is then
 * cleared and, for a scan of every process, the reconciliation timestamps updated) and
 * `budget_exhausted` when another slice must follow.
 */
export async function runScanSlice(
  deps: XrayIngestDeps,
  scope: ProjectionScope,
  scanId: string,
  chainId: string,
): Promise<XraySliceResult> {
  const clock = deps.clock ?? Date.now
  const totals = emptyTotals()
  const prepared = await prepareCursor(deps, scope)
  if ('status' in prepared) return result(prepared.status, totals)
  if (prepared.cursor.scanId !== scanId) return result('superseded', totals)
  if (prepared.cursor.scanChainId !== chainId) return result('stale_chain', totals)
  const lease = await deps.store.acquireLease(prepared.cursor, deps.owner, XRAY_LEASE_MS)
  if (!lease) return result('lease_busy', totals)
  let progress: XraySliceResult['scanProgress'] = null
  let backfill = false
  try {
    const leased = await readLeasedCursor(deps, scope, lease)
    if (typeof leased === 'string') return result(leased, totals)
    if (leased.scanId !== scanId || !leased.scanUntil || !leased.scanKind) return result('superseded', totals)
    if (leased.scanChainId !== chainId) return result('stale_chain', totals)
    const until = leased.scanUntil
    const scanKind = leased.scanKind
    backfill = scanKind === 'backfill'
    let position: ActionLogScanCursor | null = leased.scanAfterCreatedAt
      ? { createdAt: leased.scanAfterCreatedAt, id: leased.scanAfterLogId ?? MAX_LOG_ID }
      : null
    let processed = leased.scanProcessedCount
    const snapshot = () => ({ position: position?.createdAt ?? null, from: leased.scanFrom, until, processed })
    progress = snapshot()
    const budget = newBudget(clock)
    const contracts = await reconcileContracts(deps, scope, lease, leased, budget, clock)
    if (contracts === 'budget_exhausted') return result('budget_exhausted', totals, { scanProgress: progress })
    totals.contractChange = contracts.change
    const scanProcessKeys = contracts.cursor.scanProcessKeys
    const scanDeps: XrayIngestDeps = scanProcessKeys
      ? { ...deps, registry: restrictProcessRegistry(deps.registry, scanProcessKeys) }
      : deps
    if (scanDeps.registry.processes.length === 0) {
      const finished = await deps.store.finishScan(lease, XRAY_LEASE_MS, scanId, chainId, scanKind)
      return result(finished ? 'completed' : 'superseded', totals, { scanProgress: progress })
    }
    const capState: ValueCapState = new Map()
    const window: ScanWindow = { ms: XRAY_WINDOW_INITIAL_MS }
    while (budgetLeft(budget, clock)) {
      const { page, upper, final } = await scanWindowed(scanDeps, scope, position, until, window, clock)
      budget.pages += 1
      budget.bytes += page.payloadBytes
      totals.undecryptable += page.undecryptable
      const covered = page.exhausted || !page.lastCursor
      const reached: ActionLogScanCursor = covered || !page.lastCursor ? { createdAt: upper, id: MAX_LOG_ID } : page.lastCursor
      await commitPage(scanDeps, lease, scope, page, capState, {
        kind: 'scan',
        scanId,
        chainId,
        afterCreatedAt: reached.createdAt,
        afterLogId: reached.id,
        processedDelta: page.entries.length,
      }, totals, { countUndecryptable: false, recompute: deps.registry.processes })
      position = reached
      processed += page.entries.length
      progress = snapshot()
      if (covered && final) {
        const finished = await deps.store.finishScan(lease, XRAY_LEASE_MS, scanId, chainId, scanKind)
        if (finished && scanKind === 'backfill') await recordUndecryptableRows(deps, lease, totals.undecryptable)
        return result(finished ? 'completed' : 'superseded', totals, { scanProgress: progress })
      }
    }
    if (scanKind === 'backfill') await recordUndecryptableRows(deps, lease, totals.undecryptable)
    return result('budget_exhausted', totals, { scanProgress: progress })
  } catch (error) {
    if (error instanceof ProjectionLeaseLostError) return result('lease_lost', totals, { scanProgress: progress })
    if (error instanceof ProjectionScanSupersededError) return result('superseded', totals, { scanProgress: progress })
    throw error
  } finally {
    if (backfill) reportUndecryptableRows(scope, totals.undecryptable, 'backfill')
    await deps.store.releaseLease(lease)
  }
}
