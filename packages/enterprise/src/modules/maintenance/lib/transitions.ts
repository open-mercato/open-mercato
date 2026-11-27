import { randomUUID } from 'node:crypto'
import type { MaintenanceExpectedProcesses } from '@open-mercato/shared/lib/maintenance/types'
import {
  clampRetryAfter,
  createInitialState,
  MAINTENANCE_HISTORY_LIMIT,
  normalizePageText,
  PAGE_MESSAGE_MAX,
  PAGE_TITLE_MAX,
  type MaintenanceHoldRecord,
  type MaintenanceStartedBy,
  type MaintenanceStateV1,
} from './state'
import type { MaintenanceStateStore } from './store/types'

export class MaintenanceStateConflictError extends Error {
  constructor() {
    super('[internal] Maintenance state changed concurrently; retry')
    this.name = 'MaintenanceStateConflictError'
  }
}

export class MaintenanceStateUnsupportedError extends Error {
  constructor(reason: string) {
    super(`[internal] Maintenance state is unreadable (${reason}); refusing to mutate it`)
    this.name = 'MaintenanceStateUnsupportedError'
  }
}

export type StateMutation<T> = (current: MaintenanceStateV1, now: Date) => { next: MaintenanceStateV1 | null; result: T }

/**
 * Reads the authoritative state, applies `mutate`, and writes it back with compare-and-set.
 * A lost race retries once against the fresh state, then reports the conflict.
 * Returning `next: null` leaves the stored state untouched.
 */
export async function mutateState<T>(store: MaintenanceStateStore, mutate: StateMutation<T>, attempts = 2): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const read = await store.readState()
    if (read.kind === 'unsupported') throw new MaintenanceStateUnsupportedError(read.reason)
    const current = read.kind === 'ok' ? read.state : createInitialState()
    const now = await store.now()
    const { next, result } = mutate(current, now)
    if (!next) return result
    const written = await store.compareAndSet(current.revision, { ...next, revision: current.revision + 1 })
    if (written) return result
  }
  throw new MaintenanceStateConflictError()
}

export type ActivateInput = {
  title?: string
  message?: string
  until?: string | null
  retryAfterSeconds?: number
  reason?: string
  startedBy: MaintenanceStartedBy
  bypassTokenSha256?: string | null
  bypassExpiresAt?: string | null
  expectedProcesses?: MaintenanceExpectedProcesses | null
}

export type ActivateResult = { windowId: string; created: boolean; epoch: number }

export function activateState(current: MaintenanceStateV1, input: ActivateInput, now: Date): { next: MaintenanceStateV1; result: ActivateResult } {
  const page = {
    title: normalizePageText(input.title, PAGE_TITLE_MAX) ?? (current.active ? current.page.title : undefined),
    message: normalizePageText(input.message, PAGE_MESSAGE_MAX) ?? (current.active ? current.page.message : undefined),
  }
  const retryAfterSeconds = input.retryAfterSeconds !== undefined ? clampRetryAfter(input.retryAfterSeconds) : current.retryAfterSeconds
  const until = input.until !== undefined ? input.until : current.active ? current.until : null
  const bypass = input.bypassTokenSha256
    ? { enabled: true, tokenSha256: input.bypassTokenSha256, expiresAt: input.bypassExpiresAt ?? null }
    : current.active ? current.bypass : { enabled: false, tokenSha256: null, expiresAt: null }
  const expectedProcesses = input.expectedProcesses !== undefined ? input.expectedProcesses : current.expectedProcesses
  if (current.active && current.windowId) {
    const bypassChanged = bypass.tokenSha256 !== current.bypass.tokenSha256
    return {
      next: {
        ...current,
        page,
        until,
        retryAfterSeconds,
        reason: input.reason ?? current.reason,
        bypass,
        expectedProcesses,
        gateRevision: bypassChanged ? current.gateRevision + 1 : current.gateRevision,
      },
      result: { windowId: current.windowId, created: false, epoch: current.epoch },
    }
  }
  const windowId = randomUUID()
  return {
    next: {
      ...current,
      active: true,
      epoch: current.epoch + 1,
      gateRevision: current.gateRevision + 1,
      windowId,
      startedAt: now.toISOString(),
      startedBy: input.startedBy,
      reason: input.reason ?? null,
      until,
      retryAfterSeconds,
      page,
      bypass,
      expectedProcesses,
      hold: null,
    },
    result: { windowId, created: true, epoch: current.epoch + 1 },
  }
}

export type DeactivateBlock =
  | { kind: 'hold'; hold: MaintenanceHoldRecord }
  | { kind: 'reopen_barrier'; barrier: NonNullable<MaintenanceStateV1['reopenBarrier']> }

export function deactivationBlock(current: MaintenanceStateV1): DeactivateBlock | null {
  if (current.hold) return { kind: 'hold', hold: current.hold }
  if (current.reopenBarrier) return { kind: 'reopen_barrier', barrier: current.reopenBarrier }
  return null
}

export function deactivateState(current: MaintenanceStateV1, now: Date, operations: string[] = []): MaintenanceStateV1 {
  const historyEntry = current.windowId && current.startedAt
    ? [{
        windowId: current.windowId,
        startedAt: current.startedAt,
        endedAt: now.toISOString(),
        startedBy: current.startedBy ? `${current.startedBy.source}@${current.startedBy.host}` : 'unknown',
        operations,
      }]
    : []
  return {
    ...current,
    active: false,
    epoch: current.epoch + 1,
    gateRevision: current.gateRevision + 1,
    windowId: null,
    startedAt: null,
    startedBy: null,
    reason: null,
    until: null,
    page: {},
    bypass: { enabled: false, tokenSha256: null, expiresAt: null },
    hold: null,
    reopenBarrier: null,
    history: [...current.history, ...historyEntry].slice(-MAINTENANCE_HISTORY_LIMIT),
  }
}

export function computeRetryAfterSeconds(state: Pick<MaintenanceStateV1, 'until' | 'retryAfterSeconds'>, now: Date): number {
  if (state.until) {
    const remaining = Math.ceil((Date.parse(state.until) - now.getTime()) / 1000)
    if (Number.isFinite(remaining)) return Math.min(86400, Math.max(30, remaining))
  }
  return clampRetryAfter(state.retryAfterSeconds)
}
