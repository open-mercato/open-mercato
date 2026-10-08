import { randomUUID } from 'node:crypto'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
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
import type { ProcessRegistrySnapshot } from '../process/registry'
import { capActivityValue, isReservedActivityValue, valueCapScope, type ValueCapState } from '../process/values'
import { isStatementTimeoutError } from './errors'
import { comparePseudonymKeys, type ActorPseudonymizer } from './pseudonym'
import {
  MAX_LOG_ID,
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
import type { ProjectionScope } from './types'
import type { ProcessScanKind } from '../../data/entities'

const DAY_MS = 24 * 60 * 60_000

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
export const XRAY_RECONCILE_INTERVAL_MS = DAY_MS
export const XRAY_RECONCILE_WINDOW_MS = 2 * DAY_MS
export const XRAY_FULL_RECONCILE_INTERVAL_MS = 7 * DAY_MS
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
  | 'rebuild_required'
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
  undecryptable: number
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

type SliceTotals = Pick<XraySliceResult, 'pages' | 'rows' | 'inserted' | 'voided' | 'casesRecomputed' | 'pruned' | 'undecryptable'>

function emptyTotals(): SliceTotals {
  return { pages: 0, rows: 0, inserted: 0, voided: 0, casesRecomputed: 0, pruned: 0, undecryptable: 0 }
}

function result(status: XraySliceStatus, totals: SliceTotals, extra: Partial<XraySliceResult> = {}): XraySliceResult {
  return { status, ...totals, scanStarted: null, scanResumed: null, scanProgress: null, ...extra }
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
  const derived: Array<{ base: DerivedEventBase; activities: DerivedActivity[] }> = []
  for (const entry of entries) {
    if (entry.organizationId && entry.organizationId !== scope.organizationId) continue
    const derivation = deriveLogActivities(entry, processes)
    if (derivation.kind === 'void') {
      const sources = voidsByLog.get(derivation.voidedByLogId) ?? new Set<string>()
      sources.add(derivation.sourceLogId)
      voidsByLog.set(derivation.voidedByLogId, sources)
      continue
    }
    if (derivation.kind === 'events') {
      derived.push({ base: derivation.base, activities: derivation.activities })
      if (derivation.base.voided) undoneSources.add(derivation.base.sourceLogId)
    }
  }
  const actorIds = Array.from(new Set(derived.map((item) => item.base.actorUserId).filter((id): id is string => Boolean(id))))
  const dimensions = actorIds.length > 0 ? await deps.resolveActorDimensions(actorIds) : new Map<string, ActorDimensions>()
  const scopesToLoad = new Map<string, { processKey: string; field: string }>()
  for (const item of derived) {
    for (const activity of item.activities) {
      if (!activity.followupField || activity.followupValue === null) continue
      const capScope = valueCapScope(activity.processKey, activity.followupField)
      if (!capState.has(capScope)) scopesToLoad.set(capScope, { processKey: activity.processKey, field: activity.followupField })
    }
  }
  for (const [capScope, target] of scopesToLoad) {
    const known = await deps.store.loadDistinctValues(scope, target.processKey, target.field, PROCESS_MAX_DISTINCT_VALUES_PER_FIELD + 1)
    capState.set(capScope, new Set(known.filter((value) => !isReservedActivityValue(value))))
  }
  const events: ProjectionEventInsert[] = []
  for (const item of derived) {
    const actor = item.base.actorUserId
    const actorDimensions = actor ? dimensions.get(actor) : undefined
    const pseudonym = actor ? deps.pseudonymizer.pseudonymize(actor) : null
    for (const activity of item.activities) {
      let value = activity.followupValue
      let userPseudonym: string | null = null
      let followupUserId: string | null = null
      if (value !== null && activity.valueKind === 'user' && isUuid(value)) {
        userPseudonym = deps.pseudonymizer.pseudonymize(value)
        followupUserId = userPseudonym ? value.toLowerCase() : null
        value = userPseudonym ?? PROCESS_OTHER_VALUE
      }
      if (value !== null && activity.followupField) {
        const capScope = valueCapScope(activity.processKey, activity.followupField)
        if (deps.redactedFields.has(capScope)) value = PROCESS_OTHER_VALUE
        value = capActivityValue(capState, capScope, value)
      }
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
        followupUserId: userPseudonym !== null && value === userPseudonym ? followupUserId : null,
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

async function commitPage(
  deps: XrayIngestDeps,
  lease: ProjectionLease,
  scope: ProjectionScope,
  page: ActionLogScanPage,
  capState: ValueCapState,
  advance: CursorAdvance,
  totals: SliceTotals,
): Promise<void> {
  const writes = await buildPageWrites(deps, scope, page.entries, capState)
  const outcome = await deps.store.commit(lease, XRAY_LEASE_MS, {
    events: writes.events,
    voids: writes.voids,
    advance,
    processes: deps.registry.processes,
  })
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
 * idempotency key. A statement timeout ends the pass: the nightly reconciliation covers it.
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
        if (isStatementTimeoutError(error)) return
        throw error
      }
      budget.pages += 1
      budget.bytes += page.payloadBytes
      totals.undecryptable += page.undecryptable
      if (page.entries.length > 0) await commitPage(deps, lease, scope, page, capState, { kind: 'none' }, totals)
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
      await commitPage(deps, lease, scope, page, capState, { kind: 'main', lastCreatedAt: position.createdAt, lastLogId: position.id }, totals)
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
  for (const table of ['insights_process_events', 'insights_process_cases', 'insights_process_rollups'] as const) {
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

type PreparedCursor = { cursor: ProjectionCursor } | { status: 'no_processes' | 'rebuild_required' }

function checkContract(deps: XrayIngestDeps, cursor: ProjectionCursor): 'rebuild_required' | 'mark_rebuild' | null {
  if (cursor.contractHash !== deps.registry.contractHash) return cursor.status === 'rebuild_required' ? 'rebuild_required' : 'mark_rebuild'
  return cursor.status === 'rebuild_required' ? 'rebuild_required' : null
}

async function prepareCursor(deps: XrayIngestDeps, scope: ProjectionScope): Promise<PreparedCursor> {
  if (!deps.registry.ready || deps.registry.processes.length === 0) return { status: 'no_processes' }
  const cursor = await deps.store.ensureCursor(scope, deps.registry.contractHash, XRAY_SETTLE_MS)
  const contract = checkContract(deps, cursor)
  if (contract === 'mark_rebuild') await deps.store.markRebuildRequired(cursor)
  if (contract) return { status: 'rebuild_required' }
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
): Promise<ProjectionCursor | 'rebuild_required' | 'key_mismatch'> {
  const cursor = await deps.store.readCursor(scope)
  if (!cursor || cursor.id !== lease.cursorId) throw new ProjectionLeaseLostError()
  if (checkContract(deps, cursor)) return 'rebuild_required'
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

/**
 * One bounded incremental ingest run for an organization: an overlap re-scan of the 15
 * minutes before the cursor (late-committed rows), the main pass up to `now - 60 s`, the
 * undo/redo state pass on `updated_at`, then — when due — retention pruning and the start of
 * a nightly 48 h or weekly full reconciliation scan (returned in `scanStarted`; the caller
 * enqueues it). A scan whose job chain showed no sign of life for 10 minutes is handed to a
 * new chain (`scanResumed`). Every write is fenced by the organization's lease; the lease is
 * released at the end.
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
    const cursor = await readLeasedCursor(deps, scope, lease)
    if (typeof cursor === 'string') return result(cursor, totals)
    const capState: ValueCapState = new Map()
    const dbNow = await deps.store.now()
    const until = shiftIso(dbNow, -XRAY_SETTLE_MS)
    await runOverlapPass(deps, lease, scope, cursor, capState, totals, clock)
    const budget = newBudget(clock)
    const mainCaughtUp = await runMainPass(deps, lease, scope, cursor, until, capState, budget, totals, clock)
    const stateCaughtUp = await runStatePass(deps, lease, scope, cursor, until, budget, totals, clock)
    let scanStarted: ScanStart | null = null
    if (mainCaughtUp && stateCaughtUp) {
      const pruneDue = !cursor.lastPrunedAt || Date.parse(dbNow) - Date.parse(cursor.lastPrunedAt) >= XRAY_PRUNE_INTERVAL_MS
      if (pruneDue) {
        const pruned = await runPrune(deps, lease, options.retentionDays, dbNow, budget, totals, clock)
        if (pruned) await deps.store.updateCursor(lease, XRAY_LEASE_MS, { last_pruned_at: new Date(Date.parse(dbNow)) })
      }
      const due = dueScan(cursor, dbNow, options.retentionDays)
      if (due) {
        const candidate: ScanStart = { scanId: randomUUID(), chainId: randomUUID(), kind: due.kind, from: due.from, until, progressJobId: null }
        if (await deps.store.startScanIfIdle(lease, XRAY_LEASE_MS, candidate)) scanStarted = candidate
      }
    }
    const stalled = !scanStarted && cursor.scanId
      && (!cursor.scanUpdatedAt || Date.parse(dbNow) - Date.parse(cursor.scanUpdatedAt) >= XRAY_SCAN_STALL_MS)
    const scanResumed = stalled ? await deps.store.resumeStalledScan(lease, XRAY_LEASE_MS, XRAY_SCAN_STALL_MS) : null
    return result(mainCaughtUp && stateCaughtUp ? 'caught_up' : 'budget_exhausted', totals, { scanStarted, scanResumed })
  } catch (error) {
    if (error instanceof ProjectionLeaseLostError) return result('lease_lost', totals)
    throw error
  } finally {
    await deps.store.releaseLease(lease)
  }
}

/**
 * One bounded slice of the organization's active range scan (backfill or reconciliation),
 * resumable from the persisted scan position. Only the scan's live job chain (`chainId`)
 * may advance it: a job of a replaced chain returns `stale_chain`, a job of a replaced scan
 * `superseded`. Returns `completed` when the scan reached its upper bound (the scan is then
 * cleared and the reconciliation timestamps updated) and `budget_exhausted` when another
 * slice must follow.
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
  try {
    const cursor = await readLeasedCursor(deps, scope, lease)
    if (typeof cursor === 'string') return result(cursor, totals)
    if (cursor.scanId !== scanId || !cursor.scanUntil || !cursor.scanKind) return result('superseded', totals)
    if (cursor.scanChainId !== chainId) return result('stale_chain', totals)
    const until = cursor.scanUntil
    const kind = cursor.scanKind
    let position: ActionLogScanCursor | null = cursor.scanAfterCreatedAt
      ? { createdAt: cursor.scanAfterCreatedAt, id: cursor.scanAfterLogId ?? MAX_LOG_ID }
      : null
    let processed = cursor.scanProcessedCount
    const snapshot = () => ({ position: position?.createdAt ?? null, from: cursor.scanFrom, until, processed })
    progress = snapshot()
    const budget = newBudget(clock)
    const capState: ValueCapState = new Map()
    const window: ScanWindow = { ms: XRAY_WINDOW_INITIAL_MS }
    while (budgetLeft(budget, clock)) {
      const { page, upper, final } = await scanWindowed(deps, scope, position, until, window, clock)
      budget.pages += 1
      budget.bytes += page.payloadBytes
      totals.undecryptable += page.undecryptable
      const covered = page.exhausted || !page.lastCursor
      const reached: ActionLogScanCursor = covered || !page.lastCursor ? { createdAt: upper, id: MAX_LOG_ID } : page.lastCursor
      await commitPage(deps, lease, scope, page, capState, {
        kind: 'scan',
        scanId,
        chainId,
        afterCreatedAt: reached.createdAt,
        afterLogId: reached.id,
        processedDelta: page.entries.length,
      }, totals)
      position = reached
      processed += page.entries.length
      progress = snapshot()
      if (covered && final) {
        const finished = await deps.store.finishScan(lease, XRAY_LEASE_MS, scanId, chainId, kind)
        return result(finished ? 'completed' : 'superseded', totals, { scanProgress: progress })
      }
    }
    return result('budget_exhausted', totals, { scanProgress: progress })
  } catch (error) {
    if (error instanceof ProjectionLeaseLostError) return result('lease_lost', totals, { scanProgress: progress })
    if (error instanceof ProjectionScanSupersededError) return result('superseded', totals, { scanProgress: progress })
    throw error
  } finally {
    await deps.store.releaseLease(lease)
  }
}
