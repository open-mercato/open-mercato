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

import { hasAllFeatures } from '@open-mercato/shared/security/features'
import type { ContextLedger } from './context-ledger'
import {
  normalizeTaskEntityTypeSpelling,
  resolveAliasedTaskEntityId,
} from './task-entity-aliases'
import { resolvesAgainstEntries } from './expression-refs'
import { validateErrorRoutes, type ErrorRoutingDefinitionLike } from './error-routing'
import { validateOutcomeRoutes } from './outcome-routing'
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
  | 'taskDecisionUnknownRoute'
  | 'taskDecisionDuplicateId'
  | 'taskWithoutOwner'
  | 'taskPortalWithoutBinding'
  | 'taskBindingUnknownEntityType'
  | 'taskBindingAssigneeCannotView'
  | 'outcomeRouteUnknownKind'
  | 'outcomeRouteDuplicateKind'

export interface FlowLogicWarning {
  code: FlowLogicWarningCode
  /** Zod-style path so the Problems panel can map the warning to a node/edge. */
  path: Array<string | number>
  params: Record<string, string>
  /**
   * `'error'` for the ONE §6.4 check that describes an authoring mistake with no
   * runtime remedy, `undefined` (⇒ warning) for everything else.
   *
   * The standing module rule is that flow-logic findings never block a save,
   * because flow logic is transition sugar and a path a later edit will provide
   * must not trap work in an unsaveable state. The unknown-entity-type check is
   * the one finding that earns an exception: a type the gate cannot normalize
   * hides the task from its own assignee silently, and nothing at runtime can
   * repair it — only re-authoring the binding can.
   *
   * An owner-less task is deliberately NOT an error, even though the run parks
   * at it. Reassignment (`POST /api/workflows/tasks/[id]/reassign`) is the
   * runtime remedy, the act routes already refuse clearly with a 403 that names
   * it rather than failing silently, and definitions authored before this check
   * existed must not become unsaveable to an author who opened one to fix
   * something unrelated.
   */
  severity?: 'error' | 'warning'
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

const OUTCOME_ROUTE_CODES: Record<string, FlowLogicWarningCode> = {
  OUTCOME_ROUTE_UNKNOWN_KIND: 'outcomeRouteUnknownKind',
  OUTCOME_ROUTE_DUPLICATE_KIND: 'outcomeRouteDuplicateKind',
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

/**
 * Decision buttons that no longer describe a choice the engine can make
 * (spec §6.1, section 5).
 *
 * A decision is bound to a transition's DURABLE id, so route reordering,
 * relabelling and endpoint reattachment all leave it intact by construction.
 * What CAN break it is deleting the route, or rewiring it to leave a different
 * step — and both are ordinary editing gestures, so this is a WARNING like
 * every other flow-logic check: the definition stays saveable and the author
 * decides whether to re-point the button or drop it.
 *
 * The check is against the step's OUTGOING routes rather than every transition
 * in the definition, because completing a task advances from that step: a
 * decision pointing anywhere else could never be followed.
 */
export function collectTaskDecisionWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []
  const outgoingByStepId = new Map<string, Set<string>>()

  for (const transition of asArray(definition.transitions)) {
    const fromStepId = readString(transition, 'fromStepId')
    const transitionId = readString(transition, 'transitionId')
    if (!fromStepId || !transitionId) continue
    const existing = outgoingByStepId.get(fromStepId)
    if (existing) existing.add(transitionId)
    else outgoingByStepId.set(fromStepId, new Set([transitionId]))
  }

  asArray(definition.steps).forEach((step, stepIndex) => {
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const config = (step as { userTaskConfig?: unknown }).userTaskConfig
    if (!config || typeof config !== 'object') return
    const decisions = asArray((config as Record<string, unknown>).decisions)
    if (decisions.length === 0) return

    const outgoing = outgoingByStepId.get(stepId) ?? new Set<string>()
    const seenIds = new Set<string>()

    for (const decision of decisions) {
      const decisionId = readString(decision, 'id')
      const transitionId = readString(decision, 'transitionId')
      if (decisionId) {
        if (seenIds.has(decisionId)) {
          warnings.push({
            code: 'taskDecisionDuplicateId',
            path: ['steps', stepIndex],
            params: { stepId, decisionId },
          })
        }
        seenIds.add(decisionId)
      }
      if (transitionId && !outgoing.has(transitionId)) {
        warnings.push({
          code: 'taskDecisionUnknownRoute',
          path: ['steps', stepIndex],
          params: { stepId, decisionId: decisionId ?? '', transitionId },
        })
      }
    }
  })

  return warnings
}

/**
 * What a caller can tell the binding checks about the world outside the
 * definition. Every field is optional and a missing one SKIPS its check rather
 * than guessing — the browser has no ACL and no tenant role table, and a check
 * that invented an answer would flag valid definitions.
 */
export type TaskBindingCheckOptions = {
  /**
   * Generated entity ids that exist (`#generated/entities.ids.generated`,
   * flattened). Without it the unknown-type check only catches values that are
   * not even SHAPED like an entity id, because the alternative — treating every
   * id the caller cannot enumerate as unknown — would make the Problems panel
   * reject correct definitions wherever the registry is not loaded.
   */
  knownEntityIds?: ReadonlySet<string> | null
  /**
   * Role name → the features that role grants, and entity id → the features
   * viewing it requires. Both are TENANT data, so both arrive from the caller;
   * absent, the assignee-cannot-view check does not run.
   */
  assigneeEntityAccess?: TaskAssigneeEntityAccess | null
}

export type TaskAssigneeEntityAccess = {
  roleFeatures: Readonly<Record<string, readonly string[]>>
  entityViewRequirements: Readonly<Record<string, readonly string[]>>
}

/** Shaped like a generated entity id: `module:entity`, both snake_case. */
const ENTITY_ID_SHAPE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/

function readUserTaskConfig(step: unknown): Record<string, unknown> | null {
  const config = (step as { userTaskConfig?: unknown }).userTaskConfig
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null
  return config as Record<string, unknown>
}

function isUserTaskStep(step: unknown): boolean {
  return readString(step, 'stepType') === 'USER_TASK'
}

/** Assignee spellings the engine accepts: a single id or a list of them. */
function hasAssignee(config: Record<string, unknown>): boolean {
  const assignedTo = config.assignedTo
  if (typeof assignedTo === 'string') return assignedTo.trim().length > 0
  if (Array.isArray(assignedTo)) {
    return assignedTo.some((entry) => typeof entry === 'string' && entry.trim().length > 0)
  }
  return false
}

function assignedRoleNames(config: Record<string, unknown>): string[] {
  const roles = config.assignedToRoles
  if (!Array.isArray(roles)) return []
  return roles.filter((role): role is string => typeof role === 'string' && role.trim().length > 0)
}

/**
 * A USER_TASK naming neither an assignee nor a role queue — a WARNING.
 *
 * Under §6.4 a task is actionable by the principal it belongs to, and this one
 * belongs to nobody: not an assignee, not a claimant, not a queue member. The
 * act routes refuse it with `TASK_NOT_ACTIONABLE` and administration widens
 * seeing without ever widening acting, so the workflow parks at that step until
 * somebody takes the row. Catching it in the editor is the whole point — the
 * alternative is discovering it on a live instance.
 *
 * It stays a WARNING rather than blocking the save, for three reasons:
 * reassignment is a shipped runtime remedy, so a parked task is recoverable
 * without re-authoring; the act routes refuse it loudly and name that remedy
 * instead of failing silently; and a definition authored before this check
 * existed would otherwise become unsaveable to an author who opened it to fix
 * something entirely unrelated. Unresolvable binding types keep their error
 * severity — those have no runtime remedy at all.
 *
 * `assignmentRule` counts as an owner: it defers assignment to a business rule
 * the engine resolves at task creation, so the definition does name a source of
 * truth even though this file cannot evaluate it.
 */
export function collectTaskOwnerWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []

