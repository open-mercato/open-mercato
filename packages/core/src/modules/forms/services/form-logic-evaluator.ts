/**
 * Forms reactive-core — pure logic evaluator.
 *
 * Given a schema + answers + hidden values + locale, returns a `LogicState`:
 *   - visibleFieldKeys / visibleSectionKeys (after cascade)
 *   - variables (computed in topological order; cycles throw)
 *   - resolveRecall(text, locale) (substitutes `@{...}` tokens)
 *   - nextTarget(currentPageKey) (applies `x-om-jumps`)
 *
 * Deterministic, no I/O. Shared by Studio Preview and the public runner.
 */

import {
  OM_FIELD_KEYWORDS,
  OM_ROOT_KEYWORDS,
  type LocalizedText,
  type OmFormVariable,
  type OmFormVariableType,
  type OmHiddenFieldDecl,
  type OmJumpRule,
  type OmJumpTarget,
  type OmSection,
} from '../schema/jsonschema-extensions'
import {
  ALLOWED_JSONLOGIC_OPS,
  classifyVarPath,
} from '../schema/jsonlogic-grammar'

export class LogicEvaluatorError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LogicEvaluatorError'
    this.code = code
  }
}

export type LogicContext = {
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  variables: Record<string, unknown>
  locale: string
}

export type JumpTarget = OmJumpTarget

export type LogicState = {
  visibleFieldKeys: ReadonlySet<string>
  visibleSectionKeys: ReadonlySet<string>
  variables: Readonly<Record<string, unknown>>
  resolveRecall(text: LocalizedText | string | undefined, locale: string): string
  nextTarget(fromPageKey: string): JumpTarget
}

type SchemaLike = Record<string, unknown>

type FieldNodeLike = Record<string, unknown>

const DEFAULT_MAX_DEPTH = 64
const DEFAULT_MAX_NODES = 1024
const RECALL_PATTERN = /@\{([a-z][a-z0-9_.]*)\}/g

const RAW_SENSITIVE_KEY = 'x-om-sensitive'

/**
 * Pure entry point. Returns a `LogicState` derived from the schema + context.
 *
 * Order of operations (Q2/Q3 design):
 *   1. Compute variables in topological order (cycles → throw).
 *   2. Resolve visibility (fields + sections; hidden sections cascade to fields).
 *   3. Resolve `nextTarget(fromPageKey)` lazily — depends on visibility state.
 *   4. Provide a recall resolver bound to the same context.
 */
export function evaluateFormLogic(
  schema: SchemaLike,
  context: Omit<LogicContext, 'variables'>,
): LogicState {
  const answers = context.answers ?? {}
  const hidden = context.hidden ?? {}
  const locale = context.locale ?? 'en'
  const sections = readSections(schema)
  const properties = readProperties(schema)
  const variableDecls = readVariables(schema)
  const hiddenDecls = readHiddenFields(schema)
  const jumps = readJumps(schema)

  const hiddenResolved = resolveHiddenDefaults(hidden, hiddenDecls)
  const variables = computeVariables(variableDecls, answers, hiddenResolved)

  const visibleSectionKeys = computeVisibleSections(sections, answers, hiddenResolved, variables)
  const visibleFieldKeys = computeVisibleFields(
    sections,
    properties,
    visibleSectionKeys,
    answers,
    hiddenResolved,
    variables,
  )

  const sensitiveFields = collectSensitiveFields(properties)

  const resolveRecall = (text: LocalizedText | string | undefined, requestedLocale: string): string => {
    return resolveRecallTokens(text, {
      answers,
      hidden: hiddenResolved,
      variables,
      sensitiveFields,
    }, requestedLocale ?? locale)
  }

  const nextTarget = (fromPageKey: string): JumpTarget => {
    return resolveNextTarget({
      schemaSections: sections,
      jumps,
      fromPageKey,
      answers,
      hidden: hiddenResolved,
      variables,
      visibleSectionKeys,
    })
  }

  return {
    visibleFieldKeys,
    visibleSectionKeys,
    variables: Object.freeze({ ...variables }),
    resolveRecall,
    nextTarget,
  }
}

// =============================================================================
// Schema readers
// =============================================================================

function readSections(schema: SchemaLike): OmSection[] {
  const value = schema[OM_ROOT_KEYWORDS.sections]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is OmSection => !!entry && typeof entry === 'object')
}

