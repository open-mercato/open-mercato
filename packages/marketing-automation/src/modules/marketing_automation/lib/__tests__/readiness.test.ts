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
}

describe('evaluateReadiness', () => {
  it('says nothing will be delivered on a fresh installation', () => {
    const checks = evaluateReadiness(nothing)
    expect(isReadyToSend(checks)).toBe(false)
    expect(remainingCount(checks)).toBe(checks.length)
  })

  it('treats the email channel and a published campaign as blocking, and tracking as not', () => {
    const blocking = evaluateReadiness(nothing).filter((check) => check.severity === 'blocking').map((check) => check.id)
    // Without a channel or an enabled campaign nothing can arrive; without tracking it arrives unmeasured,
    // which is a reason to fix it rather than a reason to stop.
    expect(blocking).toEqual(['email_channel', 'first_campaign', 'publish'])
  })

  it('is ready once the blocking three are in place, even with nothing else', () => {
    const checks = evaluateReadiness({
      ...nothing,
      emailChannelConfigured: true,
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
      'segments',
      'content_blocks',
    ])
  })

  it('reports a first run only once one has happened', () => {
    expect(evaluateReadiness({ ...nothing, runCount: 1 }).find((check) => check.id === 'first_run')?.done).toBe(true)
  })
})
