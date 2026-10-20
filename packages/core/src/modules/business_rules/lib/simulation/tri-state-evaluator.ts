import type { ComparisonOperator } from '../../data/validators'
import {
  applyOperator,
  evaluateRegexMatch,
  isGroupCondition,
  resolveStaticOrSpecialValue,
  type ConditionExpression,
  type EvaluationContext,
  type GroupCondition,
  type SimpleCondition,
} from '../expression-evaluator'
import { isDangerousPathSegment } from '../value-resolver'

/**
 * Three-valued condition evaluation for the Change Simulator (spec
 * `2026-10-08-insights-change-simulator`, decision S4). Pure: no I/O, no logging.
 *
 * It mirrors `evaluateExpression` operator for operator and answers `'unknown'` only when an
 * input it was given cannot be reconstructed: an adapter-declared unknown path, a rule-log
 * redaction sentinel, or a `MATCHES` test the RE2 guard rejects. A field absent from the data
 * is a known outcome and evaluates exactly as in production. Errors propagate wherever
 * production would certainly throw; when production might throw or answer depending on an
 * unknown input, the result is `'unknown'`. Unknown values are assumed to be JSON values.
 */

export type TriBoolean = true | false | 'unknown'

export const RULE_LOG_REDACTION_SENTINELS = ['[REDACTED]', '[Max depth exceeded]'] as const

export type RuleLogRedactionSentinel = (typeof RULE_LOG_REDACTION_SENTINELS)[number]

export type TriEvaluationOptions = {
  unknownPaths?: readonly string[]
}

export type TriUnknownReason = 'unknown_path' | 'redacted' | 'regex_rejected'

export type TriConditionsOutcome = {
  outcome: 'true' | 'false' | 'unknown' | 'error'
  reason?: TriUnknownReason
}

const OUTCOME_TRUE = 1
const OUTCOME_FALSE = 2
const OUTCOME_ERROR = 4

type TriState = {
  outcomes: number
  reason: TriUnknownReason | null
}

/**
 * `redactedContainer` is the resolved object or array when only values inside it were redacted:
 * its keys and length survive sanitizing, so its emptiness is still known.
 */
type Operand =
  | { known: true; value: unknown }
  | { known: false; reason: TriUnknownReason; redactedContainer?: object }

type TriScope = {
  data: unknown
  context: EvaluationContext
  unknownPaths: readonly string[]
  sentinelScanCache: WeakMap<object, boolean>
}

const ARRAY_INDEX_PATTERN = /\[(\d+)\]/g
const REDACTION_SENTINEL_SET: ReadonlySet<unknown> = new Set<unknown>(RULE_LOG_REDACTION_SENTINELS)

export function isRuleLogRedactionSentinel(value: unknown): value is RuleLogRedactionSentinel {
  return typeof value === 'string' && REDACTION_SENTINEL_SET.has(value)
}

function normalizeFieldPath(path: string): string {
  return path.replace(ARRAY_INDEX_PATTERN, '.$1')
}

function createScope(data: unknown, context: EvaluationContext, options: TriEvaluationOptions | undefined): TriScope {
  const declared = options?.unknownPaths ?? []
  const unknownPaths = declared
    .filter((path): path is string => typeof path === 'string' && path.length > 0)
    .map(normalizeFieldPath)
  return { data, context, unknownPaths, sentinelScanCache: new WeakMap<object, boolean>() }
}

/**
 * A path is unknown when a declared unknown path equals it, is a dotted ancestor of it, or is
 * a dotted descendant of it. A path through a prototype key always resolves to `undefined`
 * in production, so it is never unknown.
 */
function isDeclaredUnknownPath(path: unknown, unknownPaths: readonly string[]): boolean {
  if (unknownPaths.length === 0 || typeof path !== 'string' || path.length === 0) return false
  const normalized = normalizeFieldPath(path)
  if (normalized.split('.').some((segment) => isDangerousPathSegment(segment))) return false
  return unknownPaths.some((declared) =>
    declared === normalized
    || normalized.startsWith(`${declared}.`)
    || declared.startsWith(`${normalized}.`))
}

function containsRedactionSentinel(value: unknown, cache: WeakMap<object, boolean>): boolean {
  if (isRuleLogRedactionSentinel(value)) return true
  if (value === null || typeof value !== 'object') return false
  const pending: unknown[] = [value]
  const visited = new Set<object>()
  let found = false
  while (pending.length > 0) {
    const current = pending.pop()
    if (isRuleLogRedactionSentinel(current)) {
      found = true
      break
    }
    if (current === null || typeof current !== 'object' || visited.has(current)) continue
    const cached = cache.get(current)
    if (cached === false) continue
    if (cached === true) {
      found = true
      break
    }
    visited.add(current)
    const children: readonly unknown[] = Array.isArray(current) ? current : Object.values(current)
    for (const child of children) pending.push(child)
  }
  if (found) {
    cache.set(value, true)
  } else {
    for (const scanned of visited) cache.set(scanned, false)
  }
  return found
}