function readProperties(schema: SchemaLike): Record<string, FieldNodeLike> {
  const value = schema.properties
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, FieldNodeLike>
}

function readVariables(schema: SchemaLike): OmFormVariable[] {
  const value = schema[OM_ROOT_KEYWORDS.variables]
  if (!Array.isArray(value)) return []
  return value as OmFormVariable[]
}

function readHiddenFields(schema: SchemaLike): OmHiddenFieldDecl[] {
  const value = schema[OM_ROOT_KEYWORDS.hiddenFields]
  if (!Array.isArray(value)) return []
  return value as OmHiddenFieldDecl[]
}

function readJumps(schema: SchemaLike): OmJumpRule[] {
  const value = schema[OM_ROOT_KEYWORDS.jumps]
  if (!Array.isArray(value)) return []
  return value as OmJumpRule[]
}

function collectSensitiveFields(properties: Record<string, FieldNodeLike>): Set<string> {
  const set = new Set<string>()
  for (const [key, node] of Object.entries(properties)) {
    if (node && (node as Record<string, unknown>)[RAW_SENSITIVE_KEY] === true) {
      set.add(key)
    }
  }
  return set
}

// =============================================================================
// Hidden fields
// =============================================================================

function resolveHiddenDefaults(
  hidden: Record<string, unknown>,
  declarations: OmHiddenFieldDecl[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...hidden }
  for (const decl of declarations) {
    if (!(decl.name in result) || result[decl.name] === undefined || result[decl.name] === null) {
      if (decl.defaultValue !== undefined) {
        result[decl.name] = decl.defaultValue
      }
    }
  }
  return result
}

// =============================================================================
// Variables — topological sort + jsonlogic evaluation
// =============================================================================

function computeVariables(
  declarations: OmFormVariable[],
  answers: Record<string, unknown>,
  hidden: Record<string, unknown>,
): Record<string, unknown> {
  if (declarations.length === 0) return {}
  const byName = new Map<string, OmFormVariable>()
  for (const decl of declarations) {
    byName.set(decl.name, decl)
  }
  const order = topologicalOrder(declarations, byName)
  const computed: Record<string, unknown> = {}
  for (const name of order) {
    const decl = byName.get(name)
    if (!decl) continue
    try {
      const raw = evaluateExpression(decl.formula, {
        answers,
        hidden,
        variables: computed,
      })
      computed[name] = coerceVariableValue(raw, decl.type, decl.default)
    } catch {
      computed[name] = decl.default !== undefined ? decl.default : defaultForType(decl.type)
    }
  }
  return computed
}

function topologicalOrder(
  declarations: OmFormVariable[],
  byName: Map<string, OmFormVariable>,
): string[] {
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const order: string[] = []

  function visit(name: string, stack: string[]): void {
    if (visited.has(name)) return
    if (visiting.has(name)) {
      throw new LogicEvaluatorError('VARIABLE_CYCLE', `Variable cycle detected: ${[...stack, name].join(' → ')}`)
    }
    const decl = byName.get(name)
    if (!decl) return
    visiting.add(name)
    for (const dep of collectVariableDependencies(decl.formula)) {
      if (byName.has(dep)) visit(dep, [...stack, name])
    }
    visiting.delete(name)
    visited.add(name)
    order.push(name)
  }

  for (const decl of declarations) {
    visit(decl.name, [])
  }
  return order
}

function collectVariableDependencies(expression: unknown): string[] {
  const deps = new Set<string>()
  walkVarReferences(expression, (path) => {
    const { namespace, name } = classifyVarPath(path)
    if (namespace === 'variable') deps.add(name.split('.')[0])
  })
  return [...deps]
}

function walkVarReferences(expression: unknown, callback: (path: string) => void): void {
  if (expression === null || expression === undefined) return
  if (typeof expression !== 'object') return
  if (Array.isArray(expression)) {
    for (const entry of expression) walkVarReferences(entry, callback)
    return
  }
  const keys = Object.keys(expression as Record<string, unknown>)
  if (keys.length !== 1) return
  const op = keys[0]
  const args = (expression as Record<string, unknown>)[op]
  if (op === 'var') {
    const path = Array.isArray(args) ? args[0] : args
    if (typeof path === 'string') callback(path)
    return
  }
  walkVarReferences(args, callback)
}

