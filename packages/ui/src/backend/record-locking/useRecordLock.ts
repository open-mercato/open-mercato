'use client'

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { withScopedApiHeaders } from '@open-mercato/ui/backend/utils/api'

export type RecordLockStrategy = 'optimistic' | 'pessimistic'
export type RecordLockResolution = 'normal' | 'accept_mine' | 'merged'

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

export type RecordLockConflict = {
  id: string
  resourceKind: string
  resourceId: string
  baseActionLogId: string | null
  incomingActionLogId: string | null
  resolutionOptions: Array<'accept_incoming' | 'accept_mine' | 'merged'>
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

type LockErrorResponse = {
  error?: string
  code?: string
  lock?: RecordLockApiLock | null
  conflict?: RecordLockConflict
}

export type UseRecordLockConfig = {
  resourceKind: string
  resourceId: string
  enabled: boolean
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
  isLoading: boolean
  error: string | null
  acquire: () => Promise<void>
  release: (reason?: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved') => Promise<void>
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
  const [resourceEnabled, setResourceEnabled] = React.useState(false)
  const [strategy, setStrategy] = React.useState<RecordLockStrategy>('optimistic')
  const [heartbeatSeconds, setHeartbeatSeconds] = React.useState(DEFAULT_HEARTBEAT_SECONDS)
  const [lock, setLock] = React.useState<RecordLockApiLock | null>(null)
  const [latestActionLogId, setLatestActionLogId] = React.useState<string | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const tokenRef = React.useRef<string | null>(null)

  const isOwner = Boolean(lock?.token)
  const isBlocked = Boolean(resourceEnabled && strategy === 'pessimistic' && lock && !isOwner)

  const acquire = React.useCallback(async () => {
    if (!enabled) return
    setIsLoading(true)
    setError(null)

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
      const fallbackStrategy = payload.lock?.strategy ?? 'pessimistic'
      setStrategy(fallbackStrategy)
      setResourceEnabled(true)
      setLock(payload.lock ?? null)
      setError(payload.error ?? `Failed to acquire lock (${call.status})`)
      tokenRef.current = payload.lock?.token ?? null
      setIsLoading(false)
      return
    }

    const result = call.result as AcquireResponse | null
    if (!result) {
      setError('Failed to acquire lock')
      setIsLoading(false)
      return
    }

    setStrategy(result.strategy)
    setHeartbeatSeconds(result.heartbeatSeconds || DEFAULT_HEARTBEAT_SECONDS)
    setResourceEnabled(Boolean(result.enabled && result.resourceEnabled))
    setLock(result.lock)
    setLatestActionLogId(result.latestActionLogId ?? null)
    tokenRef.current = result.lock?.token ?? null
    setIsLoading(false)
  }, [config.resourceId, config.resourceKind, enabled])

  const release = React.useCallback(async (reason: 'saved' | 'cancelled' | 'unmount' | 'conflict_resolved' = 'cancelled') => {
    const token = tokenRef.current
    if (!enabled || !token) return
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
  }, [config.resourceId, config.resourceKind, enabled])

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
    if (!enabled || !tokenRef.current || !resourceEnabled) return
    const interval = Math.max(5, heartbeatSeconds || DEFAULT_HEARTBEAT_SECONDS) * 1000
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
      })
    }, interval)

    return () => window.clearInterval(handle)
  }, [config.resourceId, config.resourceKind, enabled, heartbeatSeconds, resourceEnabled])

  React.useEffect(() => {
    if (!enabled) return
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
  }, [config.resourceId, config.resourceKind, enabled])

  const runGuardedMutation = React.useCallback(
    async <T,>(
      run: () => Promise<T>,
      options?: {
        resolution?: RecordLockResolution
        conflictId?: string | null
        baseLogId?: string | null
      },
    ): Promise<T> => {
      if (enabled && resourceEnabled && !tokenRef.current) {
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
    [acquire, config.resourceId, config.resourceKind, enabled, latestActionLogId, resourceEnabled],
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
    isLoading,
    error,
    acquire,
    release,
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
  return { code, message, conflict: payload.conflict }
}
