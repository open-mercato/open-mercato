/**
 * Pure helpers for the ConditionBuilder UI model.
 *
 * The builder UI presents a flat list of `(source, operator, value)` rows
 * combined with AND/OR. The persisted shape is a single jsonlogic node:
 *
 *   - One row → `{ <op>: [{ var: <path> }, <value>] }`
 *   - Multiple rows → `{ and|or: [<row>, …] }`
 *
 * Operators are typed per-source: text/textarea → equals / contains / empty;
 * numeric → comparisons; bool → is true / is false; etc.
 *
 * Round-trip is intentionally lossy: if the persisted jsonlogic doesn't
 * match the shape this builder produces, the UI surfaces a raw-only view
 * and the user can clear the predicate but not edit it visually.
 */

import { classifyVarPath } from '../../../../../schema/jsonlogic-grammar'

export type ConditionOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'is_true'
  | 'is_false'
  | 'in'

export type ConditionRow = {
  id: string
  source: string
  operator: ConditionOperator
  value: string | number | boolean | null
}

export type ConditionBuilderModel = {
  rows: ConditionRow[]
  combine: 'and' | 'or'
  /** True when the persisted shape couldn't be parsed into rows. */
  raw: unknown | null
}

let idCounter = 0
function nextRowId(): string {
  idCounter += 1
  return `cond_${idCounter}`
}

export function emptyModel(): ConditionBuilderModel {
  return { rows: [], combine: 'and', raw: null }
}

export function newRow(source: string = ''): ConditionRow {
  return { id: nextRowId(), source, operator: 'eq', value: '' }
}

/**
 * Parses a persisted jsonlogic predicate into the builder model. Returns
 * `{ rows: [], combine: 'and', raw: <expression> }` when the shape is
 * unsupported so the UI can render a raw-only view.
 */
export function parsePredicate(predicate: unknown): ConditionBuilderModel {
  if (predicate === null || predicate === undefined) return emptyModel()
  if (typeof predicate !== 'object' || Array.isArray(predicate)) {
    return { rows: [], combine: 'and', raw: predicate }
  }
  const keys = Object.keys(predicate as Record<string, unknown>)
  if (keys.length !== 1) return { rows: [], combine: 'and', raw: predicate }
  const op = keys[0]
  if (op === 'and' || op === 'or') {
    const args = (predicate as Record<string, unknown>)[op]
    if (!Array.isArray(args)) return { rows: [], combine: 'and', raw: predicate }
    const rows: ConditionRow[] = []
    for (const entry of args) {
      const parsed = parseSingleRow(entry)
      if (!parsed) return { rows: [], combine: 'and', raw: predicate }
      rows.push(parsed)
    }
    return { rows, combine: op, raw: null }
  }
  const singleRow = parseSingleRow(predicate)
  if (!singleRow) return { rows: [], combine: 'and', raw: predicate }
  return { rows: [singleRow], combine: 'and', raw: null }
}

function parseSingleRow(expression: unknown): ConditionRow | null {
  if (!expression || typeof expression !== 'object' || Array.isArray(expression)) return null
  const keys = Object.keys(expression as Record<string, unknown>)
  if (keys.length !== 1) return null
  const op = keys[0]
  const args = (expression as Record<string, unknown>)[op]
  const operatorMap: Record<string, ConditionOperator> = {
    '==': 'eq',
    '!=': 'neq',
    '>': 'gt',
    '>=': 'gte',
    '<': 'lt',
    '<=': 'lte',
    in: 'in',
  }
  if (op === '!') {
    const inner = Array.isArray(args) ? args[0] : args
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null
    const innerKeys = Object.keys(inner as Record<string, unknown>)
    if (innerKeys.length === 1 && innerKeys[0] === 'var') {
      const path = (inner as Record<string, unknown>).var
      if (typeof path === 'string') {
        return { id: nextRowId(), source: path, operator: 'is_empty', value: null }
      }
    }
    return null
  }
  if (op === '!!') {
    const inner = Array.isArray(args) ? args[0] : args
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return null
    const innerKeys = Object.keys(inner as Record<string, unknown>)
    if (innerKeys.length === 1 && innerKeys[0] === 'var') {
      const path = (inner as Record<string, unknown>).var
      if (typeof path === 'string') {
        return { id: nextRowId(), source: path, operator: 'is_not_empty', value: null }
      }
    }
    return null
  }
  if (!(op in operatorMap)) return null
  if (!Array.isArray(args) || args.length < 2) return null
  const [left, right] = args
  if (!left || typeof left !== 'object' || Array.isArray(left)) return null
  const leftKeys = Object.keys(left as Record<string, unknown>)
  if (leftKeys.length !== 1 || leftKeys[0] !== 'var') return null
  const path = (left as Record<string, unknown>).var
  if (typeof path !== 'string') return null
  const operator: ConditionOperator = operatorMap[op]
  if (operator === 'eq' && right === true) {
    return { id: nextRowId(), source: path, operator: 'is_true', value: null }
  }
  if (operator === 'eq' && right === false) {
    return { id: nextRowId(), source: path, operator: 'is_false', value: null }
  }
  if (operator === 'in' && typeof right === 'string') {
    return { id: nextRowId(), source: path, operator: 'contains', value: right }
  }
  if (typeof right !== 'string' && typeof right !== 'number' && typeof right !== 'boolean' && right !== null) {
    return null
  }
  return { id: nextRowId(), source: path, operator, value: right }
}

/**
 * Compiles the builder model into a jsonlogic expression. Returns `null`
 * for an empty rule list — the caller deletes the keyword in that case.
 * If `raw` is set (unsupported persisted shape), the raw is preserved.
 */
export function compilePredicate(model: ConditionBuilderModel): unknown | null {
  if (model.raw !== null && model.rows.length === 0) return model.raw
  if (model.rows.length === 0) return null
  const compiledRows = model.rows.map(compileRow).filter((entry): entry is object => entry !== null)
  if (compiledRows.length === 0) return null
  if (compiledRows.length === 1) return compiledRows[0]
  return { [model.combine]: compiledRows }
}

function compileRow(row: ConditionRow): object | null {
  if (!row.source) return null
  const source = { var: row.source }
  switch (row.operator) {
    case 'eq':
      return { '==': [source, row.value] }
    case 'neq':
      return { '!=': [source, row.value] }
    case 'gt':
      return { '>': [source, coerceNumber(row.value)] }
    case 'gte':
      return { '>=': [source, coerceNumber(row.value)] }
    case 'lt':
      return { '<': [source, coerceNumber(row.value)] }
    case 'lte':
      return { '<=': [source, coerceNumber(row.value)] }
    case 'contains':
      return { in: [String(row.value ?? ''), source] }
    case 'is_empty':
      return { '!': [source] }
    case 'is_not_empty':
      return { '!!': [source] }
    case 'is_true':
      return { '==': [source, true] }
    case 'is_false':
      return { '==': [source, false] }
    case 'in':
      return { in: [source, row.value] }
  }
}

function coerceNumber(value: unknown): number {
  if (typeof value === 'number') return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function describeSource(source: string): { namespace: 'field' | 'hidden' | 'variable'; name: string } {
  return classifyVarPath(source)
}