function coerceVariableValue(
  raw: unknown,
  type: OmFormVariableType,
  fallback: unknown,
): unknown {
  if (type === 'number') {
    const num = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(num)) return typeof fallback === 'number' ? fallback : 0
    return num
  }
  if (type === 'boolean') {
    return Boolean(raw)
  }
  if (typeof raw === 'string') return raw
  if (raw === null || raw === undefined) return typeof fallback === 'string' ? fallback : ''
  return String(raw)
}

function defaultForType(type: OmFormVariableType): unknown {
  if (type === 'number') return 0
  if (type === 'boolean') return false
  return ''
}

// =============================================================================
// Visibility
// =============================================================================

function computeVisibleSections(
  sections: OmSection[],
  answers: Record<string, unknown>,
  hidden: Record<string, unknown>,
  variables: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>()
  for (const section of sections) {
    if (section.kind === 'ending') {
      // Endings never appear via natural flow — only via jumps. Mark visible
      // so consumers can render them when reached, but the navigation layer
      // gates them.
      visible.add(section.key)
      continue
    }
    const predicate = (section as Record<string, unknown>)['x-om-visibility-if']
    if (predicate === undefined) {
      visible.add(section.key)
      continue
    }
    if (predicateTruthy(predicate, { answers, hidden, variables })) {
      visible.add(section.key)
    }
  }
  return visible
}

function computeVisibleFields(
  sections: OmSection[],
  properties: Record<string, FieldNodeLike>,
  visibleSectionKeys: Set<string>,
  answers: Record<string, unknown>,
  hidden: Record<string, unknown>,
  variables: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>()
  const sectionByField = new Map<string, string>()
  for (const section of sections) {
    for (const key of section.fieldKeys) {
      if (!sectionByField.has(key)) sectionByField.set(key, section.key)
    }
  }
  for (const [fieldKey, node] of Object.entries(properties)) {
    const sectionKey = sectionByField.get(fieldKey)
    if (sectionKey !== undefined && !visibleSectionKeys.has(sectionKey)) {
      continue
    }
    if (sectionKey !== undefined) {
      const owningSection = sections.find((s) => s.key === sectionKey)
      if (owningSection?.kind === 'ending') {
        continue
      }
    }
    const predicate = (node as Record<string, unknown>)[OM_FIELD_KEYWORDS.visibilityIf]
    if (predicate === undefined) {
      visible.add(fieldKey)
      continue
    }
    if (predicateTruthy(predicate, { answers, hidden, variables })) {
      visible.add(fieldKey)
    }
  }
  return visible
}

// =============================================================================
// Jumps
// =============================================================================

function resolveNextTarget(input: {
  schemaSections: OmSection[]
  jumps: OmJumpRule[]
  fromPageKey: string
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  variables: Record<string, unknown>
  visibleSectionKeys: Set<string>
}): JumpTarget {
  const { schemaSections, jumps, fromPageKey, answers, hidden, variables, visibleSectionKeys } = input
  const rule = jumps.find((entry) => entry.from.type === 'page' && entry.from.pageKey === fromPageKey)
  if (!rule) return { type: 'next' }
  for (const branch of rule.rules) {
    if (predicateTruthy(branch.if, { answers, hidden, variables })) {
      return ensureReachableTarget(branch.goto, schemaSections, visibleSectionKeys)
    }
  }
  if (rule.otherwise) {
    return ensureReachableTarget(rule.otherwise, schemaSections, visibleSectionKeys)
  }
  return { type: 'next' }
}

function ensureReachableTarget(
  target: JumpTarget,
  sections: OmSection[],
  visibleSectionKeys: Set<string>,
): JumpTarget {
  if (target.type === 'page') {
    const exists = sections.some((s) => s.key === target.pageKey && (s.kind === 'page' || s.kind === undefined))
    if (!exists) return { type: 'next' }
    return target
  }
  if (target.type === 'ending') {
    const exists = sections.some((s) => s.key === target.endingKey && s.kind === 'ending')
    if (!exists) return { type: 'next' }
    return target
  }
  return target
}

// =============================================================================
// Predicate runtime (jsonlogic subset bound to the grammar)
// =============================================================================

type PredicateContext = {
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  variables: Record<string, unknown>
}

