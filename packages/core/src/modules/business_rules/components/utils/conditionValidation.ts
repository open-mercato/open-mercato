import type { ComparisonOperator, LogicalOperator } from '../../data/validators'

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
export function validateConditionExpression(expr: any, depth = 0, maxDepth = 5): ValidationResult {
  const errors: string[] = []

  if (!expr) {
    return { valid: true, errors: [] } // Null/undefined is valid (optional)
  }

  if (depth > maxDepth) {
    errors.push(`Maximum nesting depth (${maxDepth}) exceeded`)
    return { valid: false, errors }
  }

  if (isGroupCondition(expr)) {
    // Validate group condition
    if (!VALID_LOGICAL_OPERATORS.includes(expr.operator)) {
      errors.push(`Invalid logical operator: "${expr.operator}". Valid operators are: ${VALID_LOGICAL_OPERATORS.join(', ')}`)
    }

    if (!Array.isArray(expr.rules) || expr.rules.length === 0) {
      errors.push('Group must have at least one rule')
    } else {
      // Recursively validate nested rules
      expr.rules.forEach((rule, index) => {
        const result = validateConditionExpression(rule, depth + 1, maxDepth)
        if (!result.valid) {
          errors.push(`Rule ${index + 1}: ${result.errors.join(', ')}`)
        }
      })
    }
  } else if (isSimpleCondition(expr)) {
    // Validate simple condition
    if (!expr.field || typeof expr.field !== 'string') {
      errors.push('Field path is required for simple conditions')
    } else if (!isValidFieldPath(expr.field)) {
      errors.push(`Invalid field path format: "${expr.field}". Field paths must start with a letter or underscore, and contain only letters, numbers, underscores, dots, and brackets`)
    }

    if (!expr.operator) {
      errors.push('Operator is required')
    } else if (!VALID_COMPARISON_OPERATORS.includes(expr.operator)) {
      errors.push(`Invalid comparison operator: "${expr.operator}". Valid operators are: ${VALID_COMPARISON_OPERATORS.join(', ')}`)
    }

    if (expr.value === undefined && !expr.valueField) {
      errors.push('Value or valueField is required')
    }

    if (expr.valueField && typeof expr.valueField !== 'string') {
      errors.push('valueField must be a string')
    }
  } else {
    errors.push('Invalid condition expression structure')
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
export function getComparisonOperators(): { value: ComparisonOperator; label: string }[] {
  return [
    { value: '=', label: 'Equals' },
    { value: '==', label: 'Equals (strict)' },
    { value: '!=', label: 'Not equals' },
    { value: '>', label: 'Greater than' },
    { value: '>=', label: 'Greater than or equal' },
    { value: '<', label: 'Less than' },
    { value: '<=', label: 'Less than or equal' },
    { value: 'IN', label: 'In list' },
    { value: 'NOT_IN', label: 'Not in list' },
    { value: 'CONTAINS', label: 'Contains' },
    { value: 'NOT_CONTAINS', label: 'Does not contain' },
    { value: 'STARTS_WITH', label: 'Starts with' },
    { value: 'ENDS_WITH', label: 'Ends with' },
    { value: 'MATCHES', label: 'Matches regex' },
    { value: 'IS_EMPTY', label: 'Is empty' },
    { value: 'IS_NOT_EMPTY', label: 'Is not empty' },
  ]
}

/**
 * Get logical operators
 */
export function getLogicalOperators(): { value: LogicalOperator; label: string }[] {
  return [
    { value: 'AND', label: 'AND' },
    { value: 'OR', label: 'OR' },
    { value: 'NOT', label: 'NOT' },
  ]
}
