'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiHeaders } from '@open-mercato/ui/backend/utils/api'

export type RecordLockStrategy = 'optimistic' | 'pessimistic'
export type RecordLockResolution = 'normal' | 'accept_mine'

export type RecordLockApiLock = {
  id: string
  resourceKind: string
  resourceId: string
  token: string | null
  strategy: RecordLockStrategy
  status: 'active' | 'released' | 'expired' | 'force_released'
  lockedByUserId: string
  baseActionLogId: string | null
  lockedAt: string
  lastHeartbeatAt: string
  expiresAt: string
}

export type RecordLockConflictChange = {
  field: string
  displayValue: unknown
  baseValue?: unknown
  incomingValue: unknown
  mineValue: unknown
}

export type RecordLockConflict = {
  id: string
  resourceKind: string
  resourceId: string
  baseActionLogId: string | null
  incomingActionLogId: string | null
  resolutionOptions: Array<'accept_incoming' | 'accept_mine'>
  changes: RecordLockConflictChange[]
}

type AcquireResponse = {
  ok: true
  enabled: boolean
  resourceEnabled: boolean
  strategy: RecordLockStrategy
  heartbeatSeconds: number
  acquired: boolean
  latestActionLogId: string | null
  lock: RecordLockApiLock | null
}

type HeartbeatResponse = {
  ok: true
  expiresAt: string | null
}

type ReleaseResponse = {
  ok: true
  released: boolean
}

type ForceReleaseResponse = {
  ok: true
  released: boolean
  lock?: RecordLockApiLock | null
}

type LockErrorResponse = {
  error?: string
  code?: string
  lock?: RecordLockApiLock | null
  conflict?: RecordLockConflict
}

type FeatureCheckResponse = {
  ok?: boolean
  granted?: string[]
}

export type UseRecordLockConfig = {
  resourceKind: string
  resourceId: string
  enabled: boolean
  autoCheckAcl?: boolean
}

