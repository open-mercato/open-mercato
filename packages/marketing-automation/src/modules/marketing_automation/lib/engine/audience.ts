import { evaluateExpression } from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import type {
  ConditionExpression,
  GroupCondition,
  SimpleCondition,
} from '@open-mercato/core/modules/business_rules/lib/expression-evaluator'
import { getNestedValue } from '@open-mercato/core/modules/business_rules/lib/value-resolver'
import type { EngineLogger, SubjectDocument } from './types.js'

/**
 * A campaign with no audience expression applies to everyone the trigger produces.
 *
 * Named because it is the one place where "unconfigured" and "send to all" look the same in
 * storage; the distinction is enforced in the authoring UI instead.
 */
export const NO_AUDIENCE_RESULT = true

/**
 * An audience expression that throws excludes the subject.
 *
 * Fail closed: if we cannot establish that somebody belongs in the audience, we do not
 * message them. A malformed expression is a bug, and the safe failure for a bug in a sending
 * system is to send nothing.
 */
export const AUDIENCE_ERROR_RESULT = false

/** An empty group excludes the subject, rather than inheriting AND's vacuous truth. */
export const EMPTY_GROUP_RESULT = false

/**
 * Comparisons where a missing left-hand value must NOT be treated as a value.
 *
 * The platform evaluator's `compare()` returns -1 when the left side is null or undefined
 * (`expression-evaluator.ts`), which sorts "no data" below every number. That is reasonable
 * for ordering and wrong for filtering: it makes `orders.daysSinceLast <= 30` true for a
 * customer who has never ordered, so a win-back campaign would mail everybody who never
 * bought anything. We veto those leaves before the evaluator sees them.
 *
 * Equality, membership and emptiness operators are deliberately NOT vetoed — asking whether a
 * missing value equals something, or is empty, is a meaningful question with a correct answer.
 */
const MAGNITUDE_OPERATORS = new Set(['>', '>=', '<', '<='])

function isGroupCondition(expression: ConditionExpression): expression is GroupCondition {
  return Array.isArray((expression as GroupCondition).rules)
}

/**
 * True when this leaf compares magnitudes against a value the subject does not have.
 *
 * Kept separate from evaluation so the reason a subject was excluded stays legible.
 */
function hasMissingMagnitudeOperand(leaf: SimpleCondition, subject: SubjectDocument): boolean {
  if (!MAGNITUDE_OPERATORS.has(leaf.operator)) return false
  const actual = getNestedValue(subject, leaf.field)
  return actual === null || actual === undefined
}

function evaluateNode(
  expression: ConditionExpression,
  subject: SubjectDocument,
  context: { now: Date; today: Date },
): boolean {
  if (isGroupCondition(expression)) {
    const rules = expression.rules ?? []
    if (rules.length === 0) return EMPTY_GROUP_RESULT

    switch (expression.operator) {
      case 'OR':
        return rules.some((rule) => evaluateNode(rule, subject, context))
      case 'NOT':
        // Mirrors the platform's own NOT semantics: a single rule is negated, several are
        // combined with AND and then negated.
        return !rules.every((rule) => evaluateNode(rule, subject, context))
      case 'AND':
      default:
        return rules.every((rule) => evaluateNode(rule, subject, context))
    }
  }

  if (hasMissingMagnitudeOperand(expression, subject)) return false

  return evaluateExpression(expression, subject, context)
}

/**
 * Decides whether a subject belongs in a campaign's audience.
 *
 * Comparison semantics come from the platform's own expression evaluator — the same operators
 * and the same `field` path resolution the rest of Open Mercato uses, which is what lets the
 * existing condition builder UI edit these expressions unchanged. Only the boolean combination
 * is ours, so that a missing operand can veto a magnitude comparison instead of silently
 * passing it.
 */
export function matchesAudience(
  audience: ConditionExpression | null | undefined,
  subject: SubjectDocument,
  { now, logger, campaignId }: { now: Date; logger: EngineLogger; campaignId?: string },
): boolean {
  if (!audience) return NO_AUDIENCE_RESULT

  try {
    return evaluateNode(audience, subject, { now, today: now })
  } catch (error) {
    logger.error('[internal] marketing audience expression failed', {
      campaignId,
      error: error instanceof Error ? error.message : String(error),
    })
    return AUDIENCE_ERROR_RESULT
  }
}
