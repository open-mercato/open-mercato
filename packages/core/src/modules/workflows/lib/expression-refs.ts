/**
 * Workflows Module - context expression reference extraction and ledger check
 * (spec 2026-07-26-workflows-ux-redesign.md section 3.5).
 *
 * Pure, dependency-free (browser-safe) helpers that find every `{{context.*}}`
 * reference a workflow definition makes and check each one against the
 * per-step context ledger (`lib/context-ledger.ts`), so the editor can warn —
 * never block — when an expression references context no producer provides.
 *
 * Grammar — mirrors `interpolateVariables` in `lib/activity-executor.ts`:
 * `{{ path }}` tokens inside string values; `workflow.*`, `env.*`, and `now`
 * are engine-provided and always valid, so they are skipped; every other token
 * is a context reference, with an optional leading `context.` stripped (the
 * interpolator defaults bare paths to context lookups). Tokens may carry a
 * transform pipeline tail (`{{ path | fn(args) }}`) — the shared parser in
 * `lib/interpolation-pipeline.ts` strips it so the ledger check validates the
 * base path only; unparseable tokens are skipped (warnings-only surface, so
 * false negatives beat false positives).
 *
 * Extraction surfaces, each verified against the runtime consumer:
 * - Step and transition activity `config` values (all strings, recursively) —
 *   interpolated by `interpolateVariables` before execution.
 * - `subWorkflowConfig.inputMapping` values — `mapInputData` in
 *   `lib/step-handler.ts` treats each value as a bare parent-context dot path
 *   via `getNestedValue` (no `{{}}` interpolation), so bare values are
 *   extracted whole; values containing `{{` fall back to template extraction.
 *   `outputMapping` values read the CHILD workflow's context, which this
 *   ledger cannot see — they are deliberately not extracted.
 * - Trigger `contextMapping[].sourceExpression` — `event-trigger-service.ts`
 *   resolves these against the EVENT PAYLOAD, not workflow context, so bare
 *   values are payload paths and are skipped; only `{{context.*}}` templates
 *   (which never interpolate there) are extracted, and their trigger scope is
 *   not ledger-checkable, so `findUnresolvedRefs` skips them.
 *
 * Scope resolution in `findUnresolvedRefs`:
 * - A STEP activity's refs check against that step's incoming ledger view
 *   (`ledger.steps[stepId]`) — the context persisted before the step runs.
 * - A TRANSITION activity's refs conceptually check against the SOURCE step's
 *   OUTGOING view (transition activities run after the source step completes).
 *   The ledger only publishes per-step INCOMING views, and the TARGET step's
 *   incoming view is exactly source-outgoing plus the transition's own
 *   contributions on the single-route case, only widening (set union) where
 *   the target joins multiple routes — an over-approximation that can only
 *   suppress warnings, never fabricate them. Transition refs therefore check
 *   `ledger.steps[toStepId]`.
 *
 * Resolution rules (warnings-only, so false negatives beat false positives):
 * - A `'*'` wildcard entry (unknown flat payload spread from triggers or
 *   signals) resolves every ref — absence cannot be proven under it.
 * - Exact path match resolves.
 * - Prefix match resolves: ref `customer.name` resolves when entry `customer`
 *   exists with type `object`/`unknown`; ref `customer` resolves when any
 *   entry under `customer.` exists (the ref names a known ancestor).
 */

import type { ContextLedger, LedgerEntry } from './context-ledger'
import { parseInterpolationToken } from './interpolation-pipeline'

export interface ContextRefLocation {
  stepIndex?: number
  transitionIndex?: number
  triggerIndex?: number
  activityIndex?: number
  field: string
}

export type ContextRefScope =
  | { kind: 'step'; stepId: string }
  | { kind: 'transition'; fromStepId: string; toStepId: string }
  | { kind: 'trigger'; triggerId: string }

export interface ContextRef {
  path: string
  location: ContextRefLocation
  scope: ContextRefScope
}

