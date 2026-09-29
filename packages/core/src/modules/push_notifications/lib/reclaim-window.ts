// Single source of truth for the stuck-reclaim window. The reaper uses it to decide when a `sending`
// row is abandoned; the send path uses it to bound a single provider send so a hung call can never
// outlive the window (which would let the reaper reclaim the row mid-send). Keeping both on one resolver
// guarantees the send timeout stays below the reclaim threshold — see push-delivery.ts.
//
// A floor of MIN_STUCK_MINUTES is enforced: `0` (the old "reclaim on the next tick") is UNSAFE because
// `cutoff = now` matches an actively-`sending` row whose `updated_at` was stamped at claim, re-opening
// an in-flight send. Sub-floor / negative / non-numeric values fall back to the default.
export const DEFAULT_STUCK_MINUTES = 5
export const MIN_STUCK_MINUTES = 1

export function resolveStuckThresholdMs(): number {
  const raw = Number.parseInt(process.env.OM_PUSH_STUCK_RECLAIM_MINUTES ?? '', 10)
  const minutes = Number.isFinite(raw) && raw >= MIN_STUCK_MINUTES ? raw : DEFAULT_STUCK_MINUTES
  return minutes * 60 * 1000
}
