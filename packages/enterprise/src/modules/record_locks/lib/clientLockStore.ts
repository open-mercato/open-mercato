"use client"

export type RecordLockUiView = {
  id: string
  resourceKind: string
  resourceId: string
  token: string | null
  strategy: 'optimistic' | 'pessimistic'
  status: 'active' | 'released' | 'expired' | 'force_released'
  lockedByUserId: string
  lockedByName?: string | null
  lockedByEmail?: string | null
  lockedByIp?: string | null
  baseActionLogId: string | null
  lockedAt: string
  lastHeartbeatAt: string
  expiresAt: string
  activeParticipantCount?: number
  participants?: Array<{
    userId: string
    lockedByName?: string | null
    lockedByEmail?: string | null
    lockedByIp?: string | null
    lockedAt: string
    lastHeartbeatAt: string
    expiresAt: string
  }>
}

export type RecordLockUiConflict = {
  id: string
  resourceKind: string
  resourceId: string
  baseActionLogId: string | null
  incomingActionLogId: string | null
  allowIncomingOverride: boolean
  canOverrideIncoming: boolean
  resolutionOptions: Array<'accept_mine'>
  changes: Array<{
    field: string
    displayValue: unknown
    incomingValue: unknown
    mineValue: unknown
  }>
}

export type RecordLockFormState = {
  formId: string
  resourceKind: string
  resourceId: string
  recordDeleted?: boolean
  acquired?: boolean
  currentUserId?: string | null
  allowForceUnlock?: boolean
  heartbeatSeconds?: number
  latestActionLogId?: string | null
  lock?: RecordLockUiView | null
  conflict?: RecordLockUiConflict | null
  pendingConflictId?: string | null
  pendingResolution?: 'normal' | 'accept_mine' | 'merged'
  pendingResolutionArmed?: boolean
}

const stateByFormId = new Map<string, RecordLockFormState>()
const listenersByFormId = new Map<string, Set<() => void>>()

function emit(formId: string) {
  const listeners = listenersByFormId.get(formId)
  if (!listeners?.size) return
  listeners.forEach((listener) => {
    try {
      listener()
    } catch {}
  })
}

export function getRecordLockFormState(formId: string): RecordLockFormState | null {
  return stateByFormId.get(formId) ?? null
}

export function setRecordLockFormState(formId: string, patch: Partial<RecordLockFormState>) {
  const prev = stateByFormId.get(formId)
  const next: RecordLockFormState = {
    ...(prev ?? {
      formId,
      resourceKind: '',
      resourceId: '',
    }),
    ...patch,
  }
  stateByFormId.set(formId, next)
  emit(formId)
}

export function clearRecordLockFormState(formId: string) {
  stateByFormId.delete(formId)
  emit(formId)
}

export function subscribeRecordLockFormState(formId: string, listener: () => void): () => void {
  const listeners = listenersByFormId.get(formId) ?? new Set<() => void>()
  listeners.add(listener)
  listenersByFormId.set(formId, listeners)
  return () => {
    const current = listenersByFormId.get(formId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) listenersByFormId.delete(formId)
  }
}
