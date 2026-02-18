'use client'

import * as React from 'react'
import {
  useRecordLock,
  readRecordLockError,
  type RecordLockConflict,
  type RecordLockResolution,
  type UseRecordLockConfig,
} from './useRecordLock'

export type UseRecordLockGuardResult = {
  lock: ReturnType<typeof useRecordLock>
  conflict: RecordLockConflict | null
  pending: boolean
  clearConflict: () => void
  runMutation: <T>(run: () => Promise<T>) => Promise<T | null>
  resolveConflict: <T>(resolution: Extract<RecordLockResolution, 'accept_mine'>, run?: () => Promise<T>) => Promise<T | null>
}

export function useRecordLockGuard(config: UseRecordLockConfig): UseRecordLockGuardResult {
  const lock = useRecordLock(config)
  const [conflict, setConflict] = React.useState<RecordLockConflict | null>(null)
  const [pending, setPending] = React.useState(false)
  const lastRunRef = React.useRef<(() => Promise<unknown>) | null>(null)

  const clearConflict = React.useCallback(() => {
    setConflict(null)
  }, [])

  const runMutation = React.useCallback(async <T,>(run: () => Promise<T>): Promise<T | null> => {
    lastRunRef.current = run as () => Promise<unknown>
    setPending(true)
    try {
      const result = await lock.runGuardedMutation(run, { resolution: 'normal' })
      await lock.release('saved')
      setConflict(null)
      return result
    } catch (error) {
      const parsed = readRecordLockError(error)
      if (parsed.code === 'record_lock_conflict' && parsed.conflict) {
        setConflict(parsed.conflict)
        return null
      }
      throw error
    } finally {
      setPending(false)
    }
  }, [lock])

  const resolveConflict = React.useCallback(async <T,>(
    resolution: Extract<RecordLockResolution, 'accept_mine'>,
    run?: () => Promise<T>,
  ): Promise<T | null> => {
    if (!conflict) return null
    const operation = run ?? (lastRunRef.current as (() => Promise<T>) | null)
    if (!operation) return null
    lastRunRef.current = operation as () => Promise<unknown>
    setPending(true)
    try {
      const result = await lock.runGuardedMutation(operation, {
        resolution,
        conflictId: conflict.id,
        baseLogId: conflict.baseActionLogId,
      })
      await lock.release('saved')
      setConflict(null)
      return result
    } catch (error) {
      const parsed = readRecordLockError(error)
      if (parsed.code === 'record_lock_conflict' && parsed.conflict) {
        setConflict(parsed.conflict)
        return null
      }
      throw error
    } finally {
      setPending(false)
    }
  }, [conflict, lock])

  return {
    lock,
    conflict,
    pending,
    clearConflict,
    runMutation,
    resolveConflict,
  }
}