function predicateTruthy(expression: unknown, context: PredicateContext): boolean {
  try {
    const result = evaluateExpression(expression, context)
    return truthy(result)
  } catch {
    return false
  }
}

export function evaluateExpression(
  expression: unknown,
  context: PredicateContext,
  options: { maxDepth?: number; maxNodes?: number } = {},
): unknown {
  const counter = { count: 0 }
  return evaluateInner(
    expression,
    context,
    0,
    options.maxDepth ?? DEFAULT_MAX_DEPTH,
    options.maxNodes ?? DEFAULT_MAX_NODES,
    counter,
  )
}

function evaluateInner(
  expression: unknown,
  context: PredicateContext,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  counter: { count: number },
): unknown {
  counter.count += 1
  if (counter.count > maxNodes) {
    throw new LogicEvaluatorError('NODE_LIMIT_EXCEEDED', 'Expression evaluated too many nodes.')
  }
  if (depth > maxDepth) {
    throw new LogicEvaluatorError('DEPTH_LIMIT_EXCEEDED', 'Expression nesting exceeds the depth limit.')
  }
  if (expression === null || expression === undefined) return expression
  if (typeof expression !== 'object') return expression
  if (Array.isArray(expression)) {
    return expression.map((entry) =>
      evaluateInner(entry, context, depth + 1, maxDepth, maxNodes, counter),
    )
  }
  const keys = Object.keys(expression as Record<string, unknown>)
  if (keys.length === 0) return undefined
  if (keys.length !== 1) {
    throw new LogicEvaluatorError('INVALID_NODE', 'Expression nodes must have exactly one key.')
  }
  const op = keys[0]
  if (!ALLOWED_JSONLOGIC_OPS.has(op)) {
    throw new LogicEvaluatorError('UNSUPPORTED_OP', `Operator "${op}" is not in the jsonlogic grammar.`)
  }
  const args = (expression as Record<string, unknown>)[op]
  return applyOperator(op, args, context, depth, maxDepth, maxNodes, counter)
}

function applyOperator(
  op: string,
  args: unknown,
  context: PredicateContext,
  depth: number,
  maxDepth: number,
  maxNodes: number,
  counter: { count: number },
): unknown {
  const evalArg = (value: unknown) =>
    evaluateInner(value, context, depth + 1, maxDepth, maxNodes, counter)

  switch (op) {
    case 'var': {
      const path = Array.isArray(args) ? args[0] : args
      if (typeof path !== 'string') return undefined
      return resolveVar(path, context)
    }
    case 'if': {
      const list = Array.isArray(args) ? args : [args]
      for (let i = 0; i + 1 < list.length; i += 2) {
        if (truthy(evalArg(list[i]))) return evalArg(list[i + 1])
      }
      if (list.length % 2 === 1) return evalArg(list[list.length - 1])
      return undefined
    }
    case 'and': {
      const list = Array.isArray(args) ? args : [args]
      let value: unknown = true
      for (const entry of list) {
        value = evalArg(entry)
        if (!truthy(value)) return value
      }
      return value
    }
    case 'or': {
      const list = Array.isArray(args) ? args : [args]
      let value: unknown = false
      for (const entry of list) {
        value = evalArg(entry)
        if (truthy(value)) return value
      }
      return value
    }
    case 'not':
    case '!': {
      const single = Array.isArray(args) ? args[0] : args
      return !truthy(evalArg(single))
    }
    case '!!': {
      const single = Array.isArray(args) ? args[0] : args
      return truthy(evalArg(single))
    }
    case '==': {
      const [a, b] = pair(args, evalArg)
      // eslint-disable-next-line eqeqeq
      return a == b
    }
    case '!=': {
      const [a, b] = pair(args, evalArg)
      // eslint-disable-next-line eqeqeq
      return a != b
    }
    case '===': {
      const [a, b] = pair(args, evalArg)
      return a === b
    }
    case '!==': {
      const [a, b] = pair(args, evalArg)
      return a !== b
    }
    case '>': {
      const [a, b] = pair(args, evalArg)
      return Number(a) > Number(b)
    }
    case '<': {
      const [a, b] = pair(args, evalArg)
      return Number(a) < Number(b)
    }
    case '>=': {
      const [a, b] = pair(args, evalArg)
      return Number(a) >= Number(b)
    }
    case '<=': {
      const [a, b] = pair(args, evalArg)
      return Number(a) <= Number(b)
    }
    case '+': {
      const list = Array.isArray(args) ? args.map(evalArg) : [evalArg(args)]
      return list.reduce<number>((acc, entry) => acc + (Number(entry) || 0), 0)
    }
    case '-': {
      const list = Array.isArray(args) ? args.map(evalArg) : [evalArg(args)]
      if (list.length === 0) return 0
      if (list.length === 1) return -Number(list[0])
      return list.slice(1).reduce<number>((acc, entry) => acc - (Number(entry) || 0), Number(list[0]) || 0)
    }
    case '*': {
      const list = Array.isArray(args) ? args.map(evalArg) : [evalArg(args)]
      return list.reduce<number>((acc, entry) => acc * (Number(entry) || 0), 1)
    }
    case '/': {
      const list = Array.isArray(args) ? args.map(evalArg) : [evalArg(args)]
      if (list.length < 2) return 0
      const denom = Number(list[1]) || 0
      if (denom === 0) return 0
      return (Number(list[0]) || 0) / denom
    }
    case '%': {
      const list = Array.isArray(args) ? args.map(evalArg) : [evalArg(args)]
      if (list.length < 2) return 0
      const denom = Number(list[1]) || 0
      if (denom === 0) return 0
      return (Number(list[0]) || 0) % denom
    }
    case 'in': {
      const [needle, haystack] = pair(args, evalArg)
      if (Array.isArray(haystack)) return haystack.includes(needle)
      if (typeof haystack === 'string' && typeof needle === 'string') return haystack.includes(needle)
      return false
    }
  }
  throw new LogicEvaluatorError('UNSUPPORTED_OP', `Operator "${op}" is not in the jsonlogic grammar.`)
}