export interface UnresolvedContextRef {
  ref: ContextRef
  stepId: string
}

export interface UnresolvedContextRefWarning {
  path: Array<string | number>
  refPath: string
}

export interface ExpressionRefDefinition {
  steps?: unknown
  transitions?: unknown
  triggers?: unknown
}

const TEMPLATE_PATTERN = /\{\{([^}]+)\}\}/g
const CONTEXT_PREFIX = 'context.'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeContextPath(token: string): string | null {
  const parsed = parseInterpolationToken(token)
  if (!parsed.ok) return null
  const basePath = parsed.path
  if (basePath === 'now') return null
  if (basePath.startsWith('workflow.')) return null
  if (basePath.startsWith('env.')) return null
  const path = basePath.startsWith(CONTEXT_PREFIX) ? basePath.slice(CONTEXT_PREFIX.length) : basePath
  return path.length > 0 ? path : null
}

function contextPathsInTemplate(value: string): string[] {
  const paths: string[] = []
  for (const match of value.matchAll(TEMPLATE_PATTERN)) {
    const path = normalizeContextPath(match[1])
    if (path !== null) paths.push(path)
  }
  return paths
}

function pathsFromMappingValue(value: string): string[] {
  if (value.includes('{{')) return contextPathsInTemplate(value)
  const path = normalizeContextPath(value)
  return path !== null ? [path] : []
}

function collectValueRefs(
  value: unknown,
  field: string,
  push: (path: string, field: string) => void,
): void {
  if (typeof value === 'string') {
    for (const path of contextPathsInTemplate(value)) push(path, field)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectValueRefs(item, `${field}.${index}`, push))
    return
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      collectValueRefs(child, `${field}.${key}`, push)
    }
  }
}

function collectActivityRefs(
  activities: unknown,
  baseLocation: Pick<ContextRefLocation, 'stepIndex' | 'transitionIndex'>,
  scope: ContextRefScope,
  refs: ContextRef[],
): void {
  if (!Array.isArray(activities)) return
  activities.forEach((activity, activityIndex) => {
    if (!isPlainObject(activity)) return
    collectValueRefs(activity.config, 'config', (path, field) => {
      refs.push({ path, location: { ...baseLocation, activityIndex, field }, scope })
    })
  })
}

function collectStepRefs(steps: unknown, refs: ContextRef[]): void {
  if (!Array.isArray(steps)) return
  steps.forEach((rawStep, stepIndex) => {
    if (!isPlainObject(rawStep) || typeof rawStep.stepId !== 'string' || !rawStep.stepId) return
    const scope: ContextRefScope = { kind: 'step', stepId: rawStep.stepId }
    collectActivityRefs(rawStep.activities, { stepIndex }, scope, refs)

    const subWorkflowConfig = rawStep.subWorkflowConfig
    if (!isPlainObject(subWorkflowConfig) || !isPlainObject(subWorkflowConfig.inputMapping)) return
    for (const [targetKey, sourcePath] of Object.entries(subWorkflowConfig.inputMapping)) {
      if (typeof sourcePath !== 'string') continue
      const field = `subWorkflowConfig.inputMapping.${targetKey}`
      for (const path of pathsFromMappingValue(sourcePath)) {
        refs.push({ path, location: { stepIndex, field }, scope })
      }
    }
  })
}

function collectTransitionRefs(transitions: unknown, refs: ContextRef[]): void {
  if (!Array.isArray(transitions)) return
  transitions.forEach((rawTransition, transitionIndex) => {
    if (!isPlainObject(rawTransition)) return
    const fromStepId = rawTransition.fromStepId
    const toStepId = rawTransition.toStepId
    if (typeof fromStepId !== 'string' || !fromStepId) return
    if (typeof toStepId !== 'string' || !toStepId) return
    const scope: ContextRefScope = { kind: 'transition', fromStepId, toStepId }
    collectActivityRefs(rawTransition.activities, { transitionIndex }, scope, refs)
  })
}

