import { planSteps } from './chain-planner.js'
import { isFrequencyCapped, isWithinQuietHours, nextAllowedSendTime } from './gates.js'
import type { FrequencyCap, QuietHoursWindow } from './gates.js'
import type { StepHandler } from './registry.js'
import type { AutomationContext, CampaignStep, EngineLogger, StepOutcome } from './types.js'

export type SendPolicy = {
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
  | { kind: 'waiting'; resumeAt: Date; nextStepIndex: number; stepLog: StepOutcome[]; context: AutomationContext; reason: 'wait' | 'quiet_hours' }
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
  recordSend(entry: {
    channel: NonNullable<StepHandler<TDeps>['channel']>
    status: 'sent' | 'suppressed'
    stepId: string
    toAddress?: string | null
    suppressionReason?: string | null
  }): Promise<void>
  /** The subject's own timezone; quiet hours are meaningless in server time. */
  resolveTimeZone(subjectEntityId: string | null | undefined): Promise<string>
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

  for (const planned of planSteps(steps, run.currentStepIndex)) {
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

      if (isWithinQuietHours(policy.quietHours, timeZone, now)) {
        // Deferred, not dropped — and the run resumes at THIS step so the message still goes.
        return {
          kind: 'waiting',
          reason: 'quiet_hours',
          resumeAt: nextAllowedSendTime(policy.quietHours, timeZone, now),
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
      await effects.recordSend({
        channel: handler.channel,
        status: 'sent',
        stepId: step.id,
        toAddress: result.sentTo ?? null,
      })
    }

    if (result.contextPatch) Object.assign(context, result.contextPatch)
    stepLog.push(outcome(step, result.status === 'done' ? 'done' : 'skipped', now, result.detail))
  }

  return { kind: 'completed', stepLog, context }
}
