/**
 * Workflows Module - Flow-logic + ledger author-time checks (pure)
 *
 * Step 2.12 of the Phase 3a workstream: the Problems panel learns the Phase 3a
 * vocabulary — error routes (spec 5.9), branching routes (5.8), and condition
 * field paths checked against the context ledger (3.5).
 *
 * Every warning here is a WARNING and never blocks a save. That is a standing
 * module decision, not an accident: flow logic is transition sugar, a definition
 * missing an otherwise route (or naming a path a later edit will provide) stays
 * structurally valid, and the editor must never trap work in an unsaveable
 * state. Structural graph problems keep coming from `validateWorkflowGraph` and
 * stay errors.
 *
 * PURE: no React, no ORM, no DI, no xyflow. Callers supply the plain definition
 * JSON and (optionally) an already-computed ledger.
 */

import type { ContextLedger } from './context-ledger'
import { resolvesAgainstEntries } from './expression-refs'
import { validateErrorRoutes, type ErrorRoutingDefinitionLike } from './error-routing'
import {
  collectBranchingRouteWarnings,
  collectDuplicateBranchingCaseWarnings,
} from '../data/branching-route-warnings'

export type FlowLogicWarningCode =
  | 'errorRouteUnknownSource'
  | 'errorRouteUnknownTarget'
  | 'errorRouteDuplicateTarget'
  | 'branchingWithoutOtherwise'
  | 'duplicateBranchingCase'
  | 'conditionUnknownPath'
  | 'unmappedStepConfig'

export interface FlowLogicWarning {
  code: FlowLogicWarningCode
  /** Zod-style path so the Problems panel can map the warning to a node/edge. */
  path: Array<string | number>
  params: Record<string, string>
}

export type FlowLogicDefinition = ErrorRoutingDefinitionLike

/**
 * Context roots a condition may name that the ledger deliberately does not
 * model: the trigger payload the evaluator merges in, engine-provided values,
 * and the engine-owned failure record an error route publishes.
 */
const UNCHECKED_CONDITION_ROOTS = ['triggerData', 'workflow', 'env', 'now', '__error']

