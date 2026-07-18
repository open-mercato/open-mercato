/**
 * Pure inactivity-timer core for the operator "lite" panel auto-logout
 * (task 4.3). Deliberately framework-agnostic (no DOM/React) so it is
 * unit-testable with fake timers; `useInactivityLogout.ts` wraps this with
 * `window` activity-event listeners and the actual logout call.
 */
export const DEFAULT_INACTIVITY_TIMEOUT_MINUTES = 15

export type InactivityTimerOptions = {
  timeoutMs: number
  onTimeout: () => void
}

export type InactivityTimer = {
  /** Cancels the pending timeout and starts a fresh one. */
  registerActivity: () => void
  /** Cancels the pending timeout permanently (no further onTimeout calls). */
  stop: () => void
}

export function createInactivityTimer({ timeoutMs, onTimeout }: InactivityTimerOptions): InactivityTimer {
  let handle: ReturnType<typeof setTimeout> | null = setTimeout(onTimeout, timeoutMs)

  const registerActivity = () => {
    if (handle !== null) clearTimeout(handle)
    handle = setTimeout(onTimeout, timeoutMs)
  }

  const stop = () => {
    if (handle !== null) clearTimeout(handle)
    handle = null
  }

  return { registerActivity, stop }
}
