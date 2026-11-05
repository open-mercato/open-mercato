// A claimed-but-crashed deferred-provisioning runner must become reclaimable
// fast enough that the preparing page's ~1s status polling can recover it within
// seconds — not strand the workspace on "preparing" for minutes. A live runner
// renews its lease on a steady PREPARATION_HEARTBEAT_MS cadence (see
// deferred-provisioning.ts), so this window only needs comfortable headroom over
// that heartbeat (here 6×) to never reclaim a runner that is genuinely working.
export const PREPARATION_CLAIM_STALE_MS = 30 * 1000

export function isPreparationClaimActive(startedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!startedAt) return false
  return startedAt.getTime() > now.getTime() - PREPARATION_CLAIM_STALE_MS
}
