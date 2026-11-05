import type { EvaluationContext } from './expression-evaluator'

/**
 * Shared utilities for resolving values from context
 * Used by both expression-evaluator and action-executor
 */

/**
 * Resolve special template values like {{today}}, {{user.id}}, etc.
 */
export function resolveSpecialValue(template: string, context: EvaluationContext): any {
  const path = template.slice(2, -2).trim() // Remove {{ and }}

  // Special date/time values
  if (path === 'today') {
    const today = context.today || new Date()
    return today.toISOString().split('T')[0] // YYYY-MM-DD
  }

  if (path === 'now') {
    const now = context.now || new Date()
    return now.toISOString()
  }

  // Context values (user.id, tenant.id, etc.)
  return getNestedValue(context, path)
}

// Field paths come from rule authors, so a segment could name a prototype key.
// Rejecting these — and requiring own-property access — keeps traversal on the
// caller's own data instead of the prototype chain.
const DANGEROUS_KEYS = new Set<string>(['__proto__', 'constructor', 'prototype'])

/**
 * Get nested value from object using dot notation
 * Supports: 'user.name', 'items[0].quantity', 'data.values[2]'
 *
 * Segments naming a prototype key, or resolving to an inherited rather than an
 * own property, yield `undefined`.
 */
export function getNestedValue(obj: any, path: string): any {
  if (!obj || !path) {
    return undefined
  }

  // Handle array notation: convert 'items[0]' to 'items.0'
  const normalizedPath = path.replace(/\[(\d+)\]/g, '.$1')

  const keys = normalizedPath.split('.')
  let result = obj

  for (const key of keys) {
    if (result === null || result === undefined) {
      return undefined
    }

    if (DANGEROUS_KEYS.has(key)) {
      return undefined
    }

    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      return undefined
    }

    result = result[key]
  }

  return result
}
