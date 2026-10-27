/**
 * Forms reactive-core jsonlogic grammar (Q3 decision — jsonlogic-only).
 *
 * Both the `form-logic-evaluator` runtime and the validators that gate
 * persisted schemas read this allowlist as the single source of truth.
 * Anything outside the grammar is rejected at compile-time (validator) AND
 * at evaluate-time (defence in depth — R-5 mitigation).
 *
 * The grammar is intentionally small. The set of operators here covers the
 * Tier-1 use cases (visibility, jumps, score variables). Adding a new
 * operator is additive but MUST be reviewed against R-5 (sandbox escape).
 */

/** Comparison + boolean operators (subset of jsonlogic). */
export const COMPARISON_OPS = new Set(['==', '!=', '<', '<=', '>', '>=', '===', '!=='])
export const BOOLEAN_OPS = new Set(['and', 'or', 'not', '!', '!!'])
export const ARITHMETIC_OPS = new Set(['+', '-', '*', '/', '%'])
export const MEMBERSHIP_OPS = new Set(['in'])
export const VARIABLE_OPS = new Set(['var'])
export const CONDITIONAL_OPS = new Set(['if'])

/** Flat allowlist used by both the evaluator and validators. */
export const ALLOWED_JSONLOGIC_OPS: ReadonlySet<string> = new Set<string>([
  ...COMPARISON_OPS,
  ...BOOLEAN_OPS,
  ...ARITHMETIC_OPS,
  ...MEMBERSHIP_OPS,
  ...VARIABLE_OPS,
  ...CONDITIONAL_OPS,
])

/**
 * `var` path namespaces. A bare path (no dot) resolves to a field key under
 * `properties`; the two prefixes route lookups to the hidden-field map or
 * the computed-variable map.
 */
export const JSONLOGIC_VAR_NAMESPACES = {
  hidden: 'hidden.',
  variable: 'var.',
} as const

export type JsonLogicVarNamespace = 'field' | 'hidden' | 'variable'

/**
 * Classifies a `var` path into one of the three namespaces.
 *
 * - `var.<name>` → `variable`
 * - `hidden.<name>` → `hidden`
 * - everything else → `field` (the bare path resolves to a field key, optionally with a deeper sub-path)
 */
export function classifyVarPath(path: string): { namespace: JsonLogicVarNamespace; name: string } {
  if (path.startsWith(JSONLOGIC_VAR_NAMESPACES.variable)) {
    return { namespace: 'variable', name: path.slice(JSONLOGIC_VAR_NAMESPACES.variable.length) }
  }
  if (path.startsWith(JSONLOGIC_VAR_NAMESPACES.hidden)) {
    return { namespace: 'hidden', name: path.slice(JSONLOGIC_VAR_NAMESPACES.hidden.length) }
  }
  return { namespace: 'field', name: path }
}

/**
 * Validates that an expression uses only operators in the grammar allowlist.
 * Returns `null` when the expression is valid; otherwise returns a message
 * naming the first offending operator.
 *
 * This is a structural walk, not an evaluation — it does not require any
 * runtime data.
 */
export function validateJsonLogicGrammar(expression: unknown, maxDepth = 64): string | null {
  return walk(expression, 0, maxDepth)
}

function walk(expr: unknown, depth: number, maxDepth: number): string | null {
  if (depth > maxDepth) return 'Expression nesting exceeds the depth limit.'
  if (expr === null || expr === undefined) return null
  if (typeof expr !== 'object') return null
  if (Array.isArray(expr)) {
    for (const entry of expr) {
      const message = walk(entry, depth + 1, maxDepth)
      if (message) return message
    }
    return null
  }
  const keys = Object.keys(expr as Record<string, unknown>)
  if (keys.length === 0) return null
  if (keys.length !== 1) {
    return 'jsonlogic expression nodes must have exactly one operator key.'
  }
  const op = keys[0]
  if (!ALLOWED_JSONLOGIC_OPS.has(op)) {
    return `Operator "${op}" is not allowed by the forms jsonlogic grammar.`
  }
  const args = (expr as Record<string, unknown>)[op]
  return walk(args, depth + 1, maxDepth)
}