function pair(args: unknown, evalArg: (value: unknown) => unknown): [unknown, unknown] {
  if (!Array.isArray(args) || args.length < 2) {
    throw new LogicEvaluatorError('INVALID_ARGS', 'Comparison ops require two arguments.')
  }
  return [evalArg(args[0]), evalArg(args[1])]
}

function resolveVar(path: string, context: PredicateContext): unknown {
  if (!path) return undefined
  const { namespace, name } = classifyVarPath(path)
  const source = namespace === 'variable'
    ? context.variables
    : namespace === 'hidden'
      ? context.hidden
      : context.answers
  if (!source) return undefined
  if (!name) return source
  let cursor: unknown = source
  for (const segment of name.split('.')) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function truthy(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

// =============================================================================
// Recall tokens — pure resolver (shared with studio/recall.ts for tokenizing)
// =============================================================================

type RecallResolutionContext = {
  answers: Record<string, unknown>
  hidden: Record<string, unknown>
  variables: Record<string, unknown>
  sensitiveFields: Set<string>
}

function resolveRecallTokens(
  text: LocalizedText | string | undefined,
  context: RecallResolutionContext,
  locale: string,
): string {
  if (text === undefined || text === null) return ''
  const source = typeof text === 'string' ? text : pickLocale(text, locale)
  if (!source) return ''
  return source.replace(/@@\{/g, ' ESC ').replace(RECALL_PATTERN, (_, identifier) => {
    const value = lookupRecall(identifier, context)
    if (value === undefined || value === null) return ''
    return formatRecallValue(value, locale)
  }).replace(/ ESC /g, '@{')
}

function pickLocale(text: LocalizedText, locale: string): string {
  if (text[locale]) return text[locale]
  if (text.en) return text.en
  const first = Object.values(text)[0]
  return typeof first === 'string' ? first : ''
}

function lookupRecall(identifier: string, context: RecallResolutionContext): unknown {
  const { namespace, name } = classifyVarPath(identifier)
  if (!name) return undefined
  if (namespace === 'variable') return readNested(context.variables, name)
  if (namespace === 'hidden') return readNested(context.hidden, name)
  if (context.sensitiveFields.has(name.split('.')[0])) return undefined
  return readNested(context.answers, name)
}

function readNested(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function formatRecallValue(value: unknown, locale: string): string {
  if (typeof value === 'number') {
    try {
      return new Intl.NumberFormat(locale).format(value)
    } catch {
      return String(value)
    }
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Date) return value.toLocaleString(locale)
  if (Array.isArray(value)) return value.map((entry) => formatRecallValue(entry, locale)).join(', ')
  return String(value)
}
