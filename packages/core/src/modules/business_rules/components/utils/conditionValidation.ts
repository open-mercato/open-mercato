import type { ComparisonOperator, LogicalOperator } from '../../data/validators'

export type ValidationResult = {
  valid: boolean
  errors: string[]
}

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
    if (!['AND', 'OR', 'NOT'].includes(expr.operator)) {
      errors.push(`Invalid logical operator: ${expr.operator}`)
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
      errors.push('Field is required and must be a string')
    }

    if (!expr.operator) {
      errors.push('Operator is required')
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