  asArray(definition.steps).forEach((step, stepIndex) => {
    if (!isUserTaskStep(step)) return
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const config = readUserTaskConfig(step)
    // A USER_TASK with no config at all is an unfinished node, and the schema
    // already speaks to that; this check is about a config that says who owns
    // the work and gets the answer wrong.
    if (!config) return
    if (hasAssignee(config)) return
    if (assignedRoleNames(config).length > 0) return
    if (readString(config, 'assignmentRule')) return

    warnings.push({
      code: 'taskWithoutOwner',
      path: ['steps', stepIndex],
      params: { stepId },
      severity: 'warning',
    })
  })

  return warnings
}

/**
 * A task addressed to a portal customer that is about no record — a WARNING.
 *
 * A portal principal carries no org-membership grant, so the binding to their
 * own record IS the whole authorization story. `decideTaskVisibility` denies an
 * unbound portal row outright (`denied:portal-unbound`) and
 * `buildPortalTaskConditions` additionally excludes it in SQL, so the task is
 * invisible to every portal principal including a company admin — the run parks
 * at a step nobody in the portal can even see.
 *
 * It is a WARNING, matching this module's stance that work-in-progress stays
 * saveable and matching `taskWithoutOwner`, which describes the same shape of
 * problem: the bindings live in a different inspector section, an author part-way
 * through addressing a task must not be trapped, and a definition authored
 * before the audience picker existed must not become unsaveable to somebody who
 * opened it for something unrelated.
 */
