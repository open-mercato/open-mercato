import type { Edge } from '@xyflow/react'
import type { ConditionExpression, GroupCondition } from '@open-mercato/core/modules/business_rules/components/utils/conditionValidation'

/**
 * If/Else + Switch route compilation (spec
 * 2026-07-26-workflows-ux-redesign.md section 5.8).
 *
 * Branching nodes are pure transition sugar: the inspectors in this module's
 * editor never invent a storage shape. Everything an author configures becomes
 * an ordinary outgoing transition — an inline `condition` in the business_rules
 * expression language (or a business-rule reference through `preConditions`),
 * plus a `priority` that makes the engine's existing highest-priority-first
 * evaluation pick cases before the unconditioned "otherwise" route.
 *
 * Pure module: no React, no ORM, no DI. The only xyflow dependency is the
 * `Edge` type.
 */

export const OTHERWISE_ROUTE_PRIORITY = 0
export const FIRST_CASE_ROUTE_PRIORITY = 100
export const CASE_ROUTE_PRIORITY_STEP = 10

export type BranchingConditionMode = 'inline' | 'rule'

export interface BranchingRouteDraft {
  transitionId: string
  toStepId: string
  kind: 'case' | 'otherwise'
  caseLabel?: string
  caseValue?: string
  mode: BranchingConditionMode
  condition?: GroupCondition | null
  ruleId?: string | null
}

export interface SwitchRoutesValue {
  field: string
  routes: BranchingRouteDraft[]
}

interface EdgeDataLike {
  condition?: unknown
  preConditions?: unknown
  transitionName?: string
  label?: string
  caseLabel?: string
  caseValue?: string
}

function edgeData(edge: Edge): EdgeDataLike {
  return (edge.data ?? {}) as EdgeDataLike
}

function firstRuleId(preConditions: unknown): string | null {
  if (!Array.isArray(preConditions) || preConditions.length === 0) return null
  const [first] = preConditions
  if (typeof first === 'string') return first
  if (first && typeof first === 'object' && typeof (first as { ruleId?: unknown }).ruleId === 'string') {
    return (first as { ruleId: string }).ruleId
  }
  return null
}

function asGroupCondition(value: unknown): GroupCondition | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as { operator?: unknown; rules?: unknown }
  if (typeof candidate.operator !== 'string' || !Array.isArray(candidate.rules)) return null
  return value as GroupCondition
}

function readCaseValue(condition: unknown): string | undefined {
  const group = asGroupCondition(condition)
  const rules = group ? (group.rules as ConditionExpression[]) : []
  const [firstRule] = rules
  if (!firstRule || typeof firstRule !== 'object') return undefined
  const simple = firstRule as { value?: unknown }
  if (simple.value === undefined || simple.value === null) return undefined
  return String(simple.value)
}

function readCaseField(condition: unknown): string | undefined {
  const group = asGroupCondition(condition)
  const rules = group ? (group.rules as ConditionExpression[]) : []
  const [firstRule] = rules
  if (!firstRule || typeof firstRule !== 'object') return undefined
  const simple = firstRule as { field?: unknown }
  return typeof simple.field === 'string' && simple.field.length > 0 ? simple.field : undefined
}

export const BRANCHING_NODE_TYPES = ['ifElse', 'switch'] as const

export type BranchingNodeType = (typeof BRANCHING_NODE_TYPES)[number]

export function isBranchingNodeType(nodeType: string | undefined | null): nodeType is BranchingNodeType {
  return typeof nodeType === 'string' && (BRANCHING_NODE_TYPES as readonly string[]).includes(nodeType)
}

export function outgoingRouteEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((edge) => edge.source === nodeId && edge.type !== 'workflowDataMapping')
}

/**
 * Build the case condition for a Switch route: `field == value`, wrapped in the
 * single-rule AND group the ConditionBuilder and the rule evaluator both speak.
 */
export function buildCaseCondition(field: string, caseValue: string): GroupCondition {
  return {
    operator: 'AND',
    rules: [{ field, operator: '==', value: caseValue }],
  }
}

/**
 * Derive the inspector's view of a branching node's outgoing routes. A route
 * with neither an inline condition nor a business-rule reference IS the
 * otherwise route.
 */
export function readBranchingRoutes(edges: Edge[], nodeId: string): BranchingRouteDraft[] {
  return outgoingRouteEdges(edges, nodeId).map((edge) => {
    const data = edgeData(edge)
    const condition = asGroupCondition(data.condition)
    const ruleId = firstRuleId(data.preConditions)
    const kind: BranchingRouteDraft['kind'] = condition || ruleId ? 'case' : 'otherwise'
    return {
      transitionId: edge.id,
      toStepId: edge.target,
      kind,
      caseLabel: data.caseLabel ?? data.transitionName ?? data.label ?? undefined,
      caseValue: data.caseValue ?? readCaseValue(data.condition),
      mode: ruleId ? 'rule' : 'inline',
      condition,
      ruleId,
    }
  })
}

/**
 * Infer the switched field from the first case route that carries one, so the
 * inspector reopens on the field the author already picked.
 */
