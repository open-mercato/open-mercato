import type { TriggerFilterCondition } from '../../data/entities'
import { compareTriggerFilterValue, constantTriggerFilterResult, readOwnTriggerPayloadPath } from '../trigger-filter'

/**
 * Three-valued evaluation of trigger filter conditions for the change simulator (spec
 * `2026-10-08-insights-change-simulator`, S1/S7). Pure: no I/O, no logging.
 *
 * Every known comparison goes through `compareTriggerFilterValue`, the function production uses,
 * so a payload without unknown inputs evaluates exactly as `evaluateFilterConditions`. A payload
 * path is read through the own-property accessor: a path the adapter declared unknown, or one that
 * only exists on the prototype chain (production would read a built-in member there; the simulator
 * refuses to), makes its condition `unknown` unless the operator's result cannot depend on the
 * value. A field absent from the payload is a known absence and evaluates as in production.
 */

export type TriggerFilterTriOutcome = 'true' | 'false' | 'unknown'

export type TriggerFilterUnknownReason = 'unknown_path' | 'prototype_path'

export type TriggerFilterTriResult = {
  outcome: TriggerFilterTriOutcome
  reasons: TriggerFilterUnknownReason[]
}

export type TriggerFilterTriOptions = {
  unknownPaths?: readonly string[]
}

/**
 * A path is unknown when a declared unknown path equals it, is a dotted ancestor of it, or is a
 * dotted descendant of it (the value at the path then contains an unknown part).
 */
export function isUnknownTriggerPayloadPath(path: string, unknownPaths: readonly string[]): boolean {
  if (unknownPaths.length === 0) return false
  return unknownPaths.some((declared) =>
    typeof declared === 'string'
    && declared.length > 0
    && (declared === path || path.startsWith(`${declared}.`) || declared.startsWith(`${path}.`)))
}

type ConditionOutcome = { outcome: TriggerFilterTriOutcome; reason?: TriggerFilterUnknownReason }

function unreadableOutcome(condition: TriggerFilterCondition, reason: TriggerFilterUnknownReason): ConditionOutcome {
  const constant = constantTriggerFilterResult(condition.operator, condition.value)
  return constant === null ? { outcome: 'unknown', reason } : { outcome: constant ? 'true' : 'false' }
}

function evaluateConditionTri(condition: TriggerFilterCondition, payload: Record<string, unknown>, unknownPaths: readonly string[]): ConditionOutcome {
  if (isUnknownTriggerPayloadPath(condition.field, unknownPaths)) return unreadableOutcome(condition, 'unknown_path')
  const read = readOwnTriggerPayloadPath(payload, condition.field)
  if (read.status === 'inherited') return unreadableOutcome(condition, 'prototype_path')
  const value = read.status === 'found' ? read.value : undefined
  return { outcome: compareTriggerFilterValue(condition.operator, value, condition.value) ? 'true' : 'false' }
}

/**
 * AND over the conditions, three-valued: any known `false` makes the filter `false` (production's
 * `every` would answer false whatever the unknown conditions are); all `true` makes it `true`;
 * otherwise `unknown`, with the reasons of the unknown conditions. No conditions match everything.
 */
export function evaluateFilterConditionsTri(
  conditions: readonly TriggerFilterCondition[] | null | undefined,
  payload: Record<string, unknown>,
  options: TriggerFilterTriOptions = {},
): TriggerFilterTriResult {
  if (!conditions || conditions.length === 0) return { outcome: 'true', reasons: [] }
  const unknownPaths = options.unknownPaths ?? []
  const reasons = new Set<TriggerFilterUnknownReason>()
  let unknown = false
  for (const condition of conditions) {
    const result = evaluateConditionTri(condition, payload, unknownPaths)
    if (result.outcome === 'false') return { outcome: 'false', reasons: [] }
    if (result.outcome === 'unknown') {
      unknown = true
      if (result.reason) reasons.add(result.reason)
    }
  }
  return unknown ? { outcome: 'unknown', reasons: Array.from(reasons) } : { outcome: 'true', reasons: [] }
}
