/**
 * Workflows Module - Event trigger filter evaluation (pure).
 *
 * The filter semantics of event triggers (`config.filterConditions`, AND logic) used by
 * `lib/event-trigger-service.ts` in production and by the change simulator's trigger backtest.
 * No I/O, no logging: one comparison function serves both, so the simulator cannot drift from
 * production operator by operator.
 */

import { testLinearRegex } from '@open-mercato/shared/lib/regex/linear'
import type { TriggerFilterCondition, TriggerFilterOperator } from '../data/entities'

export const MAX_WORKFLOW_REGEX_PATTERN_LENGTH = 200
export const MAX_WORKFLOW_REGEX_INPUT_LENGTH = 10_000

/**
 * The production payload accessor of triggers: a dot path read with plain property access, so a
 * segment naming a member inherited from the prototype chain (`constructor`, `toString`, an array
 * method) resolves to that member. Kept as it is for production; the simulator reads payloads
 * through `readOwnTriggerPayloadPath` instead.
 */
export function getTriggerPayloadValue(obj: unknown, path: string): unknown {
  if (obj === null || obj === undefined) return undefined

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

export type TriggerPayloadPathRead =
  | { status: 'found'; value: unknown }
  | { status: 'absent' }
  | { status: 'inherited' }

/**
 * An own-property read of a trigger payload path. It walks the path exactly like
 * `getTriggerPayloadValue` (dot split, non-objects end the walk) but only through own properties:
 * `found` and `absent` give the value production reads (`absent` = `undefined`); `inherited` means a
 * segment exists only on the prototype chain, where production would read a built-in member — the
 * accessor refuses such paths instead of reading them.
 */
export function readOwnTriggerPayloadPath(obj: unknown, path: string): TriggerPayloadPathRead {
  if (obj === null || obj === undefined) return { status: 'absent' }

  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return { status: 'absent' }
    if (typeof current !== 'object') return { status: 'absent' }
    if (Object.prototype.hasOwnProperty.call(current, part)) {
      current = (current as Record<string, unknown>)[part]
      continue
    }
    return part in (current as object) ? { status: 'inherited' } : { status: 'absent' }
  }

  return { status: 'found', value: current }
}

function getQuantifierEnd(pattern: string, index: number): number | null {
  const char = pattern[index]
  if (char === '*' || char === '+' || char === '?') return index
  if (char !== '{') return null

  const closeIndex = pattern.indexOf('}', index + 1)
  if (closeIndex === -1) return null

  const body = pattern.slice(index + 1, closeIndex)
  return /^[0-9]+(?:,[0-9]*)?$/.test(body) ? closeIndex : null
}

interface RegexGroupFrame {
  hasAlternation: boolean
  hasQuantifier: boolean
}

