import { planSteps } from './chain-planner.js'
import { flattenSteps } from './split.js'
import {
  isFrequencyCapped,
  isPaused,
  isWithinQuietHours,
  nextAllowedSendTime,
  nextOccurrenceOfHour,
  preferenceCap,
} from './gates.js'
import type { ContactPreference } from './gates.js'
import type { FrequencyCap, QuietHoursWindow } from './gates.js'
import type { StepHandler } from './registry.js'
import type { AutomationContext, CampaignStep, EngineLogger, StepOutcome } from './types.js'
import { redactEmails } from '../redact.js'

export type SendPolicy = {
  /**
   * Defer a send to the hour this customer usually opens email.
   *
   * Off unless the author asked for it: moving a send is a visible behaviour change, and a campaign
   * whose timing silently depends on per-customer history is hard to reason about when it is not
   * requested.
   */
  optimizeSendTime?: boolean
  frequencyCap: FrequencyCap | null
  quietHours: QuietHoursWindow | null
}

/** The mutable part of a run, as a plain shape so the executor can be tested without a database. */
export type RunState = {
  id: string
  campaignId: string
  currentStepIndex: number
  stepLog: StepOutcome[]
  context: AutomationContext
  subjectEntityId?: string | null
}

/**
 * What the persistence layer should do with the run once the executor stops.
 *
 * Returned rather than written here so the sequencing logic is testable in isolation and the
 * transaction boundary stays with the caller.
 */
export type RunTransition =
  | { kind: 'completed'; stepLog: StepOutcome[]; context: AutomationContext }
  | { kind: 'waiting'; resumeAt: Date; nextStepIndex: number; stepLog: StepOutcome[]; context: AutomationContext; reason: 'wait' | 'quiet_hours' | 'send_time' | 'paused' }
  /**
   * A step threw.
   *
   * Carries the progress made BEFORE the failure and the index of the step that failed, so the
   * retry resumes AT that step. Without this the executor would report nothing on failure and the
   * caller would park the run at its original index — replaying every completed step, which for a
   * chain containing a send means mailing the customer again on every one of the five attempts.
   */
  | { kind: 'failed'; failedIndex: number; error: unknown; stepLog: StepOutcome[]; context: AutomationContext }

export type ExecutorSideEffects<TDeps> = {
  getStep(type: string): StepHandler<TDeps> | undefined
  /** Messages already sent to this subject since the given instant, across ALL campaigns. */
  countSendsSince(subjectEntityId: string, since: Date): Promise<number>
  /**
   * Records an outbound attempt. Deliberately carries no address: the subject id identifies the
   * recipient, and this history is append-only, so an address here would be a permanent
   * unencrypted PII trail beside a column the platform encrypts.
   */
  recordSend(entry: {
    channel: NonNullable<StepHandler<TDeps>['channel']>
    /** `failed` is recorded too, so a campaign being refused by the transport is visible as refusal. */
    status: 'sent' | 'suppressed' | 'failed'
    stepId: string
    suppressionReason?: string | null
  }): Promise<void>
  /**
   * Whether this channel is refused for this subject.
   *
   * Consulted BEFORE every other send gate, because the others are about timing and this one is about
   * permission: deferring a message the customer asked not to receive would only send it later.
   */
  isChannelSuppressed(subjectEntityId: string | null | undefined, channel: string): Promise<boolean>
  /**
   * What the recipient asked for themselves: their own cap and any pause.
   *
   * A separate effect from the policy because it is the CUSTOMER's instruction rather than the campaign's
   * configuration, and the two are read from different places for different reasons.
   */
  loadContactPreference(subjectEntityId: string | null | undefined): Promise<ContactPreference | null>
  /** The subject's own timezone; quiet hours are meaningless in server time. */
  resolveTimeZone(subjectEntityId: string | null | undefined): Promise<string>
  /**
   * The hour this subject usually opens email, or null when there is not enough history.
   *
   * Injected rather than queried here so the executor stays pure, and consulted ONLY when the policy
   * asks for it — it is a query per send, and an unused one would be pure cost.
   */
  resolvePreferredSendHour(subjectEntityId: string | null | undefined): Promise<number | null>
  logger: EngineLogger
  now: Date
}

function outcome(step: CampaignStep, status: StepOutcome['status'], at: Date, detail?: string): StepOutcome {
  return { stepId: step.id, type: step.type, status, at: at.toISOString(), detail }
}

/**
 * Runs a campaign's steps for one subject, from wherever the run currently sits.
 *
 * Two different kinds of "stop" are deliberately distinguished, because they mean opposite
 * things for the step that caused them:
 *
 *  - a `wait` step has finished its job, so the run resumes AFTER it;
 *  - quiet hours have not yet let the message out, so the run resumes AT the same step.
 *
 * Conflating them would either skip a send or send it twice.
 */
