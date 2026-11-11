// Step 4.8 — §9/§12's configurable sweeper windows. Follows the env-var-with-default
// convention this module (and push_notifications/lib/reclaim-window.ts,
// communication_channels/setup.ts's POLL_TICK_INTERVAL_SECONDS) already uses: a module-local
// constant, read once from `process.env`, clamped to a safe floor, falling back to the spec's
// documented default when unset or invalid. Not a new config system.

const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
export const DAY_MS = 24 * HOUR_MS

/** §9 `active → abandoned`: "no activity for 24 h (configurable)". */
export const DEFAULT_INACTIVITY_WINDOW_HOURS = 24
const MIN_INACTIVITY_WINDOW_HOURS = 1

export function resolveCartInactivityWindowMs(): number {
  const raw = Number.parseInt(process.env.CART_INACTIVITY_WINDOW_HOURS ?? '', 10)
  const hours = Number.isFinite(raw) && raw >= MIN_INACTIVITY_WINDOW_HOURS ? raw : DEFAULT_INACTIVITY_WINDOW_HOURS
  return hours * HOUR_MS
}

/**
 * §9 `locked → active`: "a lock timeout (default 30 min)". `release-stale-locks` itself
 * compares against the already-stored `Cart.lockExpiresAt` column, so it does not call this
 * directly — it is `commands/lock.ts`'s `cart.lock` (Step 7.5) that calls this, computing
 * `lockExpiresAt = lockedAt + this value` when a lock is acquired.
 */
export const DEFAULT_LOCK_TIMEOUT_MINUTES = 30
const MIN_LOCK_TIMEOUT_MINUTES = 1

export function resolveCartLockTimeoutMs(): number {
  const raw = Number.parseInt(process.env.CART_LOCK_TIMEOUT_MINUTES ?? '', 10)
  const minutes = Number.isFinite(raw) && raw >= MIN_LOCK_TIMEOUT_MINUTES ? raw : DEFAULT_LOCK_TIMEOUT_MINUTES
  return minutes * MINUTE_MS
}

/**
 * §12 `purge-expired-carts`: "Hard-delete carts expired more than 90 days ago" — fixed per the
 * spec's own table. Only the inactivity window and the lock timeout are called out as
 * configurable; this stays a constant rather than growing a third env knob.
 */
export const PURGE_RETENTION_DAYS = 90
