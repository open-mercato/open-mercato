/**
 * Server-side validation for business rule payloads
 *
 * This module provides validation for condition expressions and actions
 * before they are stored in the database. It reuses client-side validation
 * utilities to maintain consistency.
 */

import { validateConditionExpression, isValidFieldPath } from '../components/utils/conditionValidation'
import { validateActions } from '../components/utils/actionValidation'
import type { ConditionExpression, TranslatorFn } from '../components/utils/conditionValidation'
import type { Action } from '../components/utils/actionValidation'

/**
 * Validation result returned by validation functions
 */
export interface ValidationResult {
  valid: boolean
  error?: string
  errors?: string[]
}

/**
 * Validate condition expression for API usage
 *
 * @param expression - Condition expression to validate
 * @param t - Optional translator function for i18n support
 * @returns Validation result with error messages
 */
export function validateConditionExpressionForApi(
  expression: any,
  t?: TranslatorFn
): ValidationResult {
  // Null/undefined is valid (optional field)
  if (expression === null || expression === undefined) {
    return { valid: true }
  }

  try {
    const result = validateConditionExpression(expression as ConditionExpression, 0, 5, t)

    if (result.valid) {
      return { valid: true }
    }

    return {
      valid: false,
      error: `Invalid condition expression: ${result.errors.join('; ')}`,
      errors: result.errors,
    }
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate condition expression: ${error instanceof Error ? error.message : 'Unknown error'}`,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

/**
 * Validate actions array for API usage
 *
 * @param actions - Array of actions to validate
 * @param fieldName - Name of field being validated (for error messages)
 * @param t - Optional translator function for i18n support
 * @returns Validation result with error messages
 */
export function validateActionsForApi(
  actions: any,
  fieldName: string = 'actions',
  t?: TranslatorFn
): ValidationResult {
  // Null/undefined/empty is valid (optional field)
  if (!actions || (Array.isArray(actions) && actions.length === 0)) {
    return { valid: true }
  }

  // Must be an array
  if (!Array.isArray(actions)) {
    return {
      valid: false,
      error: `${fieldName} must be an array`,
      errors: [`${fieldName} must be an array`],
    }
  }

  try {
    const result = validateActions(actions as Action[], t)

    if (result.valid) {
      return { valid: true }
    }

    return {
      valid: false,
      error: `Invalid ${fieldName}: ${result.errors.join('; ')}`,
      errors: result.errors,
    }
  } catch (error) {
    return {
      valid: false,
      error: `Failed to validate ${fieldName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    }
  }
}

/**
 * Validate complete rule payload
 *
 * Validates all critical fields in a business rule payload:
 * - conditionExpression
 * - successActions
 * - failureActions
 *
 * @param payload - Rule payload to validate
 * @returns Validation result with aggregated error messages
 */
export function validateRulePayload(payload: {
  conditionExpression?: any
  successActions?: any
  failureActions?: any
}, t?: TranslatorFn): ValidationResult {
  const errors: string[] = []

  // Validate condition expression
  const conditionResult = validateConditionExpressionForApi(payload.conditionExpression, t)
  if (!conditionResult.valid && conditionResult.errors) {
    errors.push(...conditionResult.errors.map(e => `Condition: ${e}`))
  }

  // Validate success actions
  const successResult = validateActionsForApi(payload.successActions, 'successActions', t)
  if (!successResult.valid && successResult.errors) {
    errors.push(...successResult.errors.map(e => `Success actions: ${e}`))
  }

  // Validate failure actions
  const failureResult = validateActionsForApi(payload.failureActions, 'failureActions', t)
  if (!failureResult.valid && failureResult.errors) {
    errors.push(...failureResult.errors.map(e => `Failure actions: ${e}`))
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: errors.join('; '),
      errors,
    }
  }

  return { valid: true }
}

/**
 * Helper to check if an expression contains potentially dangerous patterns
 *
 * Checks for:
 * - Excessive nesting depth
 * - Too many rules in a single group
 * - Excessively long field paths
 *
 * @param expression - Condition expression to check
 * @returns true if expression appears safe, false if potentially dangerous
 */
export function isSafeExpression(expression: any): boolean {
  if (!expression) return true

  const MAX_DEPTH = 10 // Absolute maximum depth allowed
  const MAX_RULES_PER_GROUP = 50 // Maximum rules in a single group
  const MAX_FIELD_PATH_LENGTH = 200 // Maximum field path length

  function checkDepth(expr: any, depth: number): boolean {
    if (depth > MAX_DEPTH) return false

    // Check if it's a group condition
    if (expr && typeof expr === 'object' && 'rules' in expr && Array.isArray(expr.rules)) {
      if (expr.rules.length > MAX_RULES_PER_GROUP) return false

      return expr.rules.every((rule: any) => checkDepth(rule, depth + 1))
    }

    // Check if it's a simple condition with field path
    if (expr && typeof expr === 'object' && 'field' in expr) {
      const fieldPath = String(expr.field)
      if (fieldPath.length > MAX_FIELD_PATH_LENGTH) return false
    }

    return true
  }

  return checkDepth(expression, 0)
}