export async function executeRun<TDeps>(
  run: RunState,
  steps: CampaignStep[],
  policy: SendPolicy,
  deps: TDeps,
  effects: ExecutorSideEffects<TDeps>,
): Promise<RunTransition> {
  const { logger, now } = effects
  const stepLog = [...run.stepLog]
  const context: AutomationContext = { ...run.context }

  // Splits are resolved into this subject's own lane BEFORE planning, so the executor and the
  // planner stay index-based and `current_step_index` keeps meaning the same thing. The lane choice
  // is derived from the step id and the subject, so the same flattening is reproduced on every
  // resume — without that, a run pausing inside a lane could come back in the other one and the
  // customer would receive a mixture of both variants.
  const effectiveSteps = flattenSteps(steps, run.subjectEntityId || run.id)

  for (const planned of planSteps(effectiveSteps, run.currentStepIndex)) {
    if (planned.kind === 'pause') {
      return {
        kind: 'waiting',
        reason: 'wait',
        resumeAt: new Date(now.getTime() + planned.minutes * 60_000),
        nextStepIndex: planned.resumeIndex,
        stepLog,
        context,
      }
    }

    const { step, index } = planned
    const handler = effects.getStep(step.type)

    if (!handler) {
      // Fail open per step: a step type disappears when the module contributing it is
      // disabled, and stopping the whole journey over it would punish the customer for an
      // installation change.
      logger.warn('[internal] unknown marketing step type, skipping', { type: step.type, campaignId: run.campaignId })
      stepLog.push(outcome(step, 'skipped', now, 'unknown step type'))
      continue
    }

    if (handler.channel) {
      /**
       * Permission first, timing second.
       *
       * A customer who unsubscribed is not "not yet" — they are "no", so this drops the message rather
       * than deferring it, and records the suppression so the reason is visible in reporting instead of
       * the message simply never appearing.
       */
      if (await effects.isChannelSuppressed(run.subjectEntityId, handler.channel)) {
        await effects.recordSend({
          channel: handler.channel,
          status: 'suppressed',
          stepId: step.id,
          suppressionReason: 'unsubscribed',
        })
        stepLog.push(outcome(step, 'skipped', now, 'unsubscribed'))
        continue
      }

      /**
       * The recipient's own instructions, read once for both checks below.
       *
       * Their pause defers and their cap drops, which mirrors the campaign's own gates: a timing instruction
       * moves the message, a volume limit means this particular message does not go.
       */
      const preference = await effects.loadContactPreference(run.subjectEntityId)

      const timeZone = await effects.resolveTimeZone(run.subjectEntityId)

      /**
       * One deferral decision, in this order: move the send to the customer's usual hour if the policy
       * asks, then push it out of quiet hours.
       *
       * The order matters and only one of the two orders is defensible. Quiet hours are a promise to the
       * customer; the preferred hour is an optimisation, so the optimisation proposes and quiet hours
       * dispose — never the reverse, which could land an "optimised" send at 3am.
       */
      let sendAt = now
      if (policy.optimizeSendTime) {
        const preferredHour = await effects.resolvePreferredSendHour(run.subjectEntityId)
        if (preferredHour !== null) {
          const proposed = nextOccurrenceOfHour(preferredHour, timeZone, sendAt)
          /**
           * An optimisation quiet hours would forbid is DISCARDED, not pushed.
           *
           * Pushing it was an infinite loop: a customer who usually opens at 3am, with quiet hours 22→08, got
           * 03:00 proposed and 08:00 imposed, so the run parked until 08:00 — and on resume proposed 03:00
           * tomorrow and parked again, every day, forever. `applyTransition` resets the attempt counter on every
           * wait, so no retry budget ever caught it and a resume job was re-enqueued daily in perpetuity.
           *
           * Discarding keeps the stated order intact — the optimisation proposes, quiet hours dispose — and the
           * message goes at the first hour the customer allows instead of never.
           */
          if (!isWithinQuietHours(policy.quietHours, timeZone, proposed)) sendAt = proposed
        }
      }
      sendAt = nextAllowedSendTime(policy.quietHours, timeZone, sendAt)

      /**
       * A customer pause outranks both, because it is the only one of the three the CUSTOMER set.
       *
       * Applied after the other two rather than before: if their pause ends inside quiet hours, the message
       * still must not arrive at 3am, and taking the later of the two instants is the only reading that keeps
       * both promises.
       */
      if (isPaused(preference, sendAt) && preference?.pausedUntil) {
        sendAt = new Date(Math.max(sendAt.getTime(), preference.pausedUntil.getTime()))
        sendAt = nextAllowedSendTime(policy.quietHours, timeZone, sendAt)
      }

      if (sendAt.getTime() > now.getTime()) {
        // Deferred, not dropped — and the run resumes at THIS step so the message still goes.
        return {
          kind: 'waiting',
          reason: isPaused(preference, now)
            ? 'paused'
            : isWithinQuietHours(policy.quietHours, timeZone, now) ? 'quiet_hours' : 'send_time',
          resumeAt: sendAt,
          nextStepIndex: index,
          stepLog,
          context,
        }
      }

      /**
       * The recipient's own cap, checked as a second cap rather than merged with the campaign's.
       *
       * "Three a week" and the shop's "two a day" both have exact answers only when each is evaluated in its
       * own window; merging them would mean normalising two windows into one and getting a different number
       * from either.
       */
      const ownCap = preferenceCap(preference)
      if (ownCap && run.subjectEntityId) {
        const since = new Date(now.getTime() - ownCap.windowHours * 3_600_000)
        const alreadySent = await effects.countSendsSince(run.subjectEntityId, since)
        if (isFrequencyCapped(alreadySent, ownCap)) {
          await effects.recordSend({
            channel: handler.channel,
            status: 'suppressed',
            stepId: step.id,
            suppressionReason: 'preference_cap',
          })
          stepLog.push(outcome(step, 'skipped', now, 'recipient frequency preference'))
          continue
        }
      }

      if (policy.frequencyCap && run.subjectEntityId) {
        const since = new Date(now.getTime() - policy.frequencyCap.windowHours * 3_600_000)
        const alreadySent = await effects.countSendsSince(run.subjectEntityId, since)
        if (isFrequencyCapped(alreadySent, policy.frequencyCap)) {
          // Dropped permanently rather than deferred: the point of a cap is that the customer
          // does not receive this message, and deferring would only move the flood later.
          // Recorded so the suppression is visible in reporting instead of vanishing.
          await effects.recordSend({
            channel: handler.channel,
            status: 'suppressed',
            stepId: step.id,
            suppressionReason: 'frequency_cap',
          })
          stepLog.push(outcome(step, 'skipped', now, 'frequency cap'))
          continue
        }
      }
    }

    let result: Awaited<ReturnType<typeof handler.execute>>
    try {
      result = await handler.execute({ ...context, actionId: step.id, runId: run.id }, step.params, deps)
    } catch (error) {
      /**
       * A failed SEND is recorded as one, not just as a failed run.
       *
       * Without this, a campaign whose every message is rejected by the transport looks quiet rather than
       * broken: the delivery figures count what went out and nothing counts what did not, so the
       * deliverability guardrail would have no signal and the results screen would understate the problem as
       * "fewer sends". Recorded before the transition, and never with the transport's own text — that quotes
       * the address it rejected.
       */
      if (handler.channel) {
        try {
          await effects.recordSend({ channel: handler.channel, status: 'failed', stepId: step.id })
        } catch {
          // Bookkeeping must not replace the real error with its own.
        }
      }
      // Progress is reported rather than thrown away — see the `failed` transition. The message is
      // redacted because it is third-party text that will be persisted to jsonb and returned by the
      // runs API: a transport rejection quotes the address it rejected, and this module keeps
      // addresses out of both.
      stepLog.push(outcome(step, 'failed', now, redactEmails(error instanceof Error ? error.message : String(error))))
      return { kind: 'failed', failedIndex: index, error, stepLog, context }
    }

    if (handler.channel && result.status === 'done') {
      try {
        await effects.recordSend({ channel: handler.channel, status: 'sent', stepId: step.id })
      } catch (error) {
        /**
         * The message HAS gone out. A throw here would escape into the caller's outer catch, which
         * parks the run at the index it started from — so the retry would send it again. Reporting it
         * as a failure AT THIS STEP keeps the retry on the step that already sent, which the run's
         * own `alreadySent`-shaped accounting cannot undo; so instead the bookkeeping failure is
         * logged and the chain continues.
         *
         * The consequence is a send that happened and was not recorded: the frequency cap and the
         * reports undercount it. That is strictly better than mailing the customer twice, which is
         * what every other option here does.
         */
        logger.error('[internal] marketing send recorded failed after the message went out', {
          campaignId: run.campaignId,
          stepId: step.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (result.contextPatch) Object.assign(context, result.contextPatch)
    stepLog.push(outcome(step, result.status === 'done' ? 'done' : 'skipped', now, result.detail))
  }

  return { kind: 'completed', stepLog, context }
}
