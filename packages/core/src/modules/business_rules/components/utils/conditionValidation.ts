import type { ComparisonOperator, LogicalOperator } from '../../data/validators'

export type TranslatorFn = (key: string, params?: Record<string, any>) => string

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

/**
 * Valid comparison operators
 */
const VALID_COMPARISON_OPERATORS: ComparisonOperator[] = [
  '=',
  '==',
  '!=',
  '>',
  '>=',
  '<',
  '<=',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'ENDS_WITH',
  'MATCHES',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
]

/**
 * Valid logical operators
 */
const VALID_LOGICAL_OPERATORS: LogicalOperator[] = ['AND', 'OR', 'NOT']

export type SimpleCondition = {
  field: string
  operator: ComparisonOperator
  value: any
  valueField?: string
}

export type GroupCondition = {
  operator: LogicalOperator
  rules: ConditionExpression[]
}

export type ConditionExpression = SimpleCondition | GroupCondition

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
    if (!VALID_LOGICAL_OPERATORS.includes(expr.operator)) {
      errors.push(translate('business_rules.validation.condition.invalidLogicalOperator', { operator: expr.operator, validOperators: VALID_LOGICAL_OPERATORS.join(', ') }))
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
    } else if (!VALID_COMPARISON_OPERATORS.includes(expr.operator)) {
      errors.push(translate('business_rules.validation.condition.invalidComparisonOperator', { operator: expr.operator, validOperators: VALID_COMPARISON_OPERATORS.join(', ') }))
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
  return [
    { value: '=', label: t('business_rules.validation.operators.equals') },
    { value: '==', label: t('business_rules.validation.operators.equalsStrict') },
    { value: '!=', label: t('business_rules.validation.operators.notEquals') },
    { value: '>', label: t('business_rules.validation.operators.greaterThan') },
    { value: '>=', label: t('business_rules.validation.operators.greaterThanOrEqual') },
    { value: '<', label: t('business_rules.validation.operators.lessThan') },
    { value: '<=', label: t('business_rules.validation.operators.lessThanOrEqual') },
    { value: 'IN', label: t('business_rules.validation.operators.in') },
    { value: 'NOT_IN', label: t('business_rules.validation.operators.notIn') },
    { value: 'CONTAINS', label: t('business_rules.validation.operators.contains') },
    { value: 'NOT_CONTAINS', label: t('business_rules.validation.operators.notContains') },
    { value: 'STARTS_WITH', label: t('business_rules.validation.operators.startsWith') },
    { value: 'ENDS_WITH', label: t('business_rules.validation.operators.endsWith') },
    { value: 'MATCHES', label: t('business_rules.validation.operators.matches') },
    { value: 'IS_EMPTY', label: t('business_rules.validation.operators.isEmpty') },
    { value: 'IS_NOT_EMPTY', label: t('business_rules.validation.operators.isNotEmpty') },
  ]
}

/**
 * Get logical operators
 */
export function getLogicalOperators(t: TranslatorFn): { value: LogicalOperator; label: string }[] {
  return [
    { value: 'AND', label: t('business_rules.validation.logical.and') },
    { value: 'OR', label: t('business_rules.validation.logical.or') },
    { value: 'NOT', label: t('business_rules.validation.logical.not') },
  ]
}