/**
 * Mirrors `getNestedValue` (falsy data or path, `[n]` normalisation, prototype keys and
 * own-property access) while watching for redaction sentinels on the path, on any ancestor
 * and anywhere inside the resolved value.
 */
function resolveOperand(path: string, scope: TriScope): Operand {
  if (isDeclaredUnknownPath(path, scope.unknownPaths)) return { known: false, reason: 'unknown_path' }
  const { data } = scope
  if (!data || !path) return { known: true, value: undefined }
  const segments = path.replace(ARRAY_INDEX_PATTERN, '.$1').split('.')
  if (isRuleLogRedactionSentinel(data)) return { known: false, reason: 'redacted' }
  let current: unknown = data
  for (const segment of segments) {
    if (current === null || current === undefined) return { known: true, value: undefined }
    if (isDangerousPathSegment(segment)) return { known: true, value: undefined }
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return { known: true, value: undefined }
    current = (current as Record<string, unknown>)[segment]
    if (isRuleLogRedactionSentinel(current)) return { known: false, reason: 'redacted' }
  }
  if (containsRedactionSentinel(current, scope.sentinelScanCache)) {
    return current !== null && typeof current === 'object'
      ? { known: false, reason: 'redacted', redactedContainer: current }
      : { known: false, reason: 'redacted' }
  }
  return { known: true, value: current }
}

function knownState(value: boolean): TriState {
  return { outcomes: value ? OUTCOME_TRUE : OUTCOME_FALSE, reason: null }
}

function unknownState(reason: TriUnknownReason): TriState {
  return { outcomes: OUTCOME_TRUE | OUTCOME_FALSE, reason }
}

function isAmbiguous(state: TriState): boolean {
  return state.outcomes !== OUTCOME_TRUE && state.outcomes !== OUTCOME_FALSE
}

function negateState(state: TriState): TriState {
  let outcomes = state.outcomes & OUTCOME_ERROR
  if (state.outcomes & OUTCOME_TRUE) outcomes |= OUTCOME_FALSE
  if (state.outcomes & OUTCOME_FALSE) outcomes |= OUTCOME_TRUE
  return { outcomes, reason: state.reason }
}

function isKnownNullish(operand: Operand): boolean {
  return operand.known && operand.value == null
}

function cannotContainAnything(container: unknown): boolean {
  if (container == null) return true
  if (Array.isArray(container)) return container.length === 0
  return typeof container !== 'string'
}

function cannotHoldAnything(list: unknown): boolean {
  return !Array.isArray(list) || list.length === 0
}

/**
 * `applyOperator` rejects an unsupported operator before reading its operands, so probing it
 * with nulls throws production's error even when an operand is unknown.
 */
function assertComparisonOperatorSupported(operator: ComparisonOperator): void {
  applyOperator(null, operator, null)
}

/**
 * The production result when it does not depend on the unknown operand, otherwise `null`.
 */
function decideDespiteUnknownOperand(left: Operand, operator: ComparisonOperator, right: Operand): boolean | null {
  switch (operator) {
    case 'IS_EMPTY':
    case 'IS_NOT_EMPTY':
      if (left.known) return applyOperator(left.value, operator, null)
      return left.redactedContainer ? applyOperator(left.redactedContainer, operator, null) : null
    case 'STARTS_WITH':
    case 'ENDS_WITH':
    case 'MATCHES':
      return isKnownNullish(left) || isKnownNullish(right) ? false : null
    case 'CONTAINS':
    case 'NOT_CONTAINS':
      return left.known && cannotContainAnything(left.value) ? operator === 'NOT_CONTAINS' : null
    case 'IN':
    case 'NOT_IN':
      return right.known && cannotHoldAnything(right.value) ? operator === 'NOT_IN' : null
    default:
      return null
  }
}

function compareWithUnknownOperand(
  reason: TriUnknownReason,
  left: Operand,
  operator: ComparisonOperator,
  right: Operand,
): TriState {
  assertComparisonOperatorSupported(operator)
  const decided = decideDespiteUnknownOperand(left, operator, right)
  return decided === null ? unknownState(reason) : knownState(decided)
}

function compareKnownOperands(left: unknown, operator: ComparisonOperator, right: unknown): TriState {
  if (operator === 'MATCHES') {
    const regex = evaluateRegexMatch(left, right)
    return regex.rejected ? unknownState('regex_rejected') : knownState(regex.matched)
  }
  return knownState(applyOperator(left, operator, right))
}

