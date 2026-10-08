import type {
  ActionLogFieldHistoryEntry,
  ActionLogScanPage,
  ActionLogScanQuery,
  ActionLogStateChangePage,
  ActionLogStateChangeQuery,
} from '@open-mercato/core/modules/audit_logs/lib/fieldHistory'
import { buildCaseAggregate, summarizeCase, CASE_EVENT_LIMIT, type CaseEventRow, type CaseSummary } from '../../process/caseSummary'
import type { RegisteredProcess } from '../../process/registry'
import {
  MAX_LOG_ID,
  ProjectionLeaseLostError,
  ProjectionScanSupersededError,
  type CursorAdvance,
  type ProjectionCommit,
  type ProjectionCommitResult,
  type ProjectionCursor,
  type ProjectionEventInsert,
  type ProjectionLease,
  type ProjectionStore,
  type ScanResume,
  type ScanStart,
} from '../store'
import { ERASED_PSEUDONYM_PREFIX, NO_PSEUDONYM_KEY_FINGERPRINT } from '../pseudonym'
import type { ProjectionScope } from '../types'

export type MemoryEvent = Omit<ProjectionEventInsert, 'actorUserId' | 'followupUserId'> & { tenantId: string; organizationId: string }

export type MemoryCase = CaseSummary & { tenantId: string; organizationId: string; processKey: string; caseId: string }

export type MemoryLogRow = Omit<ActionLogFieldHistoryEntry, 'cursorAt'> & {
  tenantId: string
  createdAt: string
  updatedAt: string
  payloadBytes?: number
}

function compareKey(leftAt: string, leftId: string, rightAt: string, rightId: string): number {
  const leftMs = Date.parse(leftAt)
  const rightMs = Date.parse(rightAt)
  if (leftMs !== rightMs) return leftMs < rightMs ? -1 : 1
  if (leftAt !== rightAt) return leftAt < rightAt ? -1 : 1
  if (leftId === rightId) return 0
  return leftId < rightId ? -1 : 1
}

export function microIso(date: Date): string {
  return date.toISOString().replace(/Z$/, '000Z')
}

export type MemoryLogSourceOptions = {
  /** Simulates a PostgreSQL statement timeout (SQLSTATE 57014) for matching queries. */
  timeoutWhen?: (query: ActionLogScanQuery) => boolean
  /** Log ids reported as undecryptable (left out of `entries`). */
  undecryptableIds?: ReadonlySet<string>
}

export class MemoryStatementTimeoutError extends Error {
  readonly code = '57014'
  constructor() {
    super('canceling statement due to statement timeout')
    this.name = 'DatabaseError'
  }
}

export function createMemoryLogSource(rows: MemoryLogRow[], options: MemoryLogSourceOptions = {}) {
  const scanCalls: ActionLogScanQuery[] = []
  const stateCalls: ActionLogStateChangeQuery[] = []
  async function scanDecrypted(query: ActionLogScanQuery): Promise<ActionLogScanPage> {
    scanCalls.push(query)
    if (options.timeoutWhen?.(query)) throw new MemoryStatementTimeoutError()
    const kinds = query.resourceKinds ?? null
    const matching = rows
      .filter((row) => row.tenantId === query.tenantId && row.organizationId === query.organizationId)
      .filter((row) => !kinds || (row.resourceKind !== null && kinds.includes(row.resourceKind)))
      .filter((row) => compareKey(row.createdAt, row.logId, query.until, MAX_LOG_ID) <= 0 && Date.parse(row.createdAt) <= Date.parse(query.until))
      .filter((row) => !query.after || compareKey(row.createdAt, row.logId, query.after.createdAt, query.after.id) > 0)
      .sort((left, right) => compareKey(left.createdAt, left.logId, right.createdAt, right.logId))
    const page = matching.slice(0, query.limit)
    const decryptable = page.filter((row) => !options.undecryptableIds?.has(row.logId))
    const entries: ActionLogFieldHistoryEntry[] = decryptable.map((row) => ({ ...row, cursorAt: row.createdAt }))
    const last = page.at(-1)
    return {
      entries,
      lastCursor: last ? { createdAt: last.createdAt, id: last.logId } : null,
      exhausted: matching.length <= query.limit,
      payloadBytes: page.reduce((sum, row) => sum + (row.payloadBytes ?? 100), 0),
      undecryptable: page.length - decryptable.length,
    }
  }
  async function scanStateChanges(query: ActionLogStateChangeQuery): Promise<ActionLogStateChangePage> {
    stateCalls.push(query)
    const kinds = query.resourceKinds ?? null
    const matching = rows
      .filter((row) => row.tenantId === query.tenantId && row.organizationId === query.organizationId)
      .filter((row) => row.executionState === 'undone' || row.executionState === 'redone')
      .filter((row) => !kinds || (row.resourceKind !== null && kinds.includes(row.resourceKind)))
      .filter((row) => Date.parse(row.updatedAt) <= Date.parse(query.until))
      .filter((row) => !query.after || compareKey(row.updatedAt, row.logId, query.after.updatedAt, query.after.id) > 0)
      .sort((left, right) => compareKey(left.updatedAt, left.logId, right.updatedAt, right.logId))
    const page = matching.slice(0, query.limit)
    const entries = page.map((row) => ({
      logId: row.logId,
      executionState: row.executionState === 'redone' ? 'redone' as const : 'undone' as const,
      resourceKind: row.resourceKind,
      cursor: { updatedAt: row.updatedAt, id: row.logId },
    }))
    const last = entries.at(-1)
    return { entries, lastCursor: last ? last.cursor : null, exhausted: matching.length <= query.limit }
  }
  return { scanDecrypted, scanStateChanges, scanCalls, stateCalls }
}

