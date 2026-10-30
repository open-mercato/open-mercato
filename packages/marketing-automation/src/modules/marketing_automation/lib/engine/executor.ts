import { planSteps } from './chain-planner.js'
import { flattenSteps, resolveResumeIndex } from './split.js'
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
  /**
   * The hour the author chose, in the recipient's local time, or null for "as soon as it comes due".
   *
   * Outranks `optimizeSendTime`: an author who wrote nine o'clock has made a decision, and the learned hour is a
   * guess about the same question. Both are still subordinate to quiet hours.
   */
  sendHour?: number | null
  frequencyCap: FrequencyCap | null
  quietHours: QuietHoursWindow | null
}

/** The mutable part of a run, as a plain shape so the executor can be tested without a database. */
export type RunState = {
  id: string
  campaignId: string
  currentStepIndex: number
  /**
   * The id of the step this run parked at, when it has one.
   *
   * Resolved against the CURRENT flattening in preference to `currentStepIndex`; absent on runs that
   * parked before the column existed, which fall back to the index.
   */
  currentStepId?: string | null
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
  | {
      kind: 'waiting'
      resumeAt: Date
      nextStepIndex: number
      /**
       * The id of the step the run will pick up at, which is what the resume actually resolves on.
       *
       * The index alone is a position in an array that an author can rewrite while the run is parked.
       * Null only when the flattened definition has no step at that position — a run parked past the end.
       */
      nextStepId: string | null
      stepLog: StepOutcome[]
      context: AutomationContext
      reason: 'wait' | 'quiet_hours' | 'send_time' | 'paused'
    }
  /**
   * A step threw.
   *
   * Carries the progress made BEFORE the failure and the index of the step that failed, so the
   * retry resumes AT that step. Without this the executor would report nothing on failure and the
   * caller would park the run at its original index — replaying every completed step, which for a
   * chain containing a send means mailing the customer again on every one of the five attempts.
   */
  | { kind: 'failed'; failedIndex: number; failedStepId: string | null; error: unknown; stepLog: StepOutcome[]; context: AutomationContext }

export type ExecutorSideEffects<TDeps> = {
  getStep(type: string): StepHandler<TDeps> | undefined
  /**
   * Takes a slot against the frequency caps, or refuses because one is full.
   *
   * Replaces counting and then deciding. The count and the slot are one act, serialised per subject, so
   * three workers running three campaigns for the same person can no longer all read the same number and all
   * send — which is how "at most two a week" delivered four.
   */
  reserveSendSlot(input: {
    subjectEntityId: string
    stepId: string
    channel: NonNullable<StepHandler<TDeps>['channel']>
    caps: Array<{ maxMessages: number; windowHours: number; reason: 'frequency_cap' | 'preference_cap' }>
  }): Promise<{ reserved: true; id: string } | { reserved: false; reason: 'frequency_cap' | 'preference_cap' }>
  /** Turns a taken slot into what happened. */
  settleSendSlot(id: string, status: 'sent' | 'failed'): Promise<void>
  /** Gives a slot back when the step produced no message at all. */
  releaseSendSlot(id: string): Promise<void>
  /**
   * Called after every step this pass finishes, with where the run would resume if it stopped here.
   *
   * Exists because a throw loses everything the pass had done. A failure INSIDE a step comes back as a
   * `failed` transition carrying its index, but a failure of the orchestration — a malformed definition, an
   * effects query — propagates, and the caller's catch then had only the state it started from. It recorded
   * the run at its STARTING index, so the retry re-ran every step that had already succeeded, which for a
   * journey whose first step is an email means sending it again.
   *
   * Optional: a test that does not care about the retry point leaves it out.
   */
  reportProgress?(progress: {
    nextStepIndex: number
    nextStepId: string | null
    stepLog: StepOutcome[]
    context: AutomationContext
  }): void
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

  /**
   * Resolved by id, because the array this indexes into is not stable across an edit.
   *
   * `resolveResumeIndex` returns null when the step the run parked at is gone — after a step was
   * deleted, or after an A/B promotion replaced the split it lived in. Resuming at the old POSITION
   * then means running a different step than the one the run stopped before, so the run ends instead
   * and the log says why.
   */
  const startIndex = resolveResumeIndex(effectiveSteps, run.currentStepId, run.currentStepIndex)
  if (startIndex === null) {
    stepLog.push({
      stepId: run.currentStepId ?? '-',
      type: '-',
      status: 'skipped',
      at: now.toISOString(),
      detail: 'the step this run was waiting at is no longer in the campaign',
    })
    return { kind: 'completed', stepLog, context }
  }

  for (const planned of planSteps(effectiveSteps, startIndex)) {
    if (planned.kind === 'pause') {
      /**
       * Logged on entry, because reaching a wait is the whole of what a wait does.
       *
       * Every other step writes its outcome here and the step funnel counts people from those entries, so an
       * unlogged wait reported nobody — and, being the predecessor of whatever follows it, left the next step
       * dividing by zero and showing no conversion at all. A run resumes AFTER the wait, so this is written
       * once however many times the run is woken.
       */
      const waitStep = effectiveSteps[planned.index]
      if (waitStep) stepLog.push(outcome(waitStep, 'done', now, `waiting ${planned.minutes} min`))
      return {
        kind: 'waiting',
        reason: 'wait',
        resumeAt: new Date(now.getTime() + planned.minutes * 60_000),
        nextStepIndex: planned.resumeIndex,
        nextStepId: effectiveSteps[planned.resumeIndex]?.id ?? null,
        stepLog,
        context,
      }
    }

    const { step, index } = planned
    const handler = effects.getStep(step.type)
    /**
     * The slot this step took, so whatever happens next can account for it.
     *
     * Per step rather than per pass: a journey can hold several sends, and each takes its own slot.
     */
    let reservationId: string | null = null

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
      /**
       * The author's hour first, and if they set one the learned hour is not consulted at all.
       *
       * Two mechanisms proposing an hour for the same message could only be resolved by picking one, so it is
       * picked here and stated: a decision outranks a guess. Discarded rather than pushed when quiet hours
       * forbid it, for exactly the reason the learned hour is — pushing a recurring proposal past a quiet
       * window parks the run until the window ends and then proposes the same forbidden hour tomorrow, forever.
       * The save rules refuse that combination anyway; this is the net under it, because quiet hours can be
       * edited after the fact.
       */
      const authoredHour = policy.sendHour ?? null
      if (authoredHour !== null) {
        const proposed = nextOccurrenceOfHour(authoredHour, timeZone, sendAt)
        if (!isWithinQuietHours(policy.quietHours, timeZone, proposed)) sendAt = proposed
      } else if (policy.optimizeSendTime) {
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
          // This step, not the next: a deferred message still has to go.
          nextStepId: step.id,
          stepLog,
          context,
        }
      }

      /**
       * Both caps, decided together and taken as a slot in the same act.
       *
       * Each is still evaluated in its OWN window: "three a week" and the shop's "two a day" have exact
       * answers only that way, and merging them would mean normalising two windows into one and getting a
       * number from neither. What changed is that they are decided under one lock and the decision writes a
       * reservation — because counting and then sending let three workers running three campaigns for the
       * same person all read the same number and all send, which turned "at most two a week" into four.
       *
       * A refusal is still DROPPED rather than deferred, and still recorded: the point of a cap is that the
       * customer does not receive this message, and deferring would only move the flood later.
       */
      const caps: Array<{ maxMessages: number; windowHours: number; reason: 'frequency_cap' | 'preference_cap' }> = []
      const ownCap = preferenceCap(preference)
      if (ownCap) caps.push({ ...ownCap, reason: 'preference_cap' })
      if (policy.frequencyCap) caps.push({ ...policy.frequencyCap, reason: 'frequency_cap' })

      if (run.subjectEntityId) {
        const slot = await effects.reserveSendSlot({
          subjectEntityId: run.subjectEntityId,
          stepId: step.id,
          channel: handler.channel,
          caps,
        })
        if (!slot.reserved) {
          await effects.recordSend({
            channel: handler.channel,
            status: 'suppressed',
            stepId: step.id,
            suppressionReason: slot.reason,
          })
          stepLog.push(outcome(
            step,
            'skipped',
            now,
            slot.reason === 'preference_cap' ? 'recipient frequency preference' : 'frequency cap',
          ))
          continue
        }
        reservationId = slot.id
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
          /**
           * The reservation BECOMES the failure row rather than a second row beside it.
           *
           * The slot was taken before the transport was called, so settling it is both the record of the
           * failure and the release of the slot — and a `failed` row is deliberately kept rather than
           * deleted: a campaign whose every message is rejected must look broken rather than quiet, which
           * is the signal the deliverability guardrail reads.
           */
          if (reservationId) await effects.settleSendSlot(reservationId, 'failed')
          else await effects.recordSend({ channel: handler.channel, status: 'failed', stepId: step.id })
        } catch {
          // Bookkeeping must not replace the real error with its own.
        }
      }
      // Progress is reported rather than thrown away — see the `failed` transition. The message is
      // redacted because it is third-party text that will be persisted to jsonb and returned by the
      // runs API: a transport rejection quotes the address it rejected, and this module keeps
      // addresses out of both.
      stepLog.push(outcome(step, 'failed', now, redactEmails(error instanceof Error ? error.message : String(error))))
      return { kind: 'failed', failedIndex: index, failedStepId: step.id, error, stepLog, context }
    }

    if (handler.channel && result.status === 'done') {
      try {
        /**
         * The reservation becomes the sent row. One row per message, from the moment the slot was taken.
         */
        if (reservationId) await effects.settleSendSlot(reservationId, 'sent')
        else await effects.recordSend({ channel: handler.channel, status: 'sent', stepId: step.id })
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

    /**
     * A step that took a slot and sent nothing gives it back.
     *
     * `skipped` here is the step's own decision — no address on the subject, a tag already assigned — so no
     * message exists. Leaving the reservation would spend one of the customer's slots on a message nobody
     * ever received, and the lease would hide it for fifteen minutes before the sweep noticed.
     */
    if (reservationId && result.status !== 'done') {
      try {
        await effects.releaseSendSlot(reservationId)
      } catch (error) {
        // The sweep expires it instead; losing the slot for one lease is not worth failing the run over.
        logger.warn('[internal] marketing send slot not released', {
          campaignId: run.campaignId,
          stepId: step.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (result.contextPatch) Object.assign(context, result.contextPatch)
    stepLog.push(outcome(step, result.status === 'done' ? 'done' : 'skipped', now, result.detail))
    // Where a retry should pick up if the orchestration throws after this point: AFTER this step.
    effects.reportProgress?.({
      nextStepIndex: index + 1,
      nextStepId: effectiveSteps[index + 1]?.id ?? null,
      stepLog: [...stepLog],
      context: { ...context },
    })
  }

  return { kind: 'completed', stepLog, context }
}
