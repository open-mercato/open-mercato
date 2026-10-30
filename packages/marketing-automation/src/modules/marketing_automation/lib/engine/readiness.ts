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
  /**
   * Whether the module's two periodic jobs are registered with the scheduler.
   *
   * `setup.ts` registers them from `onTenantCreated` and `seedDefaults`, so a tenant that existed before this
   * module was installed has neither until somebody re-runs setup. Nothing else notices: campaigns still save,
   * event-triggered ones still fire, and the screen that exists to answer "is this ready" never asked. Every
   * SCHEDULED campaign — win-back, review requests, birthdays, reorder reminders — then silently never runs,
   * and so does the safety net that resumes a wait whose delayed job was lost.
   *
   * Null when the scheduler is not installed at all, which is a legitimate configuration rather than a fault:
   * it is an optional peer, and an installation without it simply has no scheduled campaigns.
   */
  schedulesRegistered: boolean | null
}

export type ReadinessCheckId =
  | 'email_channel'
  | 'tracking'
  | 'first_campaign'
  | 'publish'
  | 'first_run'
  | 'schedules'
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
      href: '/backend/profile/communication-channels',
    },
    {
      id: 'tracking',
      /**
       * Blocking, because without it nothing sends.
       *
       * This was 'recommended' on the reasoning that a campaign without tracking still sends and merely
       * cannot report. It no longer does: the signing secret is also what builds the unsubscribe link, and
       * `sendEmailStep` refuses a marketing send it cannot give an opt-out — so an unconfigured install
       * skips every send. Advising about that would be advising about silence.
       */
      severity: 'blocking',
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
      /**
       * Recommended rather than blocking, and only when the scheduler is actually installed.
       *
       * An installation without the scheduler has no scheduled campaigns by design, and telling that operator
       * they are missing something would be wrong. An installation WITH it and without these two is missing
       * every periodic campaign and does not know.
       */
      id: 'schedules',
      /**
       * `recommended`, and deliberately so — this was re-examined and the grade is right.
       *
       * An audit proposed grading it `blocking` where the scheduler is installed and these two jobs are not,
       * reasoning that every periodic campaign then silently never runs. The consequence is real; the grade
       * would not be. `blocking` is defined one screen down as "nothing will be delivered until it is done", and
       * an installation without a scheduler still delivers every EVENT-triggered campaign. Calling it blocking
       * would make `isReadyToSend` answer a question it was not asked, and tell an operator whose welcome
       * sequence is working perfectly that nothing can send.
       *
       * The real gap the audit found is in the WORDING on the setup screen, not in this severity: "Ready to
       * send" is true and incomplete. That is fixed where it is said, not by mislabelling the fact here.
       */
      severity: 'recommended',
      done: facts.schedulesRegistered !== false,
      href: '/backend/config/scheduled-jobs',
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
