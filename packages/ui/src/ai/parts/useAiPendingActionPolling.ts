"use client"

import * as React from 'react'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { apiCall } from '../../backend/utils/apiCall'
import type { AiPendingActionCardAction, AiPendingActionCardStatus } from './types'

const logger = createLogger('ui').child({ component: 'useAiPendingActionPolling' })

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
 * - A 404/401/403 from the endpoint is also terminal — the row is gone or
 *   unreachable and retrying cannot help (issue #7550: without this, every
 *   card whose row disappeared polled every 3s forever, in every tab).
 * - Any other failure (5xx, network error) backs off exponentially (capped
 *   at 60s) and gives up after 5 consecutive failures.
 * - Polling pauses while the tab is hidden (`document.visibilityState`) and
 *   resumes on `visibilitychange`.
 * - Expose a `refresh()` force-fetch helper the confirmation card uses after
 *   a confirm POST races with the polling loop. `refresh()` also restarts a
 *   stopped loop (backoff-exhausted or resumed-from-hidden) without
 *   creating a second timer chain.
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

const TERMINAL_HTTP_ERROR_CODES: ReadonlyArray<string> = ['not_found', 'unauthorized', 'forbidden']

const MAX_BACKOFF_MS = 60_000
const MAX_CONSECUTIVE_FAILURES = 5

function isTerminal(status: AiPendingActionCardStatus | null): boolean {
  if (!status) return false
  return TERMINAL_STATUSES.includes(status)
}

function httpStatusToErrorCode(status: number): string | null {
  if (status === 404) return 'not_found'
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  return null
}

function isHiddenDocument(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
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
  ok: boolean
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
  const call = await apiCall<unknown>(url, { method: 'GET' })
  const body = call.result as
    | (Partial<AiPendingActionCardAction> & {
        pendingAction?: AiPendingActionCardAction
        error?: string
        code?: string
      })
    | null
    | undefined

  if (!call.ok) {
    const code = httpStatusToErrorCode(call.status) ?? body?.code ?? 'request_failed'
    const message = body?.error ?? `Request failed with status ${call.status}.`
    return { ok: false, pendingAction: null, error: { code, message } }
  }

  // The GET route returns the bare action object (`serializePendingActionForClient(row)`),
  // but earlier client code expected it under a `pendingAction` envelope.
  // Accept BOTH shapes so the cards work whether the dispatcher wraps or
  // not — bare-object payloads were the actual cause of empty
  // `fieldDiff` and missing `executionResult.error` displays in
  // MutationPreviewCard / ConfirmationCard / MutationResultCard.
  if (body && typeof body === 'object') {
    if (body.pendingAction) {
      return { ok: true, pendingAction: body.pendingAction, error: null }
    }
    if (
      typeof (body as Partial<AiPendingActionCardAction>).id === 'string' &&
      typeof (body as Partial<AiPendingActionCardAction>).status === 'string'
    ) {
      return { ok: true, pendingAction: body as AiPendingActionCardAction, error: null }
    }
    if (body.error) {
      return {
        ok: true,
        pendingAction: null,
        error: { message: body.error, code: body.code },
      }
    }
  }
  return { ok: true, pendingAction: null, error: null }
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
  const terminalErrorCodeRef = React.useRef<string | null>(null)
  const consecutiveFailuresRef = React.useRef(0)
  const stoppedRef = React.useRef(false)
  const hiddenRef = React.useRef(isHiddenDocument())
  const scheduleNextRef = React.useRef<() => void>(() => {})

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const refresh = React.useCallback(async (): Promise<AiPendingActionCardAction | null> => {
    if (!pendingActionId) return null
    let pendingAction: AiPendingActionCardAction | null = null
    try {
      const result = await fetchPendingAction(pendingActionId, endpoint)
      if (!mountedRef.current) return result.pendingAction ?? null
      pendingAction = result.pendingAction ?? null
      if (result.ok) {
        consecutiveFailuresRef.current = 0
        stoppedRef.current = false
        terminalErrorCodeRef.current = null
        setError(result.error ?? null)
        if (result.pendingAction) {
          setAction(result.pendingAction)
          statusRef.current = result.pendingAction.status
        }
      } else {
        setError(result.error ?? null)
        const code = result.error?.code
        if (code && TERMINAL_HTTP_ERROR_CODES.includes(code)) {
          terminalErrorCodeRef.current = code
        } else {
          consecutiveFailuresRef.current += 1
          if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
            stoppedRef.current = true
          }
        }
      }
    } catch (err) {
      logger.error('Failed to load the pending AI action', { err, pendingActionId })
      if (!mountedRef.current) return null
      const message = err instanceof Error ? err.message : 'Failed to load pending action.'
      setError({ message })
      consecutiveFailuresRef.current += 1
      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
        stoppedRef.current = true
      }
    }
    if (mountedRef.current) {
      scheduleNextRef.current()
    }
    return pendingAction
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
    if (terminalErrorCodeRef.current) {
      setIsPolling(false)
      return
    }
    if (stoppedRef.current) {
      setIsPolling(false)
      return
    }
    if (hiddenRef.current) {
      // Paused while the tab is hidden. `visibilitychange` resumes via refresh().
      return
    }
    setIsPolling(true)
    const delay =
      consecutiveFailuresRef.current > 0
        ? Math.min(intervalMs * 2 ** consecutiveFailuresRef.current, MAX_BACKOFF_MS)
        : intervalMs
    timerRef.current = setTimeout(() => {
      void refresh()
    }, delay)
  }, [clearTimer, disabled, intervalMs, refresh])

  React.useEffect(() => {
    scheduleNextRef.current = scheduleNext
  }, [scheduleNext])

  React.useEffect(() => {
    if (disabled) return
    const handleVisibilityChange = () => {
      const wasHidden = hiddenRef.current
      hiddenRef.current = isHiddenDocument()
      if (!wasHidden && hiddenRef.current) {
        // Cancel any already-scheduled poll immediately — do not wait for
        // it to fire before honoring the pause.
        clearTimer()
        return
      }
      if (wasHidden && !hiddenRef.current && mountedRef.current) {
        // Resume immediately rather than waiting out a stale backoff delay.
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [clearTimer, disabled, refresh])

  React.useEffect(() => {
    mountedRef.current = true
    statusRef.current = null
    terminalErrorCodeRef.current = null
    consecutiveFailuresRef.current = 0
    stoppedRef.current = false
    if (disabled) {
      setIsPolling(false)
      return () => {
        mountedRef.current = false
        clearTimer()
      }
    }
    setIsPolling(true)
    // Always fetch on mount — the "reconnect behavior" guarantee. `refresh`
    // schedules the next poll itself once it settles.
    void refresh()
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
