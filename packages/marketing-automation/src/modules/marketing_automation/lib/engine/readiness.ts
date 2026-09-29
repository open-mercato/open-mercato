/**
 * Whether this installation can actually run a campaign, expressed as checks.
 *
 * Pure: each check is a verdict over facts somebody else gathered. The value of a first-run screen is entirely
 * in the accuracy of these verdicts — a wizard that says "ready" and then sends nothing is worse than no wizard
 * — so the rules live here where they can be tested without a database.
 */

export type ReadinessFacts = {
  /** A tenant-wide email channel exists, without which every send fails at the transport. */
  emailChannelConfigured: boolean
  /** A signing secret exists, without which opens, clicks, unsubscribes and hooks cannot be issued. */
  trackingSecretConfigured: boolean
  /** A public base URL exists, without which those links cannot be built even with a secret. */
  publicBaseUrlConfigured: boolean
  campaignCount: number
  enabledCampaignCount: number
  /** Whether any campaign has ever produced a run, which is the only proof the wiring works end to end. */
  runCount: number
  segmentCount: number
  contentBlockCount: number
}

export type ReadinessCheckId =
  | 'email_channel'
  | 'tracking'
  | 'first_campaign'
  | 'publish'
  | 'first_run'
  | 'segments'
  | 'content_blocks'

export type ReadinessCheck = {
  id: ReadinessCheckId
  /** `blocking` means nothing will be delivered until it is done. */
  severity: 'blocking' | 'recommended'
  done: boolean
  /** Where to go and fix it, when there is somewhere. */
  href?: string
}

/**
 * The checklist, in the order somebody should work through it.
 *
 * Ordered by dependency rather than by importance: there is no point publishing a campaign that cannot send,
 * and no point writing segments before there is a campaign to use them in.
 */
export function evaluateReadiness(facts: ReadinessFacts): ReadinessCheck[] {
  return [
    {
      id: 'email_channel',
      severity: 'blocking',
      done: facts.emailChannelConfigured,
      href: '/backend/settings/communication-channels',
    },
    {
      id: 'tracking',
      // Recommended, not blocking: a campaign without tracking still sends, it just cannot report or offer a
      // one-click unsubscribe — which is a reason to fix it, not a reason to stop.
      severity: 'recommended',
      done: facts.trackingSecretConfigured && facts.publicBaseUrlConfigured,
    },
    {
      id: 'first_campaign',
      severity: 'blocking',
      done: facts.campaignCount > 0,
      href: '/backend/marketing/campaigns',
    },
    {
      id: 'publish',
      severity: 'blocking',
      done: facts.enabledCampaignCount > 0,
      href: '/backend/marketing/campaigns',
    },
    {
      id: 'first_run',
      severity: 'recommended',
      done: facts.runCount > 0,
    },
    {
      id: 'segments',
      severity: 'recommended',
      done: facts.segmentCount > 0,
      href: '/backend/marketing/segments',
    },
    {
      id: 'content_blocks',
      severity: 'recommended',
      done: facts.contentBlockCount > 0,
      href: '/backend/marketing/content-blocks',
    },
  ]
}

/** Nothing will be delivered until every blocking check passes, which is the sentence the screen leads with. */
export function isReadyToSend(checks: ReadinessCheck[]): boolean {
  return checks.every((check) => check.severity !== 'blocking' || check.done)
}

export function remainingCount(checks: ReadinessCheck[]): number {
  return checks.filter((check) => !check.done).length
}
