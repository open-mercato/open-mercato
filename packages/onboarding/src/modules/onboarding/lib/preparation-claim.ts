export const PREPARATION_CLAIM_STALE_MS = 10 * 60 * 1000

export function isPreparationClaimActive(startedAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!startedAt) return false
  return startedAt.getTime() > now.getTime() - PREPARATION_CLAIM_STALE_MS
}
