"use client"
import * as React from 'react'
import type { ProgressJobDto } from './useProgressPoll'

/** Default auto-hide delay for successfully completed progress jobs (ms). */
export const DEFAULT_AUTO_HIDE_MS = 10_000

function safeParseMs(isoString: string | null | undefined): number | null {
  if (!isoString) return null
  const ms = new Date(isoString).getTime()
  return isNaN(ms) ? null : ms
}

/**
 * Hides successfully completed progress jobs after a configurable timeout.
 *
 * Uses `finishedAt` so a job that finished 8s ago with a 10s timeout
 * disappears in 2s instead of a full new 10s window — works correctly
 * after panel collapse/expand or page focus restore.
 *
 * Pass `timeoutMs={false}` or `timeoutMs={0}` to disable auto-hide.
 * Failed and cancelled jobs are never hidden automatically.
 *
 * Each completed job ID is scheduled at most once. If the same job ID
 * reappears in the list after its timer has already fired (which should
 * not occur in normal server behaviour), it remains hidden.
 */
export function useAutoHideCompletedJobs(
  completed: ProgressJobDto[],
  timeoutMs: number | false = DEFAULT_AUTO_HIDE_MS,
): ProgressJobDto[] {
  const [expiredIds, setExpiredIds] = React.useState<ReadonlySet<string>>(new Set())
  // Tracks IDs for which a hide-timer has been scheduled to prevent double-scheduling
  // on poll/SSE refresh cycles. IDs remain here after the timer fires so a reappearing
  // job (should not happen) stays hidden rather than restarting the countdown.
  const scheduledRef = React.useRef<Set<string>>(new Set())
  const timersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Clear all pending timers on unmount
  React.useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t)
      timersRef.current.clear()
      scheduledRef.current.clear()
    }
  }, [])

  React.useEffect(() => {
    if (timeoutMs === false || timeoutMs <= 0) return

    const now = Date.now()
    const timeout = timeoutMs as number

    for (const job of completed) {
      if (job.status !== 'completed') continue
      if (scheduledRef.current.has(job.id)) continue

      scheduledRef.current.add(job.id)

      const finishedAt = safeParseMs(job.finishedAt) ?? now
      const elapsed = now - finishedAt
      const remaining = Math.max(0, timeout - elapsed)

      if (remaining === 0) {
        // Already past the timeout window (e.g. page reload with stale job)
        setExpiredIds((prev) => {
          const next = new Set(prev)
          next.add(job.id)
          return next
        })
        continue
      }

      const t = setTimeout(() => {
        setExpiredIds((prev) => {
          const next = new Set(prev)
          next.add(job.id)
          return next
        })
        timersRef.current.delete(job.id)
      }, remaining)
      timersRef.current.set(job.id, t)
    }
  }, [completed, timeoutMs])

  if (timeoutMs === false || timeoutMs <= 0) return completed

  const timeout = timeoutMs as number
  const now = Date.now()

  return completed.filter((job) => {
    if (job.status !== 'completed') return true
    if (expiredIds.has(job.id)) return false
    // Safety: hide jobs whose finishedAt is already past the window
    // (handles panel remount or page reload without relying solely on expiredIds)
    const finishedAt = safeParseMs(job.finishedAt)
    if (finishedAt !== null && now - finishedAt >= timeout) return false
    return true
  })
}
