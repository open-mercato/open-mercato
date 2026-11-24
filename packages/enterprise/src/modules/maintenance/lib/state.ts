import type { MaintenanceExpectedProcesses, MaintenanceProcessKind } from '@open-mercato/shared/lib/maintenance/types'

export const MAINTENANCE_STATE_VERSION = 1
export const MAINTENANCE_HISTORY_LIMIT = 50
export const DEFAULT_RETRY_AFTER_SECONDS = 300
export const MIN_RETRY_AFTER_SECONDS = 30
export const MAX_RETRY_AFTER_SECONDS = 86400
export const PAGE_TITLE_MAX = 200
export const PAGE_MESSAGE_MAX = 2000

export type MaintenanceStartedBy = {
  source: 'cli' | 'coordinator' | 'env'
  osUser?: string
  host: string
  operation?: string
}

export type MaintenanceHoldRecord = {
  id: string
  operation: string
  pid: number
  host: string
  heartbeatAt: string
  forbidsBypass: boolean
  gateRevision: number
}

export type MaintenanceStateV1 = {
  version: 1
  active: boolean
  epoch: number
  revision: number
  gateRevision: number
  reopenBarrier: { operationId: string; generation: string | null } | null
  windowId: string | null
  startedAt: string | null
  startedBy: MaintenanceStartedBy | null
  reason: string | null
  until: string | null
  retryAfterSeconds: number
  page: { title?: string; message?: string }
  bypass: { enabled: boolean; tokenSha256: string | null; expiresAt: string | null }
  expectedProcesses: MaintenanceExpectedProcesses | null
  hold: MaintenanceHoldRecord | null
  history: Array<{ windowId: string; startedAt: string; endedAt: string; startedBy: string; operations: string[] }>
}

export type MaintenanceProcessRecord = {
  processId: string
  kind: MaintenanceProcessKind
  host: string
  pid: number
  startedAt: string
  ackedGateRevision: number
  loadedGeneration: string | null
  inflight: number
  heartbeatAt: string
}

export function createInitialState(): MaintenanceStateV1 {
  return {
    version: 1,
    active: false,
    epoch: 0,
    revision: 0,
    gateRevision: 0,
    reopenBarrier: null,
    windowId: null,
    startedAt: null,
    startedBy: null,
    reason: null,
    until: null,
    retryAfterSeconds: DEFAULT_RETRY_AFTER_SECONDS,
    page: {},
    bypass: { enabled: false, tokenSha256: null, expiresAt: null },
    expectedProcesses: null,
    hold: null,
    history: [],
  }
}

export function clampRetryAfter(seconds: number): number {
  if (!Number.isFinite(seconds)) return DEFAULT_RETRY_AFTER_SECONDS
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(MIN_RETRY_AFTER_SECONDS, Math.floor(seconds)))
}

export function normalizePageText(value: string | undefined | null, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, max)
}

export type ParsedState =
  | { kind: 'ok'; state: MaintenanceStateV1 }
  | { kind: 'unsupported'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parses a stored state document. An unknown major version or a corrupted document is
 * reported as unsupported; callers fail safe by treating it as an active window.
 */
export function parseStoredState(raw: unknown): ParsedState {
  if (!isRecord(raw)) return { kind: 'unsupported', reason: 'state document is not an object' }
  if (raw.version !== MAINTENANCE_STATE_VERSION) {
    return { kind: 'unsupported', reason: `unsupported state version ${String(raw.version)}` }
  }
  if (typeof raw.active !== 'boolean' || typeof raw.revision !== 'number' || typeof raw.epoch !== 'number') {
    return { kind: 'unsupported', reason: 'state document is missing required fields' }
  }
  const base = createInitialState()
  const bypass = isRecord(raw.bypass) ? raw.bypass : {}
  const page = isRecord(raw.page) ? raw.page : {}
  return {
    kind: 'ok',
    state: {
      ...base,
      active: raw.active,
      epoch: raw.epoch,
      revision: raw.revision,
      gateRevision: typeof raw.gateRevision === 'number' ? raw.gateRevision : 0,
      reopenBarrier: isRecord(raw.reopenBarrier)
        ? {
            operationId: String(raw.reopenBarrier.operationId ?? ''),
            generation: typeof raw.reopenBarrier.generation === 'string' ? raw.reopenBarrier.generation : null,
          }
        : null,
      windowId: typeof raw.windowId === 'string' ? raw.windowId : null,
      startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
      startedBy: isRecord(raw.startedBy) ? (raw.startedBy as MaintenanceStartedBy) : null,
      reason: typeof raw.reason === 'string' ? raw.reason : null,
      until: typeof raw.until === 'string' ? raw.until : null,
      retryAfterSeconds: typeof raw.retryAfterSeconds === 'number' ? clampRetryAfter(raw.retryAfterSeconds) : DEFAULT_RETRY_AFTER_SECONDS,
      page: {
        title: normalizePageText(page.title as string | undefined, PAGE_TITLE_MAX),
        message: normalizePageText(page.message as string | undefined, PAGE_MESSAGE_MAX),
      },
      bypass: {
        enabled: bypass.enabled === true,
        tokenSha256: typeof bypass.tokenSha256 === 'string' ? bypass.tokenSha256 : null,
        expiresAt: typeof bypass.expiresAt === 'string' ? bypass.expiresAt : null,
      },
      expectedProcesses: isRecord(raw.expectedProcesses) ? (raw.expectedProcesses as MaintenanceExpectedProcesses) : null,
      hold: isRecord(raw.hold) ? (raw.hold as MaintenanceHoldRecord) : null,
      history: Array.isArray(raw.history) ? (raw.history as MaintenanceStateV1['history']).slice(-MAINTENANCE_HISTORY_LIMIT) : [],
    },
  }
}

export function parseProcessRecord(raw: unknown): MaintenanceProcessRecord | null {
  if (!isRecord(raw)) return null
  if (typeof raw.processId !== 'string' || typeof raw.heartbeatAt !== 'string') return null
  const kind = raw.kind
  if (kind !== 'web' && kind !== 'worker' && kind !== 'scheduler') return null
  return {
    processId: raw.processId,
    kind,
    host: typeof raw.host === 'string' ? raw.host : 'unknown',
    pid: typeof raw.pid === 'number' ? raw.pid : 0,
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : raw.heartbeatAt,
    ackedGateRevision: typeof raw.ackedGateRevision === 'number' ? raw.ackedGateRevision : -1,
    loadedGeneration: typeof raw.loadedGeneration === 'string' ? raw.loadedGeneration : null,
    inflight: typeof raw.inflight === 'number' ? raw.inflight : 0,
    heartbeatAt: raw.heartbeatAt,
  }
}
