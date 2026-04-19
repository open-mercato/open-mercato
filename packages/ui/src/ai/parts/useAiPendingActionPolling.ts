"use client"

import * as React from 'react'
import { apiCallOrThrow } from '../../backend/utils/apiCall'
import type { AiPendingActionCardAction, AiPendingActionCardStatus } from './types'

/**
 * Shared polling hook for the Phase 3 mutation-approval cards (Step 5.10).
 *
 * Responsibilities:
 * - Fetch `GET /api/ai_assistant/ai/actions/:id` on mount, even when the
 *   server previously streamed a preview card. This is the "reconnect" path:
 *   after a page reload or navigation away+back, the card recovers the
 *   current pending-action state instead of staying blank.
 * - Poll every 3 seconds while the status is non-terminal
 *   (`pending` / `executing`). Terminal states (`confirmed`, `cancelled`,
 *   `failed`, `expired`) stop polling.
 * - Expose a `refresh()` force-fetch helper the confirmation card uses after
 *   a confirm POST races with the polling loop.
 *
 * The hook owns a single `setInterval`/`setTimeout` — unmounting clears
 * every outstanding timer. This is required for the Jest fake-timers
 * "mount, unmount mid-poll" test contract.
 */

const TERMINAL_STATUSES: ReadonlyArray<AiPendingActionCardStatus> = [
  'confirmed',
  'cancelled',
  'failed',
  'expired',
]

function isTerminal(status: AiPendingActionCardStatus | null): boolean {
  if (!status) return false
  return TERMINAL_STATUSES.includes(status)
}

export interface UseAiPendingActionPollingOptions {
  pendingActionId: string
  /**
   * Poll interval in ms while the status is non-terminal. Defaults to 3000.
   */
  intervalMs?: number
  /**
   * Endpoint base. Override to point at a mock during tests.
   */
  endpoint?: string
  /**
   * When true, the hook does NOT schedule any network activity. Used by the
   * result card which already holds a terminal state and only needs to read
   * what the preview card fetched.
   */
  disabled?: boolean
}

export interface AiPendingActionFetchResult {
  pendingAction: AiPendingActionCardAction | null
  error?: { code?: string; message: string } | null
}

export interface UseAiPendingActionPollingResult {
  action: AiPendingActionCardAction | null
  status: AiPendingActionCardStatus | null
  isPolling: boolean
  error: { code?: string; message: string } | null
  refresh: () => Promise<AiPendingActionCardAction | null>
}

async function fetchPendingAction(
  pendingActionId: string,
  endpoint: string,
): Promise<AiPendingActionFetchResult> {
  const url = `${endpoint}/${encodeURIComponent(pendingActionId)}`
  const call = await apiCallOrThrow<{
    pendingAction?: AiPendingActionCardAction
    error?: string
    code?: string
  }>(url, { method: 'GET' })
  const body = call.result
  if (body?.pendingAction) {
    return { pendingAction: body.pendingAction, error: null }
  }
  if (body?.error) {
    return {
      pendingAction: null,
      error: { message: body.error, code: body.code },
    }
  }
  return { pendingAction: null, error: null }
}

export function useAiPendingActionPolling(
  options: UseAiPendingActionPollingOptions,
): UseAiPendingActionPollingResult {
  const {
    pendingActionId,
    intervalMs = 3000,
    endpoint = '/api/ai_assistant/ai/actions',
    disabled = false,
  } = options

  const [action, setAction] = React.useState<AiPendingActionCardAction | null>(null)
  const [error, setError] = React.useState<{ code?: string; message: string } | null>(null)
  const [isPolling, setIsPolling] = React.useState<boolean>(!disabled)

  const mountedRef = React.useRef(true)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const statusRef = React.useRef<AiPendingActionCardStatus | null>(null)

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refresh = React.useCallback(async (): Promise<AiPendingActionCardAction | null> => {
    if (!pendingActionId) return null
    try {
      const result = await fetchPendingAction(pendingActionId, endpoint)
      if (!mountedRef.current) return result.pendingAction ?? null
      if (result.error) {
        setError(result.error)
      } else {
        setError(null)
      }
      if (result.pendingAction) {
        setAction(result.pendingAction)
        statusRef.current = result.pendingAction.status
      }
      return result.pendingAction
    } catch (err) {
      if (!mountedRef.current) return null
      const message = err instanceof Error ? err.message : 'Failed to load pending action.'
      setError({ message })
      return null
    }
  }, [endpoint, pendingActionId])

  const scheduleNext = React.useCallback(() => {
    clearTimer()
    if (!mountedRef.current) return
    if (disabled) {
      setIsPolling(false)
      return
    }
    if (isTerminal(statusRef.current)) {
      setIsPolling(false)
      return
    }
    setIsPolling(true)
    timerRef.current = setTimeout(async () => {
      await refresh()
      scheduleNext()
    }, intervalMs)
  }, [clearTimer, disabled, intervalMs, refresh])

  React.useEffect(() => {
    mountedRef.current = true
    statusRef.current = null
    if (disabled) {
      setIsPolling(false)
      return () => {
        mountedRef.current = false
        clearTimer()
      }
    }
    setIsPolling(true)
    // Always fetch on mount — the "reconnect behavior" guarantee.
    void refresh().then(() => {
      if (!mountedRef.current) return
      scheduleNext()
    })
    return () => {
      mountedRef.current = false
      clearTimer()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingActionId, endpoint, intervalMs, disabled])

  const status = action?.status ?? null

  return {
    action,
    status,
    isPolling: isPolling && !isTerminal(status),
    error,
    refresh,
  }
}

export default useAiPendingActionPolling
