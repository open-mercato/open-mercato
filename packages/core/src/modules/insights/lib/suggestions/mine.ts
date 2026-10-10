import { createHash } from 'node:crypto'
import { PROCESS_NONE_VALUE, PROCESS_OTHER_VALUE } from '@open-mercato/shared/modules/insights/process'
import { compareCodeUnits, type RegisteredProcess } from '../process/registry'
import { wilsonLowerBound } from '../analytics/stats'
import type { AnalyticsEvent } from '../analytics/trace'
import {
  XRAY_SUGGESTION_EPSILON,
  XRAY_SUGGESTION_MAX_CONDITION_VALUES,
  XRAY_SUGGESTION_MAX_PER_PROCESS,
  XRAY_SUGGESTION_SIGNATURE_VERSION,
  XRAY_SUGGESTION_WINDOWS_SECONDS,
} from './constants'

const HUMAN_CAUSE_KIND = 'user'

const PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([PROCESS_OTHER_VALUE, PROCESS_NONE_VALUE])

const TRIGGER_KINDS: ReadonlySet<string> = new Set(['stage', 'followup', 'milestone'])

const SEPARATOR = '\u0000'

/** One case of the mining population: its events after the debounce / correction collapse, in projection order. */
export type MiningCase = {
  organizationId: string
  caseId: string
  events: readonly AnalyticsEvent[]
}

export type MiningThresholds = {
  minSupport: number
  minConfidenceLowerBound: number
  minLift: number
  minDistinctActors: number
  /** Distinct cases supporting the rule (the organization's k-anonymity). */
  minCases: number
}

export type MiningInput = {
  process: Pick<RegisteredProcess, 'processKey' | 'stageFields' | 'followupFields'>
  cases: readonly MiningCase[]
  window: { fromMs: number; toMs: number }
  thresholds: MiningThresholds
  windowsSeconds?: readonly number[]
  maxConditionValues?: number
  maxSuggestions?: number
}

export type MinedTrigger = {
  activityKey: string
  activityKind: string
  field: string | null
  value: string | null
}

export type MinedCondition = {
  field: string
  value: string
}

export type MinedFollowup = {
  field: string
  value: string
  activityKind: 'stage' | 'followup'
}

export type MinedSuggestion = {
  processKey: string
  signatureHash: string
  trigger: MinedTrigger
  condition: MinedCondition | null
  followups: MinedFollowup[]
  windowSeconds: number
  support: number
  triggerCount: number
  supportCases: number
  confidence: number
  confidenceRatio: number
  baseRate: number
  lift: number
  distinctActorCount: number
}

type FollowupHit = {
  key: string
  actor: string
}

type Anchor = {
  caseKey: string
  trigger: MinedTrigger
  field: string | null
  atMs: number
  state: ReadonlyMap<string, string>
  hitsByWindow: Map<number, Map<string, FollowupHit>>
}

type RuleCounts = {
  triggers: number
  support: Map<string, { count: number; actors: Set<string>; cases: Set<string> }>
}

/** The field and value a follow-up key stands for (`field␀value`). */
function splitKey(key: string): [string, string] {
  const index = key.indexOf(SEPARATOR)
  return [key.slice(0, index), key.slice(index + 1)]
}

function joinKey(field: string, value: string): string {
  return `${field}${SEPARATOR}${value}`
}

function isUsableValue(value: string | null): value is string {
  return typeof value === 'string' && value.length > 0 && !PLACEHOLDER_VALUES.has(value)
}

/**
 * Root fields a workflow could set: stage fields and follow-up fields that do not hold user ids
 * (their values are pseudonyms and never leave the projection). Field key → activity kind.
 */
export function settableFields(process: MiningInput['process']): Map<string, 'stage' | 'followup'> {
  const fields = new Map<string, 'stage' | 'followup'>()
  for (const field of process.stageFields) fields.set(field.key, 'stage')
  for (const field of process.followupFields) if (field.valueKind !== 'user') fields.set(field.key, 'followup')
  return fields
}

function isManual(event: AnalyticsEvent): boolean {
  return event.causeKind === HUMAN_CAUSE_KIND && !event.sync
}

/**
 * The trigger an event stands for, or `null` when it cannot trigger a suggestion: only manual
 * (`cause_kind = 'user'`, not via a sync run) activities in the mining window; the creation of the
 * case (`created`) and a milestone's lifecycle (`payment.created`), but not the initial values
 * recorded with a creation; stage, follow-up and milestone field changes except the `other` /
 * `none` placeholders. Deletions and exits of the case end it. A follow-up trigger is the change
 * itself (`<field>:changed`): its value (possibly a pseudonym) is never part of a rule.
 */