function evaluateSimpleCondition(condition: SimpleCondition, scope: TriScope): TriState {
  const left = resolveOperand(condition.field, scope)
  const right: Operand = condition.valueField
    ? resolveOperand(condition.valueField, scope)
    : { known: true, value: resolveStaticOrSpecialValue(condition.value, scope.context) }
  if (!left.known) return compareWithUnknownOperand(left.reason, left, condition.operator, right)
  if (!right.known) return compareWithUnknownOperand(right.reason, left, condition.operator, right)
  return compareKnownOperands(left.value, condition.operator, right.value)
}

/**
 * `Array.prototype.every` semantics over possible outcomes: stops at the first child that
 * cannot be true, rethrows a child's error only when every earlier child was certainly true
 * (or could only have thrown), and otherwise records the error as one possible outcome.
 */
function evaluateAll(rules: ConditionExpression[], scope: TriScope): TriState {
  let outcomes = 0
  let reason: TriUnknownReason | null = null
  for (const rule of rules) {
    let child: TriState
    try {
      child = evaluateState(rule, scope)
    } catch (error) {
      if ((outcomes & OUTCOME_FALSE) === 0) throw error
      return { outcomes: outcomes | OUTCOME_ERROR, reason }
    }
    if (reason === null && isAmbiguous(child)) reason = child.reason
    outcomes |= child.outcomes & (OUTCOME_FALSE | OUTCOME_ERROR)
    if ((child.outcomes & OUTCOME_TRUE) === 0) return { outcomes, reason }
  }
  return { outcomes: outcomes | OUTCOME_TRUE, reason }
}

/**
 * `Array.prototype.some` semantics over possible outcomes, symmetric to `evaluateAll`.
 */
function evaluateAny(rules: ConditionExpression[], scope: TriScope): TriState {
  let outcomes = 0
  let reason: TriUnknownReason | null = null
  for (const rule of rules) {
    let child: TriState
    try {
      child = evaluateState(rule, scope)
    } catch (error) {
      if ((outcomes & OUTCOME_TRUE) === 0) throw error
      return { outcomes: outcomes | OUTCOME_ERROR, reason }
    }
    if (reason === null && isAmbiguous(child)) reason = child.reason
    outcomes |= child.outcomes & (OUTCOME_TRUE | OUTCOME_ERROR)
    if ((child.outcomes & OUTCOME_FALSE) === 0) return { outcomes, reason }
  }
  return { outcomes: outcomes | OUTCOME_FALSE, reason }
}

function evaluateGroup(condition: GroupCondition, scope: TriScope): TriState {
  const { operator, rules } = condition
  if (!rules || rules.length === 0) return knownState(true)
  switch (operator) {
    case 'AND':
      return evaluateAll(rules, scope)
    case 'OR':
      return evaluateAny(rules, scope)
    case 'NOT':
      return negateState(rules.length === 1 ? evaluateState(rules[0], scope) : evaluateAll(rules, scope))
    default:
      throw new Error(`[internal] Unknown logical operator: ${String(operator)}`)
  }
}

function evaluateState(expression: ConditionExpression, scope: TriScope): TriState {
  if (isGroupCondition(expression)) return evaluateGroup(expression, scope)
  return evaluateSimpleCondition(expression, scope)
}

function toTriBoolean(state: TriState): TriBoolean {
  if (state.outcomes === OUTCOME_TRUE) return true
  if (state.outcomes === OUTCOME_FALSE) return false
  return 'unknown'
}

/**
 * Three-valued counterpart of `evaluateExpression`. Returns `true` / `false` only when
 * production returns that value for every possible value of the unknown inputs, throws when
 * production certainly throws, and returns `'unknown'` otherwise.
 */
export function evaluateExpressionTri(
  expression: ConditionExpression,
  data: unknown,
  context: EvaluationContext,
  options?: TriEvaluationOptions,
): TriBoolean {
  return toTriBoolean(evaluateState(expression, createScope(data, context, options)))
}

/**
 * Three-valued counterpart of `evaluateConditions`: missing conditions pass, a thrown error
 * becomes `'error'`, and an `'unknown'` outcome carries the reason of the first unknown input
 * that made it ambiguous (never a value).
 */
export function evaluateConditionsTri(
  conditions: unknown,
  data: unknown,
  context: EvaluationContext,
  options?: TriEvaluationOptions,
): TriConditionsOutcome {
  if (!conditions) return { outcome: 'true' }
  const scope = createScope(data, context, options)
  let state: TriState
  try {
    state = evaluateState(conditions as ConditionExpression, scope)
  } catch {
    return { outcome: 'error' }
  }
  if (state.outcomes === OUTCOME_TRUE) return { outcome: 'true' }
  if (state.outcomes === OUTCOME_FALSE) return { outcome: 'false' }
  return state.reason ? { outcome: 'unknown', reason: state.reason } : { outcome: 'unknown' }
}