export type UseRecordLockResult = {
  enabled: boolean
  resourceEnabled: boolean
  strategy: RecordLockStrategy
  heartbeatSeconds: number
  lock: RecordLockApiLock | null
  latestActionLogId: string | null
  isOwner: boolean
  isBlocked: boolean
  canForceRelease: boolean
  isLoading: boolean
  error: string | null
  acquire: () => Promise<void>
  release: (reason?: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved') => Promise<void>
  forceRelease: (reason?: string) => Promise<boolean>
  runGuardedMutation: <T>(
    run: () => Promise<T>,
    options?: {
      resolution?: RecordLockResolution
      conflictId?: string | null
      baseLogId?: string | null
    },
  ) => Promise<T>
  setLatestActionLogId: (value: string | null) => void
}

const DEFAULT_HEARTBEAT_SECONDS = 30
const RECORD_LOCK_VIEW_FEATURE = 'record_locks.view'
const RECORD_LOCK_FORCE_RELEASE_FEATURE = 'record_locks.force_release'

function toMessage(value: unknown): string {
  if (typeof value === 'string' && value.trim().length) return value.trim()
  if (value && typeof value === 'object') {
    const candidate = (value as { message?: unknown; error?: unknown }).message
      ?? (value as { error?: unknown }).error
    if (typeof candidate === 'string' && candidate.trim().length) return candidate.trim()
  }
  return 'Request failed'
}

export function useRecordLock(config: UseRecordLockConfig): UseRecordLockResult {
  const enabled = config.enabled && config.resourceKind.trim().length > 0 && config.resourceId.trim().length > 0
  const autoCheckAcl = config.autoCheckAcl !== false
  const [resourceEnabled, setResourceEnabled] = React.useState(false)
  const [strategy, setStrategy] = React.useState<RecordLockStrategy>('optimistic')
  const [heartbeatSeconds, setHeartbeatSeconds] = React.useState(DEFAULT_HEARTBEAT_SECONDS)
  const [lock, setLock] = React.useState<RecordLockApiLock | null>(null)
  const [latestActionLogId, setLatestActionLogId] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [aclStatus, setAclStatus] = React.useState<'unknown' | 'granted' | 'denied'>(() => (
    autoCheckAcl ? 'unknown' : 'granted'
  ))
  const [canForceRelease, setCanForceRelease] = React.useState<boolean>(() => !autoCheckAcl)

  const tokenRef = React.useRef<string | null>(null)
  const aclCheckPromiseRef = React.useRef<Promise<boolean> | null>(null)
  const aclStatusRef = React.useRef<'unknown' | 'granted' | 'denied'>(aclStatus)

  const isOwner = Boolean(lock?.status === 'active' && lock?.token)
  const isBlocked = Boolean(
    resourceEnabled
    && strategy === 'pessimistic'
    && lock?.status === 'active'
    && !isOwner,
  )
  const canUseLockApi = enabled && (!autoCheckAcl || aclStatus === 'granted')

  React.useEffect(() => {
    aclStatusRef.current = aclStatus
  }, [aclStatus])

  const ensureAcl = React.useCallback(async (): Promise<boolean> => {
    if (!enabled) return false
    if (!autoCheckAcl) {
      if (aclStatusRef.current !== 'granted') setAclStatus('granted')
      setCanForceRelease(true)
      return true
    }
    if (aclStatusRef.current === 'granted') return true
    if (aclStatusRef.current === 'denied') return false
    if (!aclCheckPromiseRef.current) {
      aclCheckPromiseRef.current = (async () => {
        try {
          const checkCall = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ features: [RECORD_LOCK_VIEW_FEATURE, RECORD_LOCK_FORCE_RELEASE_FEATURE] }),
          })
          const grantedSet = new Set(checkCall.result?.granted ?? [])
          const granted = checkCall.ok
            && grantedSet.has(RECORD_LOCK_VIEW_FEATURE)
          setCanForceRelease(grantedSet.has(RECORD_LOCK_FORCE_RELEASE_FEATURE))
          setAclStatus(granted ? 'granted' : 'denied')
          return granted
        } catch {
          setCanForceRelease(false)
          setAclStatus('denied')
          return false
        } finally {
          aclCheckPromiseRef.current = null
        }
      })()
    }
    return aclCheckPromiseRef.current
  }, [autoCheckAcl, enabled])

  React.useEffect(() => {
    aclCheckPromiseRef.current = null
    if (!enabled) {
      setAclStatus(autoCheckAcl ? 'unknown' : 'granted')
      setCanForceRelease(!autoCheckAcl)
      return
    }
    if (!autoCheckAcl) {
      setAclStatus('granted')
      setCanForceRelease(true)
      return
    }
    setCanForceRelease(false)
    setAclStatus('unknown')
  }, [autoCheckAcl, config.resourceId, config.resourceKind, enabled])

  const acquire = React.useCallback(async () => {
    if (!enabled) return
    const hasAccess = await ensureAcl()
    if (!hasAccess) {
      setResourceEnabled(false)
      setLock(null)
      setLatestActionLogId(null)
      tokenRef.current = null
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const call = await apiCall<AcquireResponse | LockErrorResponse>(
        '/api/record_locks/acquire',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resourceKind: config.resourceKind,
            resourceId: config.resourceId,
          }),
        },
      )

      if (!call.ok) {
        const payload = (call.result ?? {}) as LockErrorResponse
        const lockPayload = payload.lock ?? null
        const isLockedByOtherUser = payload.code === 'record_locked' && Boolean(lockPayload)
        const fallbackStrategy = payload.lock?.strategy ?? 'pessimistic'
        setStrategy(fallbackStrategy)
        setResourceEnabled(true)
        setLock(lockPayload)
        setError(isLockedByOtherUser ? null : (payload.error ?? `Failed to acquire lock (${call.status})`))
        tokenRef.current = lockPayload?.token ?? null
        return
      }

      const result = call.result as AcquireResponse | null
      if (!result) {
        setError('Failed to acquire lock')
        return
      }

      setStrategy(result.strategy)
      setHeartbeatSeconds(result.heartbeatSeconds || DEFAULT_HEARTBEAT_SECONDS)
      setResourceEnabled(Boolean(result.enabled && result.resourceEnabled))
      setLock(result.lock)
      setLatestActionLogId(result.latestActionLogId ?? null)
      tokenRef.current = result.lock?.token ?? null
    } finally {
      setIsLoading(false)
    }
  }, [config.resourceId, config.resourceKind, enabled, ensureAcl])

  const release = React.useCallback(async (reason: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved' = 'cancelled') => {
    const token = tokenRef.current
    if (!canUseLockApi || !token) return
    await apiCall<ReleaseResponse>('/api/record_locks/release', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        resourceKind: config.resourceKind,
        resourceId: config.resourceId,
        reason,
      }),
    })
    tokenRef.current = null
    setLock((prev) => (prev ? { ...prev, token: null, status: 'released' } : prev))
  }, [canUseLockApi, config.resourceId, config.resourceKind])

  const forceRelease = React.useCallback(async (reason = 'manual_takeover'): Promise<boolean> => {
    if (!canUseLockApi || !resourceEnabled || !lock || !isBlocked) return false
    if (autoCheckAcl && !canForceRelease) return false
    setIsLoading(true)
    setError(null)
    try {
      const call = await apiCall<ForceReleaseResponse | LockErrorResponse>(
        '/api/record_locks/force-release',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            resourceKind: config.resourceKind,
            resourceId: config.resourceId,
            reason,
          }),
        },
      )
      if (!call.ok) {
        const payload = (call.result ?? {}) as LockErrorResponse
        setError(payload.error ?? `Failed to force release lock (${call.status})`)
        return false
      }

      await acquire()
      return true
    } finally {
      setIsLoading(false)
    }
  }, [
    acquire,
    autoCheckAcl,
    canForceRelease,
    canUseLockApi,
    config.resourceId,
    config.resourceKind,
    isBlocked,
    lock,
    resourceEnabled,
  ])

  React.useEffect(() => {
    if (!enabled) {
      setResourceEnabled(false)
      setLock(null)
      setLatestActionLogId(null)
      tokenRef.current = null
      return
    }
    void acquire()
  }, [acquire, enabled])

  React.useEffect(() => {
    if (!canUseLockApi || !resourceEnabled) return
    const interval = Math.max(5, heartbeatSeconds || DEFAULT_HEARTBEAT_SECONDS) * 1000
    if (tokenRef.current) {
      const handle = window.setInterval(() => {
        const token = tokenRef.current
        if (!token) return
        void apiCall<HeartbeatResponse>('/api/record_locks/heartbeat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token,
            resourceKind: config.resourceKind,
            resourceId: config.resourceId,
          }),
        }).then((response) => {
          const stillCurrentToken = tokenRef.current === token
          if (!stillCurrentToken || !response.ok) return
          if (response.result?.expiresAt) return
          tokenRef.current = null
          setLock((prev) => (prev ? { ...prev, token: null, status: 'released' } : prev))
          void acquire()
        }).catch(() => {})
      }, interval)

      return () => window.clearInterval(handle)
    }

    if (!isBlocked) return
    const blockedPoll = window.setInterval(() => {
      void acquire()
    }, interval)
    return () => window.clearInterval(blockedPoll)
  }, [acquire, canUseLockApi, config.resourceId, config.resourceKind, heartbeatSeconds, isBlocked, resourceEnabled])

  React.useEffect(() => {
    if (!canUseLockApi) return
    return () => {
      const token = tokenRef.current
      if (!token) return
      void apiCall<ReleaseResponse>('/api/record_locks/release', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          token,
          resourceKind: config.resourceKind,
          resourceId: config.resourceId,
          reason: 'unmount',
        }),
      })
      tokenRef.current = null
    }
  }, [canUseLockApi, config.resourceId, config.resourceKind])

  const runGuardedMutation = React.useCallback(
    async <T,>(
      run: () => Promise<T>,
      options?: {
        resolution?: RecordLockResolution
        conflictId?: string | null
        baseLogId?: string | null
      },
    ): Promise<T> => {
      const lockApiAllowed = await ensureAcl()
      if (!enabled || !lockApiAllowed) {
        return run()
      }
      const shouldAcquireBeforeMutation = !tokenRef.current && (
        !lock
        || lock.status !== 'active'
      )
      if (shouldAcquireBeforeMutation) {
        await acquire()
      }
      const headers: Record<string, string> = {
        'x-om-record-lock-kind': config.resourceKind,
        'x-om-record-lock-resource-id': config.resourceId,
        'x-om-record-lock-resolution': options?.resolution ?? 'normal',
      }

      const token = tokenRef.current
      if (token) headers['x-om-record-lock-token'] = token

      const baseLogId = options?.baseLogId ?? latestActionLogId
      if (baseLogId) headers['x-om-record-lock-base-log-id'] = baseLogId

      if (options?.conflictId) headers['x-om-record-lock-conflict-id'] = options.conflictId

      try {
        return await withScopedApiHeaders(headers, run)
      } catch (err) {
        const typed = err as LockErrorResponse
        if (typed?.code === 'record_lock_conflict' && typed.conflict?.incomingActionLogId) {
          setLatestActionLogId(typed.conflict.incomingActionLogId)
        }
        throw err
      }
    },
    [acquire, config.resourceId, config.resourceKind, enabled, ensureAcl, latestActionLogId, lock],
  )

  React.useEffect(() => {
    if (!error) return
    const timer = window.setTimeout(() => {
      setError((current) => (current === error ? null : current))
    }, 8_000)
    return () => window.clearTimeout(timer)
  }, [error])

  return {
    enabled,
    resourceEnabled,
    strategy,
    heartbeatSeconds,
    lock,
    latestActionLogId,
    isOwner,
    isBlocked,
    canForceRelease,
    isLoading,
    error,
    acquire,
    release,
    forceRelease,
    runGuardedMutation,
    setLatestActionLogId,
  }
}