function collectTriggerRefs(triggers: unknown, refs: ContextRef[]): void {
  if (!Array.isArray(triggers)) return
  triggers.forEach((rawTrigger, triggerIndex) => {
    if (!isPlainObject(rawTrigger)) return
    const triggerId = typeof rawTrigger.triggerId === 'string' && rawTrigger.triggerId
      ? rawTrigger.triggerId
      : String(triggerIndex)
    const config = rawTrigger.config
    if (!isPlainObject(config) || !Array.isArray(config.contextMapping)) return
    config.contextMapping.forEach((mapping, mappingIndex) => {
      if (!isPlainObject(mapping) || typeof mapping.sourceExpression !== 'string') return
      for (const path of contextPathsInTemplate(mapping.sourceExpression)) {
        refs.push({
          path,
          location: { triggerIndex, field: `config.contextMapping.${mappingIndex}.sourceExpression` },
          scope: { kind: 'trigger', triggerId },
        })
      }
    })
  })
}

export function extractContextRefs(definition: ExpressionRefDefinition): ContextRef[] {
  const refs: ContextRef[] = []
  collectStepRefs(definition.steps, refs)
  collectTransitionRefs(definition.transitions, refs)
  collectTriggerRefs(definition.triggers, refs)
  return refs
}

function scopeStepId(scope: ContextRefScope): string | null {
  if (scope.kind === 'step') return scope.stepId
  if (scope.kind === 'transition') return scope.toStepId
  return null
}

/**
 * The shared ledger-resolution rule. Exported so other author-time checks that
 * validate a context path (condition `field` paths, step 2.12) apply exactly the
 * same over-approximating semantics instead of re-deriving them.
 */
export function resolvesAgainstEntries(refPath: string, entries: LedgerEntry[]): boolean {
  for (const entry of entries) {
    if (entry.path === '*') return true
    if (entry.path === refPath) return true
    if (
      refPath.startsWith(`${entry.path}.`) &&
      (entry.type === 'object' || entry.type === 'unknown')
    ) {
      return true
    }
    if (entry.path.startsWith(`${refPath}.`)) return true
  }
  return false
}

export function findUnresolvedRefs(refs: ContextRef[], ledger: ContextLedger): UnresolvedContextRef[] {
  const unresolved: UnresolvedContextRef[] = []
  for (const ref of refs) {
    const stepId = scopeStepId(ref.scope)
    if (stepId === null) continue
    const view = ledger.steps[stepId]
    if (!view) continue
    if (!resolvesAgainstEntries(ref.path, view.entries)) {
      unresolved.push({ ref, stepId })
    }
  }
  return unresolved
}

function locationToIssuePath(location: ContextRefLocation): Array<string | number> {
  const path: Array<string | number> = []
  if (location.stepIndex !== undefined) path.push('steps', location.stepIndex)
  else if (location.transitionIndex !== undefined) path.push('transitions', location.transitionIndex)
  else if (location.triggerIndex !== undefined) path.push('triggers', location.triggerIndex)
  if (location.activityIndex !== undefined) path.push('activities', location.activityIndex)
  for (const segment of location.field.split('.')) {
    path.push(/^\d+$/.test(segment) ? Number(segment) : segment)
  }
  return path
}

export function collectUnresolvedContextRefWarnings(
  definition: ExpressionRefDefinition,
  ledger: ContextLedger,
): UnresolvedContextRefWarning[] {
  const unresolved = findUnresolvedRefs(extractContextRefs(definition), ledger)
  const seen = new Set<string>()
  const warnings: UnresolvedContextRefWarning[] = []
  for (const { ref } of unresolved) {
    const issuePath = locationToIssuePath(ref.location)
    const key = `${issuePath.join('.')}|${ref.path}`
    if (seen.has(key)) continue
    seen.add(key)
    warnings.push({ path: issuePath, refPath: ref.path })
  }
  return warnings
}
