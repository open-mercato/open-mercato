import { isFrequencyCapped, isPaused, isWithinQuietHours, localHourIn, preferenceCap, usableTimeZone } from './gates.js'
import { matchesAudience } from './audience.js'
import type { ConditionExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import type { ContactPreference } from './gates.js'
import type { SendPolicy } from './executor.js'
import type { EngineLogger, SubjectDocument } from './types.js'

/**
 * Why one customer would, or would not, receive this campaign right now.
 *
 * The question support is actually asked — "why didn't they get it?" — and the only one the module could not
 * answer. Every gate that could refuse the message already exists and is already evaluated on the send path; this
 * asks each of them the same question OUT of band and reports what they say, in the order the engine applies them.
 *
 * **Order is the point.** "Unsubscribed" and "it is 3am for them" are both true of the same customer, and only
 * one of them is the answer: consent is permission and everything after it is scheduling, so a refused message is
 * dropped rather than deferred and nothing below consent gets a say. Reporting the gates in any other order would
 * send somebody to fix the wrong thing.
 *
 * Pure, and that is what makes it trustworthy: the same functions the executor calls, over a document and a
 * policy, with no database of its own to disagree with.
 */

export type GateVerdict = {
  /** `audience` | `consent` | `pause` | `preferenceCap` | `quietHours` | `frequencyCap`. */
  gate: string
  /** `pass` — this gate is happy. `drop` — it refuses the message outright. `defer` — later, not never. */
  outcome: 'pass' | 'drop' | 'defer'
  /** True for the gate that actually decided, so a screen can say "this one" rather than showing six rows equally. */
  decisive: boolean
  /** Extra facts worth showing beside the verdict — the cap and the count, the quiet window, the local hour. */
  detail?: Record<string, string | number | boolean | null>
}

export type ExplainInput = {
  subject: SubjectDocument
  audience: ConditionExpression | null
  policy: SendPolicy
  /** What the send gates need to know about this customer, read by the caller. */
  facts: {
    suppressed: boolean
    preference: ContactPreference | null
    /** Messages already sent to them inside the campaign's own frequency window. */
    sentInCampaignWindow: number
    /** And inside the customer's own weekly window, which is evaluated separately and never merged. */
    sentInPreferenceWindow: number
    timeZone: string
  }
  now: Date
  /**
   * The audience evaluator logs its decisions, and a caller may want them.
   *
   * Required rather than optional because `matchesAudience` requires it, and a silent no-op logger here would
   * make this function's evaluation differ from the send path's in the one respect that is hardest to notice.
   */
  logger: EngineLogger
}

export type Explanation = {
  /** Whether the message would go out right now. */
  wouldSend: boolean
  /** The gate that decided, or null when every one of them passed. */
  decidedBy: string | null
  gates: GateVerdict[]
}

export function explainDelivery(input: ExplainInput): Explanation {
  const { facts, policy, now } = input
  const gates: GateVerdict[] = []
  let decided: string | null = null

  const record = (gate: string, outcome: GateVerdict['outcome'], detail?: GateVerdict['detail']): void => {
    const decisive = outcome !== 'pass' && decided === null
    if (decisive) decided = gate
    gates.push({ gate, outcome, decisive, detail })
  }

  /**
   * The audience first, because it decides whether there is anything to send at all.
   *
   * Evaluated through `matchesAudience` rather than the raw evaluator, so the missing-operand veto applies here
   * exactly as it does on the send path — otherwise this screen would cheerfully explain that a never-buyer is in
   * a win-back campaign.
   */
  record('audience', matchesAudience(input.audience, input.subject, { now, logger: input.logger }) ? 'pass' : 'drop')

  // Permission, then scheduling. A refused message is dropped; a deferred one is only later.
  record('consent', facts.suppressed ? 'drop' : 'pass', { suppressed: facts.suppressed })

  const paused = isPaused(facts.preference, now)
  record('pause', paused ? 'defer' : 'pass', {
    pausedUntil: facts.preference?.pausedUntil ? facts.preference.pausedUntil.toISOString() : null,
  })

  const ownCap = preferenceCap(facts.preference)
  const cappedByPreference = ownCap ? isFrequencyCapped(facts.sentInPreferenceWindow, ownCap) : false
  record('preferenceCap', cappedByPreference ? 'drop' : 'pass', {
    limit: ownCap?.maxMessages ?? null,
    sent: facts.sentInPreferenceWindow,
  })

  const zone = usableTimeZone(facts.timeZone)
  const quiet = isWithinQuietHours(policy.quietHours, zone, now)
  record('quietHours', quiet ? 'defer' : 'pass', {
    localHour: localHourIn(zone, now),
    timeZone: zone,
    from: policy.quietHours?.startHour ?? null,
    to: policy.quietHours?.endHour ?? null,
  })

  const cappedByCampaign = policy.frequencyCap
    ? isFrequencyCapped(facts.sentInCampaignWindow, policy.frequencyCap)
    : false
  record('frequencyCap', cappedByCampaign ? 'drop' : 'pass', {
    limit: policy.frequencyCap?.maxMessages ?? null,
    sent: facts.sentInCampaignWindow,
  })

  return {
    // A deferral is not a send: "they will get it at 8am" is a different answer from "they got it".
    wouldSend: gates.every((gate) => gate.outcome === 'pass'),
    decidedBy: decided,
    gates,
  }
}
