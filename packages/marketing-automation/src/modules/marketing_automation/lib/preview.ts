import { executeRun } from './engine/executor.js'
import type { ExecutorSideEffects, RunState, SendPolicy } from './engine/executor.js'
import type { StepHandler } from './engine/registry.js'
import type { AutomationContext, CampaignStep, EngineLogger, StepOutcome } from './engine/types.js'

/**
 * What a named customer would actually receive, and when.
 *
 * Runs the REAL executor rather than describing what it would do. An explainer that reimplements the
 * sequencing is a second engine that drifts from the first, and the moment it drifts it is worse than
 * nothing — an author trusts a preview precisely where they cannot check it. So the engine is driven
 * with side effects that record instead of act, and the clock is advanced to each resume point until
 * the journey ends.
 *
 * The consequence to keep in mind: every gate is exercised for real. Quiet hours, the frequency cap and
 * the learned send hour all move the predicted timestamps, which is the point — those are exactly the
 * rules nobody can hold in their head.
 */

/**
 * One line of the timeline.
 *
 * A PAUSE is an entry of its own rather than an unexplained gap between two timestamps. It is not
 * invented: the engine returns the reason and the resume instant, so this reports what it was told —
 * a `wait` the author placed, or a deferral the send rules imposed. The distinction matters, because
 * "waits a day because you asked" and "waits until 09:00 because of quiet hours" are different
 * answers to the same-looking gap.
 */
export type PreviewEntry =
  | {
      kind: 'step'
      /** When this would happen, simulated. */
      at: string
      stepId: string
      type: string
      /** `done` for a step that would act, `skipped` for one the gates or the handler would pass over. */
      status: StepOutcome['status']
      detail: string | null
      /** The channel a message would go out on, when the step sends. */
      channel: string | null
    }
  | {
      kind: 'pause'
      at: string
      /** When the journey would carry on. */
      until: string
      reason: 'wait' | 'quiet_hours' | 'send_time' | 'paused'
    }

export type PreviewResult = {
  /** False when the audience would turn this customer away; the timeline is then empty. */
  entered: boolean
  entries: PreviewEntry[]
  /** Why the simulation stopped. */
  stoppedBecause: 'completed' | 'stepLimit' | 'horizon' | 'failed'
  /** Which lane each split assigned this customer. */
  variantChoices: Record<string, string>
  /** The simulated end of the journey, or null when it never started. */
  endsAt: string | null
}

/** A journey longer than this is a loop somebody should look at, not a preview worth rendering. */
const MAX_SIMULATED_STEPS = 60
/** How far ahead the simulation will follow waits. A year is more than any drip campaign. */
const MAX_HORIZON_DAYS = 365

/**
 * Replaces every step handler with one that reports instead of acting.
 *
 * `channel` is PRESERVED, because the send gates key off it: a preview whose steps had no channel
 * would show a message escaping quiet hours and the frequency cap, which is the opposite of useful.
 */
function dryHandler<TDeps>(real: StepHandler<TDeps> | undefined): StepHandler<TDeps> | undefined {
  if (!real) return undefined
  return {
    ...real,
    async execute() {
      return { status: 'done', detail: 'would run' }
    },
  }
}

export type PreviewDeps<TDeps> = {
  deps: TDeps
  /** The real effects, so timezone, send history and learned hour all behave as they would. */
  effects: ExecutorSideEffects<TDeps>
  logger: EngineLogger
}

/** The last moment the journey touches, which for a trailing pause is when it would resume. */
function endsAtOf(entries: PreviewEntry[], fallback: Date): string {
  const last = entries[entries.length - 1]
  if (!last) return fallback.toISOString()
  return last.kind === 'pause' ? last.until : last.at
}

export async function previewJourney<TDeps>(
  input: {
    campaignId: string
    subjectEntityId: string | null
    context: AutomationContext
    steps: CampaignStep[]
    policy: SendPolicy
    /** Whether the audience accepted this customer; a preview says so rather than pretending. */
    entered: boolean
    now: Date
    variantChoices: Record<string, string>
  },
  { deps, effects, logger }: PreviewDeps<TDeps>,
): Promise<PreviewResult> {
  if (!input.entered) {
    return { entered: false, entries: [], stoppedBecause: 'completed', variantChoices: input.variantChoices, endsAt: null }
  }

  const horizon = new Date(input.now.getTime() + MAX_HORIZON_DAYS * 86_400_000)
  const entries: PreviewEntry[] = []
  const channels = new Map<string, string | null>()

  let clock = input.now
  let state: RunState = {
    id: `preview-${input.campaignId}`,
    campaignId: input.campaignId,
    currentStepIndex: 0,
    stepLog: [],
    context: input.context,
    subjectEntityId: input.subjectEntityId,
  }
  let stoppedBecause: PreviewResult['stoppedBecause'] = 'completed'

  for (let iteration = 0; iteration < MAX_SIMULATED_STEPS; iteration += 1) {
    const simulated: ExecutorSideEffects<TDeps> = {
      ...effects,
      now: clock,
      logger,
      getStep: (type) => {
        const real = effects.getStep(type)
        channels.set(type, real?.channel ?? null)
        return dryHandler(real)
      },
      // Nothing is written. A preview that recorded sends would count against the very frequency cap
      // it is trying to explain, and would show up in the campaign's reports as traffic.
      recordSend: async () => {},
      /**
       * The caps are still ASKED, and the answer is simulated rather than reserved.
       *
       * A preview that took a real slot would consume one of the customer's messages to explain what would
       * happen to it — and the reservation counts against the cap, so previewing a journey twice would make
       * the second preview lie about the first. The gate's verdict still comes from real sends, through the
       * `countSendsSince` this preview inherits.
       */
      reserveSendSlot: async (input) => {
        for (const cap of input.caps) {
          const since = new Date(effects.now.getTime() - cap.windowHours * 3_600_000)
          const taken = await effects.countSendsSince(input.subjectEntityId, since)
          if (taken >= cap.maxMessages) return { reserved: false, reason: cap.reason }
        }
        return { reserved: true, id: 'preview' }
      },
      settleSendSlot: async () => {},
      releaseSendSlot: async () => {},
    }

    const transition = await executeRun(state, input.steps, input.policy, deps, simulated)

    // Only the outcomes this pass added; the executor carries the whole log forward.
    for (const outcome of transition.stepLog.slice(state.stepLog.length)) {
      entries.push({
        kind: 'step',
        at: outcome.at,
        stepId: outcome.stepId,
        type: outcome.type,
        status: outcome.status,
        detail: outcome.detail ?? null,
        channel: channels.get(outcome.type) ?? null,
      })
    }

    if (transition.kind === 'completed') {
      stoppedBecause = 'completed'
      break
    }
    if (transition.kind === 'failed') {
      // A preview does not retry: the author wants to see where it breaks, not five attempts at it.
      stoppedBecause = 'failed'
      break
    }

    entries.push({
      kind: 'pause',
      at: clock.toISOString(),
      until: transition.resumeAt.toISOString(),
      reason: transition.reason,
    })

    if (transition.resumeAt.getTime() > horizon.getTime()) {
      stoppedBecause = 'horizon'
      break
    }

    clock = transition.resumeAt
    state = {
      ...state,
      currentStepIndex: transition.nextStepIndex,
      stepLog: transition.stepLog,
      context: transition.context,
    }

    if (iteration === MAX_SIMULATED_STEPS - 1) stoppedBecause = 'stepLimit'
  }

  return {
    entered: true,
    entries,
    stoppedBecause,
    variantChoices: input.variantChoices,
    endsAt: endsAtOf(entries, input.now),
  }
}