export function readSwitchField(edges: Edge[], nodeId: string): string {
  for (const edge of outgoingRouteEdges(edges, nodeId)) {
    const field = readCaseField(edgeData(edge).condition)
    if (field) return field
  }
  return ''
}

/**
 * Guarantee exactly one unconditioned otherwise route. The last route is
 * promoted when the author has not designated one, which is what makes the
 * otherwise route "auto-created" as soon as a branching node has routes.
 */
export function ensureOtherwiseRoute(routes: BranchingRouteDraft[]): BranchingRouteDraft[] {
  if (routes.length === 0) return routes
  // Scan from the end so a freshly connected branching node — where every
  // route still reads as unconditioned — keeps its FIRST connection as the
  // case route and its last as the otherwise.
  let otherwiseIndex = -1
  for (let index = routes.length - 1; index >= 0; index -= 1) {
    if (routes[index].kind === 'otherwise') {
      otherwiseIndex = index
      break
    }
  }
  const designatedIndex = otherwiseIndex >= 0 ? otherwiseIndex : routes.length - 1
  return routes.map((route, index) =>
    index === designatedIndex
      ? { ...route, kind: 'otherwise', condition: null, ruleId: null, caseValue: undefined }
      : { ...route, kind: 'case' },
  )
}

function casePriority(caseIndex: number): number {
  return FIRST_CASE_ROUTE_PRIORITY - caseIndex * CASE_ROUTE_PRIORITY_STEP
}

interface ApplyRoutesOptions {
  resolveCondition: (route: BranchingRouteDraft) => GroupCondition | null
}

function applyRoutes(
  edges: Edge[],
  nodeId: string,
  routes: BranchingRouteDraft[],
  options: ApplyRoutesOptions,
): Edge[] {
  const normalized = ensureOtherwiseRoute(routes)
  const byTransitionId = new Map(normalized.map((route) => [route.transitionId, route]))
  let caseIndex = 0
  const priorityByTransitionId = new Map<string, number>()
  for (const route of normalized) {
    if (route.kind === 'otherwise') {
      priorityByTransitionId.set(route.transitionId, OTHERWISE_ROUTE_PRIORITY)
      continue
    }
    priorityByTransitionId.set(route.transitionId, casePriority(caseIndex))
    caseIndex += 1
  }

  return edges.map((edge) => {
    if (edge.source !== nodeId) return edge
    const route = byTransitionId.get(edge.id)
    if (!route) return edge

    const data = { ...(edge.data ?? {}) } as Record<string, unknown>
    data.priority = priorityByTransitionId.get(route.transitionId) ?? OTHERWISE_ROUTE_PRIORITY

    if (route.kind === 'otherwise') {
      delete data.condition
      delete data.caseValue
      data.preConditions = []
    } else if (route.mode === 'rule') {
      delete data.condition
      data.preConditions = route.ruleId ? [{ ruleId: route.ruleId, required: true }] : []
      if (route.caseValue !== undefined) data.caseValue = route.caseValue
    } else {
      const condition = options.resolveCondition(route)
      if (condition) data.condition = condition
      else delete data.condition
      data.preConditions = []
      if (route.caseValue !== undefined) data.caseValue = route.caseValue
    }

    if (route.caseLabel !== undefined) {
      data.caseLabel = route.caseLabel
      data.transitionName = route.caseLabel
      data.label = route.caseLabel
    }

    return { ...edge, data }
  })
}

/**
 * Compile If/Else inspector state onto the node's outgoing edges. Case routes
 * keep whatever inline condition (or business-rule reference) the author chose;
 * the otherwise route is stripped of both.
 */
export function applyIfElseRoutes(edges: Edge[], nodeId: string, routes: BranchingRouteDraft[]): Edge[] {
  return applyRoutes(edges, nodeId, routes, {
    resolveCondition: (route) => route.condition ?? null,
  })
}

/**
 * Compile Switch inspector state onto the node's outgoing edges: every case
 * value becomes a generated `field == value` condition.
 */
export function applySwitchRoutes(edges: Edge[], nodeId: string, value: SwitchRoutesValue): Edge[] {
  const field = value.field.trim()
  return applyRoutes(edges, nodeId, value.routes, {
    resolveCondition: (route) => {
      const caseValue = (route.caseValue ?? '').trim()
      if (!field || !caseValue) return null
      return buildCaseCondition(field, caseValue)
    },
  })
}

/**
 * Case values that appear on more than one route. Duplicates make the second
 * route unreachable, because the engine stops at the first matching priority.
 */
export function collectDuplicateCaseValues(routes: BranchingRouteDraft[]): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const route of routes) {
    if (route.kind !== 'case') continue
    const caseValue = (route.caseValue ?? '').trim()
    if (!caseValue) continue
    if (seen.has(caseValue)) duplicates.add(caseValue)
    else seen.add(caseValue)
  }
  return [...duplicates]
}

export function hasOtherwiseRoute(routes: BranchingRouteDraft[]): boolean {
  return routes.some((route) => route.kind === 'otherwise')
}