const ERROR_ROUTE_CODES: Record<string, FlowLogicWarningCode> = {
  ERROR_ROUTE_UNKNOWN_SOURCE: 'errorRouteUnknownSource',
  ERROR_ROUTE_UNKNOWN_TARGET: 'errorRouteUnknownTarget',
  ERROR_ROUTE_DUPLICATE_TARGET: 'errorRouteDuplicateTarget',
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readString(source: unknown, key: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Every `field` path a ConditionExpression names, groups walked recursively. */
export function collectConditionFieldPaths(condition: unknown, acc: string[] = []): string[] {
  if (!condition || typeof condition !== 'object') return acc
  const candidate = condition as { field?: unknown; rules?: unknown }
  if (Array.isArray(candidate.rules)) {
    for (const rule of candidate.rules) collectConditionFieldPaths(rule, acc)
    return acc
  }
  if (typeof candidate.field === 'string' && candidate.field.length > 0) acc.push(candidate.field)
  return acc
}

function isCheckablePath(path: string): boolean {
  const [root] = path.split('.')
  return !UNCHECKED_CONDITION_ROOTS.includes(root)
}

function warnUnresolvedPaths(
  paths: string[],
  ledger: ContextLedger,
  stepId: string,
  issuePath: Array<string | number>,
  warnings: FlowLogicWarning[],
  seen: Set<string>,
): void {
  const view = ledger.steps[stepId]
  if (!view) return
  for (const path of paths) {
    if (!isCheckablePath(path)) continue
    if (resolvesAgainstEntries(path, view.entries)) continue
    const key = `${issuePath.join('.')}|${path}`
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push({ code: 'conditionUnknownPath', path: issuePath, params: { path, stepId } })
  }
}

/**
 * Condition field paths that no producer upstream provides — the check that
 * catches a WAIT_FOR_CONDITION predicate or a route condition left dangling by
 * an upstream edit (a reattached edge, a converted step, a renamed output).
 *
 * A transition's condition is checked against its TARGET step's incoming view,
 * the same over-approximation `findUnresolvedRefs` uses for transition
 * activities: it can only suppress warnings, never fabricate them.
 */
export function collectConditionPathWarnings(
  definition: FlowLogicDefinition,
  ledger: ContextLedger,
): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []
  const seen = new Set<string>()

  asArray(definition.steps).forEach((step, stepIndex) => {
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    if (readString(step, 'stepType') !== 'WAIT_FOR_CONDITION') return
    const config = (step as { config?: unknown }).config
    const condition = config && typeof config === 'object' ? (config as { condition?: unknown }).condition : undefined
    warnUnresolvedPaths(
      collectConditionFieldPaths(condition),
      ledger,
      stepId,
      ['steps', stepIndex, 'config', 'condition'],
      warnings,
      seen,
    )
  })

  asArray(definition.transitions).forEach((transition, transitionIndex) => {
    const toStepId = readString(transition, 'toStepId')
    if (!toStepId) return
    const condition = (transition as { condition?: unknown }).condition
    warnUnresolvedPaths(
      collectConditionFieldPaths(condition),
      ledger,
      toStepId,
      ['transitions', transitionIndex, 'condition'],
      warnings,
      seen,
    )
  })

  return warnings
}

/**
 * Config a step-type conversion could not map onto the new type (spec 4.5).
 * It is quarantined under `metadata.unmappedConfig` rather than dropped, so the
 * author is told it is parked and no longer executed.
 */
export function collectUnmappedStepConfigWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []
  asArray(definition.steps).forEach((step, stepIndex) => {
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const metadata = (step as { metadata?: unknown }).metadata
    if (!metadata || typeof metadata !== 'object') return
    const unmapped = (metadata as Record<string, unknown>).unmappedConfig
    if (!unmapped || typeof unmapped !== 'object') return
    const keys = Object.keys(unmapped as Record<string, unknown>)
    if (keys.length === 0) return
    warnings.push({
      code: 'unmappedStepConfig',
      path: ['steps', stepIndex],
      params: { stepId, keys: keys.join(', ') },
    })
  })
  return warnings
}

/** Error-route problems (spec 5.9), mapped onto the transition that carries them. */
export function collectErrorRouteWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const transitions = asArray(definition.transitions)
  const indexByTransitionId = new Map<string, number>()
  transitions.forEach((transition, index) => {
    const transitionId = readString(transition, 'transitionId')
    if (transitionId) indexByTransitionId.set(transitionId, index)
  })

  return validateErrorRoutes(definition).map((issue) => {
    const index = issue.transitionId ? indexByTransitionId.get(issue.transitionId) : undefined
    return {
      code: ERROR_ROUTE_CODES[issue.code] ?? 'errorRouteDuplicateTarget',
      path: index === undefined ? [] : ['transitions', index],
      params: {
        transitionId: issue.transitionId ?? '',
        stepId: issue.stepId ?? '',
      },
    }
  })
}

/**
 * The whole Phase 3a author-time warning set for a definition. `ledger` is
 * optional: without it the flow-logic checks still run and only the
 * ledger-dependent condition-path check is skipped.
 */
export function collectFlowLogicWarnings(
  definition: FlowLogicDefinition | null | undefined,
  options: { ledger?: ContextLedger } = {},
): FlowLogicWarning[] {
  if (!definition) return []

  const warnings: FlowLogicWarning[] = [
    ...collectErrorRouteWarnings(definition),
    ...collectUnmappedStepConfigWarnings(definition),
    ...collectBranchingRouteWarnings(definition).map<FlowLogicWarning>((warning) => ({
      code: 'branchingWithoutOtherwise',
      path: warning.path,
      params: { stepId: warning.stepId, stepType: warning.stepType },
    })),
    ...collectDuplicateBranchingCaseWarnings(definition).map<FlowLogicWarning>((warning) => ({
      code: 'duplicateBranchingCase',
      path: warning.path,
      params: { stepId: warning.stepId, stepType: warning.stepType, caseValue: warning.caseValue },
    })),
  ]

  if (options.ledger) {
    warnings.push(...collectConditionPathWarnings(definition, options.ledger))
  }

  return warnings
}