export function collectPortalTaskBindingWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []

  asArray(definition.steps).forEach((step, stepIndex) => {
    if (!isUserTaskStep(step)) return
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const config = readUserTaskConfig(step)
    if (!config) return
    if (config.assigneeKind !== 'customer') return
    if (asArray(config.entityBindings).length > 0) return

    warnings.push({
      code: 'taskPortalWithoutBinding',
      path: ['steps', stepIndex],
      params: { stepId },
      severity: 'warning',
    })
  })

  return warnings
}

/**
 * Binding problems on a USER_TASK's "About what" list.
 *
 * - An `entityType` that resolves to no known entity is an ERROR: the visibility
 *   gate refuses a binding it cannot normalize (`denied:unknown-entity-type`),
 *   so a typo hides the task from its own assignee — silently, which is exactly
 *   the class of bug that must not survive authoring.
 * - A type the ASSIGNEE cannot view is a WARNING: the entity clause is `every`,
 *   so one unviewable binding blinds a legitimately assigned worker. It stays a
 *   warning because role feature sets are tenant data that can change after
 *   authoring, and the author is often not the person who grants features.
 */
export function collectTaskBindingWarnings(
  definition: FlowLogicDefinition,
  options: TaskBindingCheckOptions = {},
): FlowLogicWarning[] {
  const warnings: FlowLogicWarning[] = []

  asArray(definition.steps).forEach((step, stepIndex) => {
    if (!isUserTaskStep(step)) return
    const stepId = readString(step, 'stepId')
    if (!stepId) return
    const config = readUserTaskConfig(step)
    if (!config) return

    const bindings = asArray(config.entityBindings)
    if (bindings.length === 0) return

    const roles = assignedRoleNames(config)

    for (const binding of bindings) {
      const authored = readString(binding, 'entityType')
      if (!authored) continue

      const normalized = normalizeTaskEntityTypeSpelling(authored)
      const entityId = resolveAliasedTaskEntityId(normalized) ?? normalized
      const known = options.knownEntityIds
      const resolves = known ? known.has(entityId) : ENTITY_ID_SHAPE.test(entityId)

      if (!resolves) {
        warnings.push({
          code: 'taskBindingUnknownEntityType',
          path: ['steps', stepIndex],
          params: { stepId, entityType: authored },
          severity: 'error',
        })
        continue
      }

      const access = options.assigneeEntityAccess
      if (!access || roles.length === 0) continue

      const required = access.entityViewRequirements[entityId]
      if (!required || required.length === 0) continue

      // Every queued role must be able to view it: a queue whose members see
      // different things is a queue where the task is claimable by people who
      // then cannot open it.
      const blindRoles = roles.filter((role) => {
        const granted = access.roleFeatures[role]
        if (!granted) return false
        return !hasAllFeatures(granted, required)
      })

      if (blindRoles.length > 0) {
        warnings.push({
          code: 'taskBindingAssigneeCannotView',
          path: ['steps', stepIndex],
          params: { stepId, entityType: authored, roles: blindRoles.join(', ') },
        })
      }
    }
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
 * Outcome-route checks (spec 7.2). An outcome route claiming a kind the platform
 * does not define can never be selected, and two routes claiming the same kind
 * make the destination depend on a priority tie rather than on wiring — neither
 * is visible on the canvas, which is exactly what the Problems panel is for.
 */
export function collectOutcomeRouteWarnings(definition: FlowLogicDefinition): FlowLogicWarning[] {
  const transitions = asArray(definition.transitions)
  const indexByTransitionId = new Map<string, number>()
  transitions.forEach((transition, index) => {
    const transitionId = readString(transition, 'transitionId')
    if (transitionId) indexByTransitionId.set(transitionId, index)
  })

  return validateOutcomeRoutes(definition).map((issue) => {
    const index = issue.transitionId ? indexByTransitionId.get(issue.transitionId) : undefined
    return {
      code: OUTCOME_ROUTE_CODES[issue.code] ?? 'outcomeRouteUnknownKind',
      path: index === undefined ? [] : ['transitions', index],
      params: {
        transitionId: issue.transitionId ?? '',
        stepId: issue.stepId ?? '',
        outcomeKind: readString(index === undefined ? null : transitions[index], 'outcomeKind') ?? '',
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
  options: { ledger?: ContextLedger } & TaskBindingCheckOptions = {},
): FlowLogicWarning[] {
  if (!definition) return []

  const warnings: FlowLogicWarning[] = [
    ...collectErrorRouteWarnings(definition),
    ...collectOutcomeRouteWarnings(definition),
    ...collectUnmappedStepConfigWarnings(definition),
    ...collectTaskDecisionWarnings(definition),
    ...collectTaskOwnerWarnings(definition),
    ...collectPortalTaskBindingWarnings(definition),
    ...collectTaskBindingWarnings(definition, options),
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
