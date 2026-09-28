import { planSteps } from './chain-planner.js'
import { flattenSteps } from './split.js'
import { isFrequencyCapped, isWithinQuietHours, nextAllowedSendTime, nextOccurrenceOfHour } from './gates.js'
import type { FrequencyCap, QuietHoursWindow } from './gates.js'
import type { StepHandler } from './registry.js'
import type { AutomationContext, CampaignStep, EngineLogger, StepOutcome } from './types.js'

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
  | { kind: 'waiting'; resumeAt: Date; nextStepIndex: number; stepLog: StepOutcome[]; context: AutomationContext; reason: 'wait' | 'quiet_hours' | 'send_time' }
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
    status: 'sent' | 'suppressed'
    stepId: string
    suppressionReason?: string | null
  }): Promise<void>
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
        if (preferredHour !== null) sendAt = nextOccurrenceOfHour(preferredHour, timeZone, sendAt)
      }
      sendAt = nextAllowedSendTime(policy.quietHours, timeZone, sendAt)

      if (sendAt.getTime() > now.getTime()) {
        // Deferred, not dropped — and the run resumes at THIS step so the message still goes.
        return {
          kind: 'waiting',
          reason: isWithinQuietHours(policy.quietHours, timeZone, now) ? 'quiet_hours' : 'send_time',
          resumeAt: sendAt,
          nextStepIndex: index,
          stepLog,
          context,
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
      // Progress is reported rather than thrown away — see the `failed` transition.
      stepLog.push(outcome(step, 'failed', now, error instanceof Error ? error.message : String(error)))
      return { kind: 'failed', failedIndex: index, error, stepLog, context }
    }

    if (handler.channel && result.status === 'done') {
      await effects.recordSend({ channel: handler.channel, status: 'sent', stepId: step.id })
    }

    if (result.contextPatch) Object.assign(context, result.contextPatch)
    stepLog.push(outcome(step, result.status === 'done' ? 'done' : 'skipped', now, result.detail))
  }

  return { kind: 'completed', stepLog, context }
}
