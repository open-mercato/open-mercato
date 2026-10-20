import { toDateInputValue } from '@open-mercato/shared/lib/date/format'

export type RuleFormValues = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The rule definition of the CURRENT business rule form values, exactly as the rule editor sends
 * it on save (`buildRulePayload`): empty optional texts and dates become `null`, missing action
 * lists `null`; scope and audit fields are never part of a proposal.
 */
export function buildRuleBacktestProposal(values: RuleFormValues): Record<string, unknown> {
  return {
    ruleId: values.ruleId,
    ruleName: values.ruleName,
    description: values.description || null,
    ruleType: values.ruleType,
    ruleCategory: values.ruleCategory || null,
    entityType: values.entityType,
    eventType: values.eventType || null,
    conditionExpression: values.conditionExpression,
    successActions: values.successActions || null,
    failureActions: values.failureActions || null,
    enabled: values.enabled,
    priority: values.priority,
    version: values.version,
    effectiveFrom: values.effectiveFrom || null,
    effectiveTo: values.effectiveTo || null,
  }
}

function normalizeConditionExpression(value: unknown): unknown {
  if (!isRecord(value)) return value
  const operator = value.operator
  if (typeof operator === 'string' && /^(AND|OR)$/.test(operator)) return value
  return { operator: 'AND', rules: [value] }
}

/**
 * The form values of a simulated rule proposal (the inverse of `buildRuleBacktestProposal`, as the
 * rule editor loads a saved rule): a single condition is wrapped in an `AND` group and dates go
 * back to `YYYY-MM-DD`. Returns `null` for anything that is not a rule definition.
 */
export function ruleProposalToFormValues(proposal: unknown): RuleFormValues | null {
  if (!isRecord(proposal)) return null
  if (typeof proposal.ruleId !== 'string' || typeof proposal.entityType !== 'string') return null
  const effectiveFrom = typeof proposal.effectiveFrom === 'string' ? proposal.effectiveFrom : null
  const effectiveTo = typeof proposal.effectiveTo === 'string' ? proposal.effectiveTo : null
  return {
    ruleId: proposal.ruleId,
    ruleName: proposal.ruleName,
    description: proposal.description ?? null,
    ruleType: proposal.ruleType,
    ruleCategory: proposal.ruleCategory ?? null,
    entityType: proposal.entityType,
    eventType: proposal.eventType ?? null,
    conditionExpression: normalizeConditionExpression(proposal.conditionExpression),
    successActions: proposal.successActions ?? null,
    failureActions: proposal.failureActions ?? null,
    enabled: proposal.enabled,
    priority: proposal.priority,
    version: proposal.version,
    effectiveFrom: toDateInputValue(effectiveFrom),
    effectiveTo: toDateInputValue(effectiveTo),
  }
}
