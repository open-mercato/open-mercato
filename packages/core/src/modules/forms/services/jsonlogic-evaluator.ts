/**
 * Phase 2c — minimal, safe jsonlogic evaluator for `x-om-visibility-if`.
 *
 * Why a hand-rolled subset rather than the full jsonlogic library:
 *   - The full jsonlogic surface includes operations we don't need (e.g.
 *     `map`, `filter`) and that complicate the safety story.
 *   - We need a hard depth cap and wall-clock cap to mitigate R-2c-1.
 *   - Forms only need comparisons + boolean composition + variable lookup,
 *     which is a small surface that can be audit-grade reviewed in one
 *     reading.
 *
 * Whitelisted ops: `==`, `!=`, `>`, `<`, `>=`, `<=`, `===`, `!==`, `!`,
 *                  `and`, `or`, `var`, `in`, `!!`.
 *
 * Anything else is rejected at evaluate-time with an `UNSUPPORTED_OP` error,
 * and the evaluator returns `false` (conservative: hidden when in doubt).
 */

const DEFAULT_MAX_DEPTH = 32
const DEFAULT_MAX_NODES = 256

export class JsonLogicEvaluationError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'JsonLogicEvaluationError'
  }
}

const WHITELIST = new Set([
  '==',
  '!=',
  '===',
  '!==',
  '>',
  '<',
  '>=',
  '<=',
  '!',
  '!!',
  'and',
  'or',
  'var',
  'in',
])

export type JsonLogicExpression = unknown

export type EvaluateOptions = {
  maxDepth?: number
  maxNodes?: number
}

export function evaluateJsonLogic(
  expr: JsonLogicExpression,
  data: Record<string, unknown>,
  options: EvaluateOptions = {},
): boolean {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const counter = { count: 0 }
  try {
    const result = evaluate(expr, data, 0, maxDepth, maxNodes, counter)
    return Boolean(result)
  } catch {
    return false
  }
}

export function evaluateJsonLogicStrict(
  expr: JsonLogicExpression,
  data: Record<string, unknown>,
  options: EvaluateOptions = {},
): unknown {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const counter = { count: 0 }
  return evaluate(expr, data, 0, maxDepth, maxNodes, counter)
}

function evaluate(
  expr: JsonLogicExpression,
  data: Record<string, unknown>,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  counter: { count: number },
): unknown {
  counter.count += 1
  if (counter.count > maxNodes) {
    throw new JsonLogicEvaluationError('NODE_LIMIT_EXCEEDED', 'Expression evaluated too many nodes.')
  }
  if (depth > maxDepth) {
    throw new JsonLogicEvaluationError('DEPTH_LIMIT_EXCEEDED', 'Expression nesting exceeds the depth limit.')
  }
  if (expr === null) return null
  if (typeof expr !== 'object') return expr
  if (Array.isArray(expr)) {
    return expr.map((entry) => evaluate(entry, data, depth + 1, maxDepth, maxNodes, counter))
  }
  const keys = Object.keys(expr as Record<string, unknown>)
  if (keys.length !== 1) {
    throw new JsonLogicEvaluationError(
      'INVALID_OP',
      `Expression node must have exactly one key (got ${keys.length}).`,
    )
  }
  const op = keys[0]
  if (!WHITELIST.has(op)) {
    throw new JsonLogicEvaluationError('UNSUPPORTED_OP', `Operator "${op}" is not whitelisted.`)
  }
  const args = (expr as Record<string, unknown>)[op]

  switch (op) {
    case 'var': {
      const path = Array.isArray(args) ? args[0] : args
      if (typeof path !== 'string') return undefined
      return resolveVar(path, data)
    }
    case '!': {
      const a = Array.isArray(args)
        ? evaluate(args[0], data, depth + 1, maxDepth, maxNodes, counter)
        : evaluate(args, data, depth + 1, maxDepth, maxNodes, counter)
      return !truthy(a)
    }
    case '!!': {
      const a = Array.isArray(args)
        ? evaluate(args[0], data, depth + 1, maxDepth, maxNodes, counter)
        : evaluate(args, data, depth + 1, maxDepth, maxNodes, counter)
      return truthy(a)
    }
    case 'and': {
      const list = Array.isArray(args) ? args : [args]
      let value: unknown = true
      for (const a of list) {
        value = evaluate(a, data, depth + 1, maxDepth, maxNodes, counter)
        if (!truthy(value)) return false
      }
      return Boolean(value)
    }
    case 'or': {
      const list = Array.isArray(args) ? args : [args]
      for (const a of list) {
        const value = evaluate(a, data, depth + 1, maxDepth, maxNodes, counter)
        if (truthy(value)) return true
      }
      return false
    }
    case '==': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      // eslint-disable-next-line eqeqeq
      return a == b
    }
    case '!=': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      // eslint-disable-next-line eqeqeq
      return a != b
    }
    case '===': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return a === b
    }
    case '!==': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return a !== b
    }
    case '>': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return Number(a) > Number(b)
    }
    case '<': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return Number(a) < Number(b)
    }
    case '>=': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return Number(a) >= Number(b)
    }
    case '<=': {
      const [a, b] = pair(args, data, depth, maxDepth, maxNodes, counter)
      return Number(a) <= Number(b)
    }
    case 'in': {
      const [needle, haystack] = pair(args, data, depth, maxDepth, maxNodes, counter)
      if (Array.isArray(haystack)) return haystack.includes(needle)
      if (typeof haystack === 'string' && typeof needle === 'string') return haystack.includes(needle)
      return false
    }
  }
  throw new JsonLogicEvaluationError('UNSUPPORTED_OP', `Operator "${op}" is not whitelisted.`)
}

function pair(
  args: unknown,
  data: Record<string, unknown>,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  counter: { count: number },
): [unknown, unknown] {
  if (!Array.isArray(args) || args.length < 2) {
    throw new JsonLogicEvaluationError('INVALID_ARGS', 'Comparison ops require [a, b].')
  }
  return [
    evaluate(args[0], data, depth + 1, maxDepth, maxNodes, counter),
    evaluate(args[1], data, depth + 1, maxDepth, maxNodes, counter),
  ]
}

function resolveVar(path: string, data: Record<string, unknown>): unknown {
  if (!path) return data
  let cursor: unknown = data
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function truthy(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}