export function isSafeWorkflowRegexPattern(pattern: string): boolean {
  if (pattern.length > MAX_WORKFLOW_REGEX_PATTERN_LENGTH) return false

  const groupStack: RegexGroupFrame[] = [{ hasAlternation: false, hasQuantifier: false }]
  let inCharClass = false
  let lastClosedGroup: RegexGroupFrame | null = null
  let lastAtomWasQuantified = false

  // Hand-written single-pass lexer: `index` is intentionally advanced inside the
  // loop body (escape pairs, `(?:` prefixes, multi-char quantifiers, lazy `?`) on
  // top of the `index += 1` update clause. Do not "simplify" these in-body writes.
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]

    if (char === '\\') {
      const next = pattern[index + 1]
      if (!inCharClass && (/[1-9]/.test(next ?? '') || (next === 'k' && pattern[index + 2] === '<'))) {
        return false
      }
      index += 1
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (inCharClass) {
      if (char === ']') {
        inCharClass = false
        lastAtomWasQuantified = false
      }
      lastClosedGroup = null
      continue
    }

    if (char === '[') {
      inCharClass = true
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (char === '(') {
      if (pattern[index + 1] === '?') {
        if (pattern[index + 2] !== ':') return false
        index += 2
      }

      groupStack.push({ hasAlternation: false, hasQuantifier: false })
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    if (char === ')') {
      if (groupStack.length === 1) return false
      lastClosedGroup = groupStack.pop()!
      lastAtomWasQuantified = false
      continue
    }

    if (char === '|') {
      groupStack[groupStack.length - 1].hasAlternation = true
      lastClosedGroup = null
      lastAtomWasQuantified = false
      continue
    }

    const quantifierEnd = getQuantifierEnd(pattern, index)
    if (quantifierEnd !== null) {
      if (lastAtomWasQuantified) return false
      if (lastClosedGroup?.hasAlternation || lastClosedGroup?.hasQuantifier) return false

      groupStack[groupStack.length - 1].hasQuantifier = true
      lastClosedGroup = null
      lastAtomWasQuantified = true
      index = quantifierEnd

      if (pattern[index + 1] === '?') {
        index += 1
      }

      continue
    }

    lastClosedGroup = null
    lastAtomWasQuantified = false
  }

  return groupStack.length === 1 && !inCharClass
}

const LINEAR_REGEX_LIMITS = {
  maxPatternLength: MAX_WORKFLOW_REGEX_PATTERN_LENGTH,
  maxInputLength: MAX_WORKFLOW_REGEX_INPUT_LENGTH,
} as const

/** One filter comparison of a resolved payload value with the condition's expected value. */
export function compareTriggerFilterValue(operator: TriggerFilterOperator, value: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return value === expected

    case 'neq':
      return value !== expected

    case 'gt':
      return typeof value === 'number' && typeof expected === 'number' && value > expected

    case 'gte':
      return typeof value === 'number' && typeof expected === 'number' && value >= expected

    case 'lt':
      return typeof value === 'number' && typeof expected === 'number' && value < expected

    case 'lte':
      return typeof value === 'number' && typeof expected === 'number' && value <= expected

    case 'contains':
      if (typeof value === 'string' && typeof expected === 'string') {
        return value.includes(expected)
      }
      if (Array.isArray(value)) {
        return value.includes(expected)
      }
      return false

    case 'startsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.startsWith(expected)

    case 'endsWith':
      return typeof value === 'string' && typeof expected === 'string' && value.endsWith(expected)

    case 'in':
      return Array.isArray(expected) && expected.includes(value)

    case 'notIn':
      return Array.isArray(expected) && !expected.includes(value)

    case 'exists':
      return value !== undefined && value !== null

    case 'notExists':
      return value === undefined || value === null

    case 'regex':
      if (typeof value !== 'string' || typeof expected !== 'string') return false
      if (value.length > MAX_WORKFLOW_REGEX_INPUT_LENGTH) return false
      if (!isSafeWorkflowRegexPattern(expected)) return false
      {
        const result = testLinearRegex(expected, value, LINEAR_REGEX_LIMITS)
        return result.ok ? result.matched : false
      }

    default:
      return false
  }
}

/**
 * The outcome `compareTriggerFilterValue` gives for EVERY payload value, or `null` when it depends
 * on the value: a numeric comparison with a non-numeric (or NaN) expected value, a string operator
 * with a non-string one, `in` / `notIn` without an array or with an empty one, a regex the guard
 * refuses, an unknown operator. Lets the simulator keep a condition known when its input is not.
 */
export function constantTriggerFilterResult(operator: TriggerFilterOperator, expected: unknown): boolean | null {
  switch (operator) {
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return typeof expected === 'number' && !Number.isNaN(expected) ? null : false
    case 'startsWith':
    case 'endsWith':
      return typeof expected === 'string' ? null : false
    case 'in':
      return Array.isArray(expected) && expected.length > 0 ? null : false
    case 'notIn':
      if (!Array.isArray(expected)) return false
      return expected.length > 0 ? null : true
    case 'regex':
      if (typeof expected !== 'string' || !isSafeWorkflowRegexPattern(expected)) return false
      return testLinearRegex(expected, '', LINEAR_REGEX_LIMITS).ok ? null : false
    case 'eq':
    case 'neq':
    case 'contains':
    case 'exists':
    case 'notExists':
      return null
    default:
      return false
  }
}

/**
 * Evaluate a single filter condition against the event payload.
 */
export function evaluateTriggerFilterCondition(condition: TriggerFilterCondition, payload: Record<string, unknown>): boolean {
  return compareTriggerFilterValue(condition.operator, getTriggerPayloadValue(payload, condition.field), condition.value)
}

/**
 * Evaluate all filter conditions against the event payload.
 * All conditions must pass (AND logic).
 */
export function evaluateTriggerFilterConditions(
  conditions: TriggerFilterCondition[] | undefined,
  payload: Record<string, unknown>
): boolean {
  if (!conditions || conditions.length === 0) return true

  return conditions.every(condition => evaluateTriggerFilterCondition(condition, payload))
}