type MemoryState = {
  clock: { now: string }
  cursors: ProjectionCursor[]
  events: MemoryEvent[]
  cases: MemoryCase[]
  erasures: Map<string, string>
  commits: number
}

function caseEventRow(event: MemoryEvent): CaseEventRow {
  return {
    activityKey: event.activityKey,
    activityKind: event.activityKind,
    occurredAt: event.occurredAt,
    sourceLogId: event.sourceLogId,
    seq: event.seq,
    actorPseudonym: event.actorPseudonym,
    causeKind: event.causeKind,
    viaSyncRun: event.viaSyncRun,
    followupField: event.followupField,
    followupValue: event.followupValue,
  }
}

const SCAN_CLEARED = {
  scanId: null,
  scanKind: null,
  scanFrom: null,
  scanUntil: null,
  scanAfterCreatedAt: null,
  scanAfterLogId: null,
  scanProgressJobId: null,
  scanChainId: null,
} as const

export function createMemoryStore(initialNow: string) {
  const state: MemoryState = { clock: { now: initialNow }, cursors: [], events: [], cases: [], erasures: new Map(), commits: 0 }
  let cursorSequence = 0
  let chainSequence = 0

  const cursorFor = (scope: ProjectionScope) => state.cursors.find((cursor) => cursor.tenantId === scope.tenantId && cursor.organizationId === scope.organizationId) ?? null
  const shift = (value: string, deltaMs: number) => microIso(new Date(Date.parse(value) + deltaMs))
  const erasureKey = (tenantId: string, userId: string) => `${tenantId}|${userId}`

  function fence(lease: ProjectionLease): ProjectionCursor {
    const cursor = state.cursors.find((candidate) => candidate.id === lease.cursorId)
    if (!cursor || cursor.leaseOwner !== lease.owner || cursor.leaseToken !== lease.token) throw new ProjectionLeaseLostError()
    return cursor
  }

  function recompute(scope: ProjectionScope, process: RegisteredProcess, caseId: string) {
    const events = state.events
      .filter((event) => event.tenantId === scope.tenantId && event.organizationId === scope.organizationId)
      .filter((event) => event.processKey === process.processKey && event.caseId === caseId && !event.voided)
      .sort((left, right) => compareKey(left.occurredAt, `${left.sourceLogId}:${String(left.seq).padStart(4, '0')}`, right.occurredAt, `${right.sourceLogId}:${String(right.seq).padStart(4, '0')}`))
    state.cases = state.cases.filter((row) => !(row.tenantId === scope.tenantId && row.organizationId === scope.organizationId && row.processKey === process.processKey && row.caseId === caseId))
    const rows = events.map(caseEventRow)
    const aggregate = rows.length > CASE_EVENT_LIMIT ? buildCaseAggregate(rows) : null
    const summary = summarizeCase(process, rows.slice(0, CASE_EVENT_LIMIT), aggregate)
    if (summary) state.cases.push({ ...summary, tenantId: scope.tenantId, organizationId: scope.organizationId, processKey: process.processKey, caseId })
  }

  function applyAdvance(cursor: ProjectionCursor, advance: CursorAdvance) {
    if (advance.kind === 'main') {
      cursor.lastCreatedAt = advance.lastCreatedAt
      cursor.lastLogId = advance.lastLogId
      cursor.lastRunAt = state.clock.now
      cursor.lastError = null
    }
    if (advance.kind === 'state') {
      cursor.stateWatermark = advance.stateWatermark
      cursor.stateLastLogId = advance.stateLastLogId
    }
    if (advance.kind === 'scan') {
      cursor.scanAfterCreatedAt = advance.afterCreatedAt
      cursor.scanAfterLogId = advance.afterLogId
      cursor.scanProcessedCount += advance.processedDelta
      cursor.scanUpdatedAt = state.clock.now
    }
  }

  function applyScanStart(stored: ProjectionCursor, scan: ScanStart) {
    stored.scanId = scan.scanId
    stored.scanChainId = scan.chainId
    stored.scanKind = scan.kind
    stored.scanFrom = scan.from
    stored.scanUntil = scan.until
    stored.scanAfterCreatedAt = scan.from
    stored.scanAfterLogId = scan.from ? MAX_LOG_ID : null
    stored.scanProgressJobId = scan.progressJobId
    stored.scanProcessedCount = 0
    stored.scanStartedAt = state.clock.now
    stored.scanUpdatedAt = state.clock.now
    if (stored.status !== 'rebuild_required') stored.status = 'backfilling'
  }

  const store: ProjectionStore = {
    async now() {
      return state.clock.now
    },
    async readCursor(scope) {
      const cursor = cursorFor(scope)
      return cursor ? { ...cursor } : null
    },
    async ensureCursor(scope, contractHash, settleMs) {
      if (!cursorFor(scope)) {
        cursorSequence += 1
        const start = shift(state.clock.now, -settleMs)
        state.cursors.push({
          id: `cursor-${cursorSequence}`,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          lastCreatedAt: start,
          lastLogId: MAX_LOG_ID,
          stateWatermark: start,
          stateLastLogId: MAX_LOG_ID,
          ...SCAN_CLEARED,
          scanProcessedCount: 0,
          scanStartedAt: null,
          scanUpdatedAt: null,
          actorKeyFingerprint: null,
          lastReconciledAt: state.clock.now,
          lastFullReconciledAt: state.clock.now,
          lastPrunedAt: state.clock.now,
          leaseOwner: null,
          leaseToken: 0,
          leaseUntil: null,
          contractHash,
          status: 'idle',
          lastRunAt: null,
          lastError: null,
        })
      }
      return { ...(cursorFor(scope) as ProjectionCursor) }
    },
    async acquireLease(cursor, owner, leaseMs) {
      const stored = state.cursors.find((candidate) => candidate.id === cursor.id)
      if (!stored) return null
      const free = !stored.leaseOwner || !stored.leaseUntil || Date.parse(stored.leaseUntil) < Date.parse(state.clock.now)
      if (!free) return null
      stored.leaseOwner = owner
      stored.leaseToken += 1
      stored.leaseUntil = shift(state.clock.now, leaseMs)
      return { cursorId: stored.id, scope: { tenantId: stored.tenantId, organizationId: stored.organizationId }, owner, token: stored.leaseToken }
    },
    async releaseLease(lease) {
      const stored = state.cursors.find((candidate) => candidate.id === lease.cursorId)
      if (stored && stored.leaseOwner === lease.owner && stored.leaseToken === lease.token) {
        stored.leaseOwner = null
        stored.leaseUntil = null
      }
    },
    async commit(lease: ProjectionLease, leaseMs: number, batch: ProjectionCommit): Promise<ProjectionCommitResult> {
      const cursor = fence(lease)
      if (batch.advance.kind === 'scan' && (cursor.scanId !== batch.advance.scanId || cursor.scanChainId !== batch.advance.chainId)) {
        throw new ProjectionScanSupersededError()
      }
      const scope = lease.scope
      const touched = new Set<string>()
      let inserted = 0
      for (const event of batch.events) {
        const exists = state.events.some((row) => row.sourceLogId === event.sourceLogId && row.processKey === event.processKey && row.seq === event.seq)
        if (exists) continue
        const { actorUserId, followupUserId, ...stored } = event
        const actorErasure = actorUserId && stored.actorPseudonym !== null ? state.erasures.get(erasureKey(scope.tenantId, actorUserId)) : undefined
        const valueErasure = followupUserId && stored.followupValue !== null ? state.erasures.get(erasureKey(scope.tenantId, followupUserId)) : undefined
        state.events.push({
          ...stored,
          actorPseudonym: actorErasure ?? stored.actorPseudonym,
          followupValue: valueErasure ?? stored.followupValue,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        touched.add(`${event.processKey}|${event.caseId}`)
        inserted += 1
      }
      let voided = 0
      for (const request of batch.voids) {
        for (const row of state.events) {
          if (row.tenantId !== scope.tenantId || row.organizationId !== scope.organizationId) continue
          if (!request.sourceLogIds.includes(row.sourceLogId)) continue
          const eligible = request.voidedByLogId ? (!row.voided || row.voidedByLogId === null) : !row.voided
          if (!eligible) continue
          row.voided = true
          row.voidedByLogId = request.voidedByLogId
          touched.add(`${row.processKey}|${row.caseId}`)
          voided += 1
        }
      }
      for (const key of touched) {
        const [processKey, caseId] = key.split('|')
        const process = batch.processes.find((candidate) => candidate.processKey === processKey)
        if (process) recompute(scope, process, caseId)
      }
      applyAdvance(cursor, batch.advance)
      cursor.leaseUntil = shift(state.clock.now, leaseMs)
      state.commits += 1
      return { inserted, voided, casesRecomputed: touched.size, casesRemoved: 0 }
    },
    async updateCursor(lease, leaseMs, values) {
      const cursor = fence(lease)
      const update = values as { last_pruned_at?: unknown; actor_key_fingerprint?: unknown; last_error?: unknown }
      if (update.last_pruned_at instanceof Date) cursor.lastPrunedAt = microIso(update.last_pruned_at)
      if (typeof update.actor_key_fingerprint === 'string') cursor.actorKeyFingerprint = update.actor_key_fingerprint
      if (typeof update.last_error === 'string') cursor.lastError = update.last_error
      cursor.leaseUntil = shift(state.clock.now, leaseMs)
    },
    async startScan(cursor, scan: ScanStart) {
      const stored = state.cursors.find((candidate) => candidate.id === cursor.id)
      if (stored) applyScanStart(stored, scan)
    },
    async startScanIfIdle(lease, _leaseMs, scan: ScanStart) {
      const cursor = fence(lease)
      if (cursor.scanId) return false
      applyScanStart(cursor, scan)
      return true
    },
    async touchScan(scope, scanId, chainId) {
      const cursor = cursorFor(scope)
      if (!cursor || cursor.scanId !== scanId || cursor.scanChainId !== chainId) return false
      cursor.scanUpdatedAt = state.clock.now
      return true
    },
    async resumeStalledScan(lease, _leaseMs, staleMs): Promise<ScanResume | null> {
      const cursor = fence(lease)
      if (!cursor.scanId) return null
      if (cursor.scanUpdatedAt && Date.parse(state.clock.now) - Date.parse(cursor.scanUpdatedAt) < staleMs) return null
      chainSequence += 1
      cursor.scanChainId = `00000000-0000-4000-8000-${String(chainSequence).padStart(12, '0')}`
      cursor.scanUpdatedAt = state.clock.now
      return { scanId: cursor.scanId, chainId: cursor.scanChainId, progressJobId: cursor.scanProgressJobId }
    },
    async finishScan(lease, _leaseMs, scanId, chainId, kind) {
      const cursor = fence(lease)
      if (cursor.scanId !== scanId || cursor.scanChainId !== chainId) return false
      Object.assign(cursor, SCAN_CLEARED)
      cursor.lastReconciledAt = state.clock.now
      if (kind !== 'reconcile') cursor.lastFullReconciledAt = state.clock.now
      if (cursor.status !== 'rebuild_required') cursor.status = 'idle'
      return true
    },
    async abandonScan(scope, scanId, chainId, error) {
      const cursor = cursorFor(scope)
      if (!cursor || cursor.scanId !== scanId || cursor.scanChainId !== chainId) return null
      const progressJobId = cursor.scanProgressJobId
      if (cursor.scanKind === 'reconcile' || cursor.scanKind === 'full_reconcile') cursor.lastReconciledAt = state.clock.now
      if (cursor.scanKind === 'full_reconcile') cursor.lastFullReconciledAt = state.clock.now
      Object.assign(cursor, SCAN_CLEARED)
      cursor.lastError = error
      if (cursor.status !== 'rebuild_required') cursor.status = 'idle'
      return { progressJobId }
    },
    async markRebuildRequired(cursor) {
      const stored = state.cursors.find((candidate) => candidate.id === cursor.id)
      if (stored) stored.status = 'rebuild_required'
    },
    async recordError(cursor, error) {
      const stored = state.cursors.find((candidate) => candidate.id === cursor.id)
      if (stored) stored.lastError = error
    },
    async loadDistinctValues(scope, processKey, field, limit) {
      const values = new Set<string>()
      for (const event of state.events) {
        if (event.tenantId !== scope.tenantId || event.organizationId !== scope.organizationId) continue
        if (event.processKey !== processKey || event.followupField !== field || event.followupValue === null) continue
        if (event.followupValue === 'other' || event.followupValue === 'none') continue
        values.add(event.followupValue)
      }
      return Array.from(values).slice(0, limit)
    },
    async clearProjectionBatch(lease) {
      fence(lease)
      const before = state.events.length + state.cases.length
      state.events = state.events.filter((event) => !(event.tenantId === lease.scope.tenantId && event.organizationId === lease.scope.organizationId))
      state.cases = state.cases.filter((row) => !(row.tenantId === lease.scope.tenantId && row.organizationId === lease.scope.organizationId))
      return before - state.events.length - state.cases.length
    },
    async pruneProjectionBatch(lease, _leaseMs, table, cutoff) {
      fence(lease)
      if (table !== 'insights_process_events') return 0
      const before = state.events.length
      state.events = state.events.filter((event) => Date.parse(event.occurredAt) >= Date.parse(cutoff))
      return before - state.events.length
    },
    async resetCursor(lease, _leaseMs, contractHash) {
      const cursor = fence(lease)
      Object.assign(cursor, SCAN_CLEARED)
      cursor.contractHash = contractHash
      cursor.actorKeyFingerprint = null
      cursor.status = 'idle'
      cursor.lastError = null
    },
    async counts() {
      return []
    },
    async listCursors() {
      return state.cursors.map((cursor) => ({ ...cursor }))
    },
    async recordErasure(tenantId, userId) {
      const key = erasureKey(tenantId, userId)
      const existing = state.erasures.get(key)
      if (existing) return existing
      const replacement = `${ERASED_PSEUDONYM_PREFIX}${String(state.erasures.size + 1).padStart(4, '0')}`
      state.erasures.set(key, replacement)
      return replacement
    },
    async replaceActorPseudonym(input) {
      if (!input.pseudonym) return { updated: 0, mismatchedOrganizationIds: [] }
      let updated = 0
      const mismatchedOrganizationIds: string[] = []
      for (const cursor of state.cursors.filter((candidate) => candidate.tenantId === input.tenantId)) {
        const stored = cursor.actorKeyFingerprint
        if (stored === null || stored === NO_PSEUDONYM_KEY_FINGERPRINT) continue
        if (stored !== input.keyFingerprint) {
          mismatchedOrganizationIds.push(cursor.organizationId)
          continue
        }
        for (const event of state.events) {
          if (event.tenantId !== input.tenantId || event.organizationId !== cursor.organizationId) continue
          if (event.actorPseudonym === input.pseudonym) {
            event.actorPseudonym = input.replacement
            updated += 1
          }
          const userField = input.userValueFields.some((target) => target.processKey === event.processKey && target.field === event.followupField)
          if (userField && event.followupValue === input.pseudonym) {
            event.followupValue = input.replacement
            updated += 1
          }
        }
      }
      return { updated, mismatchedOrganizationIds }
    },
  }
  return { store, state }
}
