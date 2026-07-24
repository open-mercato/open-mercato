import {
  CONDITION_COMPARISON_OPERATORS,
  CONDITION_LOGICAL_OPERATORS,
  type ConditionComparisonOperator as ComparisonOperator,
  type ConditionLogicalOperator as LogicalOperator,
} from '@open-mercato/shared/modules/conditions'
import type {
  ConditionExpression as LegacyConditionExpression,
  GroupCondition as LegacyGroupCondition,
  SimpleCondition as LegacySimpleCondition,
} from '../../lib/expression-evaluator'

export type SimpleCondition = LegacySimpleCondition
export type GroupCondition = LegacyGroupCondition
export type ConditionExpression = LegacyConditionExpression

export type TranslatorFn = (key: string, params?: Record<string, any>) => string

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

const COMPARISON_OPERATOR_LABEL_KEYS = {
  '=': 'business_rules.validation.operators.equals',
  '==': 'business_rules.validation.operators.equalsStrict',
  '!=': 'business_rules.validation.operators.notEquals',
  '>': 'business_rules.validation.operators.greaterThan',
  '>=': 'business_rules.validation.operators.greaterThanOrEqual',
  '<': 'business_rules.validation.operators.lessThan',
  '<=': 'business_rules.validation.operators.lessThanOrEqual',
  IN: 'business_rules.validation.operators.in',
  NOT_IN: 'business_rules.validation.operators.notIn',
  CONTAINS: 'business_rules.validation.operators.contains',
  NOT_CONTAINS: 'business_rules.validation.operators.notContains',
  STARTS_WITH: 'business_rules.validation.operators.startsWith',
  ENDS_WITH: 'business_rules.validation.operators.endsWith',
  MATCHES: 'business_rules.validation.operators.matches',
  IS_EMPTY: 'business_rules.validation.operators.isEmpty',
  IS_NOT_EMPTY: 'business_rules.validation.operators.isNotEmpty',
} satisfies Record<ComparisonOperator, string>

const LOGICAL_OPERATOR_LABEL_KEYS = {
  AND: 'business_rules.validation.logical.and',
  OR: 'business_rules.validation.logical.or',
  NOT: 'business_rules.validation.logical.not',
} satisfies Record<LogicalOperator, string>

/**
 * Check if expression is a group condition
 */
export function isGroupCondition(expr: any): expr is GroupCondition {
  return expr && typeof expr === 'object' && 'operator' in expr && 'rules' in expr && Array.isArray(expr.rules)
}

/**
 * Check if expression is a simple condition
 */
export function isSimpleCondition(expr: any): expr is SimpleCondition {
  return expr && typeof expr === 'object' && 'field' in expr && 'operator' in expr && 'value' in expr
}

/**
 * Validate condition expression recursively
 */
export function validateConditionExpression(expr: any, depth = 0, maxDepth = 5, t?: TranslatorFn): ValidationResult {
  const errors: string[] = []
  const translate = t || ((key: string) => key)

  if (!expr) {
    return { valid: true, errors: [] } // Null/undefined is valid (optional)
  }

  if (depth > maxDepth) {
    errors.push(translate('business_rules.validation.condition.maxDepthExceeded', { maxDepth }))
    return { valid: false, errors }
  }

  if (isGroupCondition(expr)) {
    // Validate group condition
    if (!CONDITION_LOGICAL_OPERATORS.includes(expr.operator)) {
      errors.push(translate('business_rules.validation.condition.invalidLogicalOperator', { operator: expr.operator, validOperators: CONDITION_LOGICAL_OPERATORS.join(', ') }))
    }

    if (!Array.isArray(expr.rules) || expr.rules.length === 0) {
      errors.push(translate('business_rules.validation.condition.groupMustHaveRules'))
    } else {
      // Recursively validate nested rules
      expr.rules.forEach((rule, index) => {
        const result = validateConditionExpression(rule, depth + 1, maxDepth, t)
        if (!result.valid) {
          errors.push(translate('business_rules.validation.condition.ruleError', { index: index + 1, errors: result.errors.join(', ') }))
        }
      })
    }
  } else if (isSimpleCondition(expr)) {
    // Validate simple condition
    if (!expr.field || typeof expr.field !== 'string') {
      errors.push(translate('business_rules.validation.condition.fieldRequired'))
    } else if (!isValidFieldPath(expr.field)) {
      errors.push(translate('business_rules.validation.condition.invalidFieldPath', { field: expr.field }))
    }

    if (!expr.operator) {
      errors.push(translate('business_rules.validation.condition.operatorRequired'))
    } else if (!CONDITION_COMPARISON_OPERATORS.includes(expr.operator)) {
      errors.push(translate('business_rules.validation.condition.invalidComparisonOperator', { operator: expr.operator, validOperators: CONDITION_COMPARISON_OPERATORS.join(', ') }))
    }

    if (expr.value === undefined && !expr.valueField) {
      errors.push(translate('business_rules.validation.condition.valueRequired'))
    }

    if (expr.valueField && typeof expr.valueField !== 'string') {
      errors.push(translate('business_rules.validation.condition.valueFieldMustBeString'))
    }
  } else {
    errors.push(translate('business_rules.validation.condition.invalidStructure'))
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * Validate field path format
 */
export function isValidFieldPath(path: string): boolean {
  if (!path || typeof path !== 'string') return false
  // Allow alphanumeric, dots, brackets, and underscores
  return /^[a-zA-Z_][a-zA-Z0-9_.\[\]]*$/.test(path)
}

/**
 * Get available comparison operators
 */
export function getComparisonOperators(t: TranslatorFn): { value: ComparisonOperator; label: string }[] {
  return CONDITION_COMPARISON_OPERATORS.map((value) => ({
    value,
    label: t(COMPARISON_OPERATOR_LABEL_KEYS[value]),
  }))
}

/**
 * Get logical operators
 */
export function getLogicalOperators(t: TranslatorFn): { value: LogicalOperator; label: string }[] {
  return CONDITION_LOGICAL_OPERATORS.map((value) => ({
    value,
    label: t(LOGICAL_OPERATOR_LABEL_KEYS[value]),
  }))
}
