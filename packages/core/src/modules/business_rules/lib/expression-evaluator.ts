import type { ComparisonOperator, LogicalOperator } from '../data/validators'
import { getNestedValue, resolveSpecialValue } from './value-resolver'

/**
 * Type definitions for condition expressions
 */
export type ConditionExpression = SimpleCondition | GroupCondition

export interface SimpleCondition {
  field: string
  operator: ComparisonOperator
  value: any
  valueField?: string // For field-to-field comparison
}

export interface GroupCondition {
  operator: LogicalOperator // 'AND' | 'OR' | 'NOT'
  rules: ConditionExpression[]
}

export interface EvaluationContext {
  user?: {
    id?: string
    email?: string
    role?: string
    [key: string]: any
  }
  tenant?: {
    id?: string
    [key: string]: any
  }
  organization?: {
    id?: string
    [key: string]: any
  }
  now?: Date
  today?: Date
  [key: string]: any
}

/**
 * Evaluate a condition expression (simple or grouped)
 */
export function evaluateExpression(
  expression: ConditionExpression,
  data: any,
  context: EvaluationContext
): boolean {
  if (isGroupCondition(expression)) {
    return evaluateGroupCondition(expression, data, context)
  }

  return evaluateSimpleCondition(expression, data, context)
}

/**
 * Check if expression is a group condition
 */
function isGroupCondition(expression: ConditionExpression): expression is GroupCondition {
  return 'rules' in expression && Array.isArray(expression.rules)
}

/**
 * Evaluate a simple condition
 */
function evaluateSimpleCondition(
  condition: SimpleCondition,
  data: any,
  context: EvaluationContext
): boolean {
  // Left side: always resolve from data (field path)
  const leftValue = resolveFieldPath(condition.field, data)

  let rightValue: any
  if (condition.valueField) {
    // Field-to-field comparison: resolve from data
    rightValue = resolveFieldPath(condition.valueField, data)
  } else {
    // Static value or special value
    rightValue = resolveStaticOrSpecialValue(condition.value, context)
  }

  return applyOperator(leftValue, condition.operator, rightValue)
}

/**
 * Evaluate a group condition (AND, OR, NOT)
 */
function evaluateGroupCondition(
  condition: GroupCondition,
  data: any,
  context: EvaluationContext
): boolean {
  const { operator, rules } = condition

  if (!rules || rules.length === 0) {
    return true
  }

  switch (operator) {
    case 'AND':
      return rules.every((rule) => evaluateExpression(rule, data, context))

    case 'OR':
      return rules.some((rule) => evaluateExpression(rule, data, context))

    case 'NOT':
      // NOT operator - negate the first rule (or all rules combined with AND)
      if (rules.length === 1) {
        return !evaluateExpression(rules[0], data, context)
      }
      // Multiple rules - combine with AND then negate
      return !rules.every((rule) => evaluateExpression(rule, data, context))

    default:
      throw new Error(`Unknown logical operator: ${operator}`)
  }
}

/**
 * Resolve a field path from data
 */
function resolveFieldPath(path: string, data: any): any {
  return getNestedValue(data, path)
}

/**
 * Resolve a static value or special template value
 */
function resolveStaticOrSpecialValue(value: any, context: EvaluationContext): any {
  // If not a string, return as-is (already a value)
  if (typeof value !== 'string') {
    return value
  }

  // Check for special values (template variables)
  if (value.startsWith('{{') && value.endsWith('}}')) {
    return resolveSpecialValue(value, context)
  }

  // Return static string value as-is
  return value
}

/**
 * Apply a comparison operator
 */
function applyOperator(left: any, operator: ComparisonOperator, right: any): boolean {
  switch (operator) {
    case '=':
    case '==':
      return equals(left, right)

    case '!=':
      return !equals(left, right)

    case '>':
      return compare(left, right) > 0

    case '>=':
      return compare(left, right) >= 0

    case '<':
      return compare(left, right) < 0

    case '<=':
      return compare(left, right) <= 0

    case 'IN':
      return isIn(left, right)

    case 'NOT_IN':
      return !isIn(left, right)

    case 'CONTAINS':
      return contains(left, right)

    case 'NOT_CONTAINS':
      return !contains(left, right)

    case 'STARTS_WITH':
      return startsWith(left, right)

    case 'ENDS_WITH':
      return endsWith(left, right)

    case 'MATCHES':
      return matches(left, right)

    case 'IS_EMPTY':
      return isEmpty(left)

    case 'IS_NOT_EMPTY':
      return !isEmpty(left)

    default:
      throw new Error(`Unknown operator: ${operator}`)
  }
}

/**
 * Equality comparison (handles different types)
 */
function equals(left: any, right: any): boolean {
  // Handle null/undefined
  if (left == null && right == null) return true
  if (left == null || right == null) return false

  // Type coercion for numbers
  if (typeof left === 'number' || typeof right === 'number') {
    return Number(left) === Number(right)
  }

  // String comparison (case-sensitive)
  return left === right
}

/**
 * Comparison for ordering (>, <, >=, <=)
 */
function compare(left: any, right: any): number {
  // Handle null/undefined
  if (left == null && right == null) return 0
  if (left == null) return -1
  if (right == null) return 1

  // Date comparison
  if (left instanceof Date && right instanceof Date) {
    return left.getTime() - right.getTime()
  }

  // String date comparison
  if (isDateString(left) && isDateString(right)) {
    return new Date(left).getTime() - new Date(right).getTime()
  }

  // Numeric comparison
  const leftNum = Number(left)
  const rightNum = Number(right)
  if (!isNaN(leftNum) && !isNaN(rightNum)) {
    return leftNum - rightNum
  }

  // String comparison
  const leftStr = String(left)
  const rightStr = String(right)
  return leftStr.localeCompare(rightStr)
}

/**
 * Check if value is in array
 */
function isIn(value: any, array: any): boolean {
  if (!Array.isArray(array)) {
    return false
  }

  return array.some((item) => equals(value, item))
}

/**
 * Check if array/string contains value
 */
function contains(container: any, value: any): boolean {
  if (container == null) return false

  // Array contains
  if (Array.isArray(container)) {
    return container.some((item) => equals(item, value))
  }

  // String contains
  if (typeof container === 'string') {
    return container.includes(String(value))
  }

  return false
}

/**
 * Check if string starts with value
 */
function startsWith(str: any, prefix: any): boolean {
  if (str == null || prefix == null) return false

  return String(str).startsWith(String(prefix))
}

/**
 * Check if string ends with value
 */
function endsWith(str: any, suffix: any): boolean {
  if (str == null || suffix == null) return false

  return String(str).endsWith(String(suffix))
}

/**
 * Check if string matches regex pattern
 */
function matches(str: any, pattern: any): boolean {
  if (str == null || pattern == null) return false

  try {
    const regex = new RegExp(String(pattern))
    return regex.test(String(str))
  } catch {
    return false
  }
}

/**
 * Check if value is empty (null, undefined, empty string, empty array, empty object)
 */
function isEmpty(value: any): boolean {
  if (value == null) return true

  if (typeof value === 'string') return value.trim() === ''

  if (Array.isArray(value)) return value.length === 0

  if (typeof value === 'object') return Object.keys(value).length === 0

  return false
}

/**
 * Check if string looks like a date (ISO format or common date formats)
 */
function isDateString(value: any): boolean {
  if (typeof value !== 'string') return false

  // ISO date format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/
  if (isoDateRegex.test(value)) {
    const date = new Date(value)
    return !isNaN(date.getTime())
  }

  return false
}