export function readRecordLockError(error: unknown): { code?: string; message: string; conflict?: RecordLockConflict } {
  if (!error || typeof error !== 'object') {
    return { message: toMessage(error) }
  }

  const payload = error as {
    code?: unknown
    message?: unknown
    error?: unknown
    conflict?: RecordLockConflict
  }

  const code = typeof payload.code === 'string' ? payload.code : undefined
  const message = toMessage(payload.message ?? payload.error)

  let conflict: RecordLockConflict | undefined
  if (payload.conflict && typeof payload.conflict === 'object') {
    const raw = payload.conflict as Record<string, unknown>
    const id = typeof raw.id === 'string' ? raw.id : null
    const resourceKind = typeof raw.resourceKind === 'string' ? raw.resourceKind : null
    const resourceId = typeof raw.resourceId === 'string' ? raw.resourceId : null

    if (id && resourceKind && resourceId) {
      const options = Array.isArray(raw.resolutionOptions)
        ? raw.resolutionOptions
          .filter((option): option is 'accept_incoming' | 'accept_mine' => option === 'accept_incoming' || option === 'accept_mine')
        : []

      const changes = Array.isArray(raw.changes)
        ? raw.changes
          .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
          .map((entry) => ({
            field: typeof entry.field === 'string' && entry.field.trim().length ? entry.field : 'unknown',
            displayValue: Object.prototype.hasOwnProperty.call(entry, 'displayValue')
              ? entry.displayValue
              : (Object.prototype.hasOwnProperty.call(entry, 'baseValue') ? entry.baseValue : null),
            baseValue: Object.prototype.hasOwnProperty.call(entry, 'baseValue') ? entry.baseValue : null,
            incomingValue: Object.prototype.hasOwnProperty.call(entry, 'incomingValue') ? entry.incomingValue : null,
            mineValue: Object.prototype.hasOwnProperty.call(entry, 'mineValue') ? entry.mineValue : null,
          }))
        : []

      conflict = {
        id,
        resourceKind,
        resourceId,
        baseActionLogId: typeof raw.baseActionLogId === 'string' ? raw.baseActionLogId : null,
        incomingActionLogId: typeof raw.incomingActionLogId === 'string' ? raw.incomingActionLogId : null,
        resolutionOptions: options.length ? options : ['accept_incoming', 'accept_mine'],
        changes,
      }
    }
  }

  return { code, message, conflict }
}