export function triggerOf(event: AnalyticsEvent, window: { fromMs: number; toMs: number }): MinedTrigger | null {
  if (!isManual(event)) return null
  if (!(event.atMs >= window.fromMs && event.atMs < window.toMs)) return null
  if (event.activityKind === 'lifecycle') {
    return event.activityKey === 'created' ? { activityKey: 'created', activityKind: 'lifecycle', field: null, value: null } : null
  }
  if (!TRIGGER_KINDS.has(event.activityKind)) return null
  if (event.activityKind === 'milestone' && !event.field) {
    return { activityKey: event.activityKey, activityKind: 'milestone', field: null, value: null }
  }
  if (event.initial) return null
  if (event.activityKind === 'followup') {
    return event.field ? { activityKey: event.activityKey, activityKind: 'followup', field: event.field, value: null } : null
  }
  if (!event.field || !isUsableValue(event.value)) return null
  return { activityKey: event.activityKey, activityKind: event.activityKind, field: event.field, value: event.value }
}

/**
 * The follow-up an event stands for (`field␀value`), or `null`: a manual change of a settable
 * root field to an identifier value (never `other` / `none`).
 */
function followupKeyOf(event: AnalyticsEvent, fields: ReadonlyMap<string, 'stage' | 'followup'>): string | null {
  if (!isManual(event) || event.initial || !event.field) return null
  const kind = fields.get(event.field)
  if (!kind || kind !== event.activityKind || !isUsableValue(event.value)) return null
  return joinKey(event.field, event.value)
}

/**
 * Stable identity of a rule: process, trigger activity, condition and follow-ups (never the
 * window or the statistics, which change from pass to pass).
 */
