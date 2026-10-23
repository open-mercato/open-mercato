import { evaluateReadiness, isReadyToSend, remainingCount } from '../engine/readiness'

const nothing = {
  emailChannelConfigured: false,
  trackingSecretConfigured: false,
  publicBaseUrlConfigured: false,
  campaignCount: 0,
  enabledCampaignCount: 0,
  runCount: 0,
  segmentCount: 0,
  contentBlockCount: 0,
  // False, not null: "the scheduler is installed and this module is not on it" is the state this check
  // exists to catch, and a fresh installation has not registered them yet.
  schedulesRegistered: false,
}

describe('evaluateReadiness', () => {
  it('says nothing will be delivered on a fresh installation', () => {
    const checks = evaluateReadiness(nothing)
    expect(isReadyToSend(checks)).toBe(false)
    expect(remainingCount(checks)).toBe(checks.length)
  })

  it('treats tracking as blocking, because without it nothing is sent at all', () => {
    const blocking = evaluateReadiness(nothing).filter((check) => check.severity === 'blocking').map((check) => check.id)
    /**
     * Tracking used to be 'recommended' on the reasoning that a message without it still arrives, only
     * unmeasured. It does not arrive: the signing secret is what builds the unsubscribe link, and a marketing
     * send that cannot offer a way out is refused in `sendEmailStep`. A checklist calling that optional would
     * leave an operator reading "recommended" beside a campaign that silently skips every send.
     */
    expect(blocking).toEqual(['email_channel', 'tracking', 'first_campaign', 'publish'])
  })

  it('is not ready while tracking is missing, however much else is in place', () => {
    const checks = evaluateReadiness({
      ...nothing,
      emailChannelConfigured: true,
      campaignCount: 1,
      enabledCampaignCount: 1,
    })
    expect(isReadyToSend(checks)).toBe(false)
    expect(checks.find((check) => check.id === 'tracking')?.done).toBe(false)
  })

  it('is ready once the blocking four are in place, even with nothing else', () => {
    const checks = evaluateReadiness({
      ...nothing,
      emailChannelConfigured: true,
      trackingSecretConfigured: true,
      publicBaseUrlConfigured: true,
      campaignCount: 1,
      enabledCampaignCount: 1,
    })
    expect(isReadyToSend(checks)).toBe(true)
    // Still has recommendations outstanding, and says so.
    expect(remainingCount(checks)).toBeGreaterThan(0)
  })

  it('needs BOTH halves of tracking, because a secret without a base URL builds no links', () => {
    const secretOnly = evaluateReadiness({ ...nothing, trackingSecretConfigured: true })
    expect(secretOnly.find((check) => check.id === 'tracking')?.done).toBe(false)
    const both = evaluateReadiness({ ...nothing, trackingSecretConfigured: true, publicBaseUrlConfigured: true })
    expect(both.find((check) => check.id === 'tracking')?.done).toBe(true)
  })

  it('counts a campaign that exists but is not enabled as one step, not two', () => {
    const checks = evaluateReadiness({ ...nothing, campaignCount: 2 })
    expect(checks.find((check) => check.id === 'first_campaign')?.done).toBe(true)
    expect(checks.find((check) => check.id === 'publish')?.done).toBe(false)
  })

  it('is ordered by dependency, so somebody can work top to bottom', () => {
    // No point publishing a campaign that cannot send, or writing segments before a campaign exists.
    expect(evaluateReadiness(nothing).map((check) => check.id)).toEqual([
      'email_channel',
      'tracking',
      'first_campaign',
      'publish',
      'first_run',
      'schedules',
      'segments',
      'content_blocks',
    ])
  })

  /**
   * The check that exists because this module had no way of telling an operator their scheduled campaigns
   * were never going to run.
   *
   * `setup.ts` registers the two periodic jobs from `onTenantCreated` and `seedDefaults`, so a tenant that
   * predates the module has neither until somebody re-runs setup — and nothing anywhere said so. Every
   * win-back, review request, birthday and reorder reminder silently does nothing, along with the safety net
   * that resumes a wait whose delayed job was lost. Found on a real installation: thirteen scheduled jobs,
   * none of them this module's.
   */
  describe('the scheduled half of the module', () => {
    it('is reported missing when the scheduler is there and this module is not on it', () => {
      const check = evaluateReadiness({ ...nothing, schedulesRegistered: false }).find((c) => c.id === 'schedules')
      expect(check?.done).toBe(false)
    })

    it('is satisfied once both jobs are registered', () => {
      const check = evaluateReadiness({ ...nothing, schedulesRegistered: true }).find((c) => c.id === 'schedules')
      expect(check?.done).toBe(true)
    })

    it('says nothing when the scheduler is not installed at all', () => {
      // An optional peer. An installation without it has no scheduled campaigns by design, and telling that
      // operator they are missing something would be telling them to fix a choice they made.
      const check = evaluateReadiness({ ...nothing, schedulesRegistered: null }).find((c) => c.id === 'schedules')
      expect(check?.done).toBe(true)
    })

    it('never blocks sending', () => {
      // Event-triggered campaigns work without a scheduler at all; this is a gap, not a stoppage.
      const check = evaluateReadiness({ ...nothing, schedulesRegistered: false }).find((c) => c.id === 'schedules')
      expect(check?.severity).toBe('recommended')
    })
  })

  it('reports a first run only once one has happened', () => {
    expect(evaluateReadiness({ ...nothing, runCount: 1 }).find((check) => check.id === 'first_run')?.done).toBe(true)
  })
})
