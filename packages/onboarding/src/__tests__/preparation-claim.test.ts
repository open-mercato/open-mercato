import {
  PREPARATION_CLAIM_STALE_MS,
  isPreparationClaimActive,
} from '@open-mercato/onboarding/modules/onboarding/lib/preparation-claim'

describe('preparation claim staleness', () => {
  const now = new Date('2026-06-15T12:00:00.000Z')

  it('treats a null lease as inactive (reclaimable)', () => {
    expect(isPreparationClaimActive(null, now)).toBe(false)
    expect(isPreparationClaimActive(undefined, now)).toBe(false)
  })

  it('treats a freshly-renewed lease as active', () => {
    const justRenewed = new Date(now.getTime() - 1_000)
    expect(isPreparationClaimActive(justRenewed, now)).toBe(true)
  })

  it('treats a lease older than the stale window as reclaimable', () => {
    const crashedRunner = new Date(now.getTime() - PREPARATION_CLAIM_STALE_MS - 1)
    expect(isPreparationClaimActive(crashedRunner, now)).toBe(false)
  })

  it('keeps the stale window short enough for status-poll recovery', () => {
    // The preparing page polls status every ~1s and recovers a crashed runner by
    // re-scheduling deferred provisioning once the lease goes stale. A multi-
    // minute window (the historical 10 minutes) stranded the workspace on
    // "preparing". Guard against regressing back to a long window.
    expect(PREPARATION_CLAIM_STALE_MS).toBeLessThanOrEqual(60_000);
  })
})