export function suggestionSignature(input: {
  processKey: string
  trigger: Pick<MinedTrigger, 'activityKey'>
  condition: MinedCondition | null
  followups: ReadonlyArray<Pick<MinedFollowup, 'field' | 'value'>>
}): string {
  const followups = input.followups
    .map((followup) => [followup.field, followup.value])
    .sort((left, right) => compareCodeUnits(left[0], right[0]) || compareCodeUnits(left[1], right[1]))
  const canonical = [
    XRAY_SUGGESTION_SIGNATURE_VERSION,
    input.processKey,
    input.trigger.activityKey,
    input.condition ? [input.condition.field, input.condition.value] : null,
    followups,
  ]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

/**
 * Collects the anchors (trigger occurrences) of one case: for each, the case state right after
 * the trigger's audit row (every settable field's latest value, from every kept event, automated
 * ones included) and, per window, the first manual follow-up of each field + value that came
 * from a later audit row within the window (never a change of the trigger's own field).
 */
function collectAnchors(
  miningCase: MiningCase,
  fields: ReadonlyMap<string, 'stage' | 'followup'>,
  window: { fromMs: number; toMs: number },
  windowsMs: readonly number[],
): Anchor[] {
  const events = miningCase.events
  const caseKey = `${miningCase.organizationId}:${miningCase.caseId}`
  const state = new Map<string, string>()
  const anchors: Anchor[] = []
  const largestWindow = Math.max(...windowsMs)
  let index = 0
  while (index < events.length) {
    const sourceLogId = events[index].sourceLogId
    let end = index
    while (end < events.length && events[end].sourceLogId === sourceLogId) end += 1
    for (let position = index; position < end; position += 1) {
      const event = events[position]
      if (event.field && fields.has(event.field) && event.activityKind === fields.get(event.field) && event.value !== null) {
        state.set(event.field, event.value)
      }
    }
    for (let position = index; position < end; position += 1) {
      const event = events[position]
      const trigger = triggerOf(event, window)
      if (!trigger) continue
      const hitsByWindow = new Map<number, Map<string, FollowupHit>>(windowsMs.map((windowMs) => [windowMs, new Map()]))
      for (let next = end; next < events.length; next += 1) {
        const candidate = events[next]
        const elapsed = candidate.atMs - event.atMs
        if (!(elapsed >= 0) || elapsed > largestWindow) break
        const key = followupKeyOf(candidate, fields)
        if (!key || !candidate.actor) continue
        if (trigger.field !== null && candidate.field === trigger.field) continue
        for (const windowMs of windowsMs) {
          if (elapsed > windowMs) continue
          const hits = hitsByWindow.get(windowMs) as Map<string, FollowupHit>
          if (!hits.has(key)) hits.set(key, { key, actor: candidate.actor })
        }
      }
      anchors.push({ caseKey, trigger, field: trigger.field, atMs: event.atMs, state: new Map(state), hitsByWindow })
    }
    index = end
  }
  return anchors
}

function conditionKeysOf(anchor: Anchor, conditionFields: ReadonlySet<string>): Array<string | null> {
  const keys: Array<string | null> = [null]
  for (const [field, value] of anchor.state) {
    if (!conditionFields.has(field) || field === anchor.field || !isUsableValue(value)) continue
    keys.push(joinKey(field, value))
  }
  return keys
}

function conditionOf(key: string | null): MinedCondition | null {
  if (key === null) return null
  const [field, value] = splitKey(key)
  return { field, value }
}

type Evaluation = Omit<MinedSuggestion, 'processKey' | 'signatureHash' | 'trigger' | 'condition' | 'followups'>

function passes(evaluation: Evaluation, thresholds: MiningThresholds): boolean {
  return evaluation.support >= thresholds.minSupport
    && evaluation.confidence + XRAY_SUGGESTION_EPSILON >= thresholds.minConfidenceLowerBound
    && evaluation.lift + XRAY_SUGGESTION_EPSILON >= thresholds.minLift
    && evaluation.distinctActorCount >= thresholds.minDistinctActors
    && evaluation.supportCases >= thresholds.minCases
}

function compareSuggestions(left: MinedSuggestion, right: MinedSuggestion): number {
  return right.confidence - left.confidence
    || right.support - left.support
    || right.lift - left.lift
    || compareCodeUnits(left.signatureHash, right.signatureHash)
}

/**
 * Mines automation suggestions of one process (pure). A rule is "trigger A, optionally under one
 * low-cardinality condition (a settable root field's value right after A), is followed by a manual
 * change of field B to value V within W" — counted per trigger occurrence:
 *
 * - `triggerCount`: occurrences of A (with the condition) whose window W ended before the end of
 *   the mining window (right-censored occurrences are left out for that W);
 * - `support`: those followed by B = V within W (from a later audit row; corrections and debounced
 *   intermediate values were collapsed beforehand; automated, legacy and sync-run rows never count);
 * - `confidence`: the 95 % Wilson lower bound of `support / triggerCount`;
 * - `lift`: `support / triggerCount` over the base rate of B = V within W after any trigger
 *   occurrence of the process that does not change B's own field;
 * - `distinctActorCount`: people behind the supporting follow-ups (a count only).
 *
 * Every threshold must hold, plus at least `minCases` distinct supporting cases. For each (A, B = V)
 * the unconditioned rule wins when it passes; otherwise the passing conditioned rule with the
 * highest confidence. Per rule the smallest passing window is reported. Results are ordered by
 * confidence, support, lift and signature, at most `maxSuggestions`.
 */
export function mineSuggestions(input: MiningInput): MinedSuggestion[] {
  const fields = settableFields(input.process)
  const windowsSeconds = [...(input.windowsSeconds ?? XRAY_SUGGESTION_WINDOWS_SECONDS)].sort((left, right) => left - right)
  const windowsMs = windowsSeconds.map((seconds) => seconds * 1000)
  if (windowsMs.length === 0 || fields.size === 0) return []
  const anchors = input.cases.flatMap((miningCase) => collectAnchors(miningCase, fields, input.window, windowsMs))
  const valuesByField = new Map<string, Set<string>>()
  for (const anchor of anchors) {
    for (const [field, value] of anchor.state) {
      const values = valuesByField.get(field) ?? new Set<string>()
      values.add(value)
      valuesByField.set(field, values)
    }
  }
  const maxConditionValues = input.maxConditionValues ?? XRAY_SUGGESTION_MAX_CONDITION_VALUES
  const conditionFields = new Set(Array.from(valuesByField.entries())
    .filter(([, values]) => values.size <= maxConditionValues)
    .map(([field]) => field))

  const rules = new Map<number, Map<string, RuleCounts>>()
  const baseAnchors = new Map<number, { total: number; byField: Map<string, number> }>()
  const baseHits = new Map<number, Map<string, number>>()
  const triggers = new Map<string, MinedTrigger>()
  for (const windowMs of windowsMs) {
    rules.set(windowMs, new Map())
    baseAnchors.set(windowMs, { total: 0, byField: new Map() })
    baseHits.set(windowMs, new Map())
  }
  for (const anchor of anchors) {
    triggers.set(anchor.trigger.activityKey, anchor.trigger)
    const conditions = conditionKeysOf(anchor, conditionFields)
    for (const windowMs of windowsMs) {
      if (anchor.atMs + windowMs > input.window.toMs) continue
      const base = baseAnchors.get(windowMs) as { total: number; byField: Map<string, number> }
      base.total += 1
      if (anchor.field !== null) base.byField.set(anchor.field, (base.byField.get(anchor.field) ?? 0) + 1)
      const hits = anchor.hitsByWindow.get(windowMs) as Map<string, FollowupHit>
      const windowBaseHits = baseHits.get(windowMs) as Map<string, number>
      for (const key of hits.keys()) windowBaseHits.set(key, (windowBaseHits.get(key) ?? 0) + 1)
      const windowRules = rules.get(windowMs) as Map<string, RuleCounts>
      for (const condition of conditions) {
        const ruleKey = `${anchor.trigger.activityKey}${SEPARATOR}${condition ?? ''}`
        const counts = windowRules.get(ruleKey) ?? { triggers: 0, support: new Map() }
        counts.triggers += 1
        for (const hit of hits.values()) {
          if (condition !== null && splitKey(condition)[0] === splitKey(hit.key)[0]) continue
          const support = counts.support.get(hit.key) ?? { count: 0, actors: new Set<string>(), cases: new Set<string>() }
          support.count += 1
          support.actors.add(hit.actor)
          support.cases.add(anchor.caseKey)
          counts.support.set(hit.key, support)
        }
        windowRules.set(ruleKey, counts)
      }
    }
  }

  const evaluate = (triggerKey: string, condition: string | null, followupKey: string): { evaluation: Evaluation; windowSeconds: number } | null => {
    const [followupField] = splitKey(followupKey)
    for (const [position, windowMs] of windowsMs.entries()) {
      const counts = rules.get(windowMs)?.get(`${triggerKey}${SEPARATOR}${condition ?? ''}`)
      const support = counts?.support.get(followupKey)
      if (!counts || !support) continue
      const base = baseAnchors.get(windowMs) as { total: number; byField: Map<string, number> }
      const baseDenominator = base.total - (base.byField.get(followupField) ?? 0)
      const baseRate = baseDenominator > 0 ? (baseHits.get(windowMs)?.get(followupKey) ?? 0) / baseDenominator : 0
      const ratio = support.count / counts.triggers
      const evaluation: Evaluation = {
        windowSeconds: windowsSeconds[position],
        support: support.count,
        triggerCount: counts.triggers,
        supportCases: support.cases.size,
        confidence: wilsonLowerBound(support.count, counts.triggers) ?? 0,
        confidenceRatio: ratio,
        baseRate,
        lift: baseRate > 0 ? ratio / baseRate : 0,
        distinctActorCount: support.actors.size,
      }
      if (passes(evaluation, input.thresholds)) return { evaluation, windowSeconds: windowsSeconds[position] }
    }
    return null
  }

  const pairs = new Map<string, Set<string | null>>()
  for (const windowRules of rules.values()) {
    for (const [ruleKey, counts] of windowRules) {
      const separator = ruleKey.indexOf(SEPARATOR)
      const triggerKey = ruleKey.slice(0, separator)
      const conditionPart = ruleKey.slice(separator + 1)
      for (const followupKey of counts.support.keys()) {
        const pairKey = `${triggerKey}${SEPARATOR}${SEPARATOR}${followupKey}`
        const conditions = pairs.get(pairKey) ?? new Set<string | null>()
        conditions.add(conditionPart.length > 0 ? conditionPart : null)
        pairs.set(pairKey, conditions)
      }
    }
  }

  const suggestions: MinedSuggestion[] = []
  for (const [pairKey, conditions] of pairs) {
    const pairSeparator = pairKey.indexOf(`${SEPARATOR}${SEPARATOR}`)
    const triggerKey = pairKey.slice(0, pairSeparator)
    const followupKey = pairKey.slice(pairSeparator + 2)
    const [field, value] = splitKey(followupKey)
    const trigger = triggers.get(triggerKey) as MinedTrigger
    const followups: MinedFollowup[] = [{ field, value, activityKind: fields.get(field) as 'stage' | 'followup' }]
    const build = (condition: string | null, evaluation: Evaluation): MinedSuggestion => {
      const parsedCondition = conditionOf(condition)
      return {
        processKey: input.process.processKey,
        signatureHash: suggestionSignature({ processKey: input.process.processKey, trigger, condition: parsedCondition, followups }),
        trigger,
        condition: parsedCondition,
        followups,
        ...evaluation,
      }
    }
    const unconditioned = conditions.has(null) ? evaluate(triggerKey, null, followupKey) : null
    if (unconditioned) {
      suggestions.push(build(null, unconditioned.evaluation))
      continue
    }
    const conditioned = Array.from(conditions)
      .filter((condition): condition is string => condition !== null)
      .map((condition) => {
        const result = evaluate(triggerKey, condition, followupKey)
        return result ? build(condition, result.evaluation) : null
      })
      .filter((suggestion): suggestion is MinedSuggestion => suggestion !== null)
      .sort(compareSuggestions)
    if (conditioned.length > 0) suggestions.push(conditioned[0])
  }
  return suggestions.sort(compareSuggestions).slice(0, input.maxSuggestions ?? XRAY_SUGGESTION_MAX_PER_PROCESS)
}
