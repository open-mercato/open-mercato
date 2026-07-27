/**
 * Workflows Module - per-step context ledger (spec
 * 2026-07-26-workflows-ux-redesign.md section 3.1).
 *
 * Pure, dependency-free computation of "what context is available at each
 * step" for a workflow definition. No React, no ORM, no DI container, and no
 * activity-registry import — output-contract resolution is an injected seam
 * (`resolveOutputContract`) so this module stays loadable from the browser
 * bundle and from server routes alike.
 *
 * The ledger is a topological fixpoint, not path enumeration: each step's
 * INCOMING ledger is the join of every incoming route's ledger, where a route
 * is (predecessor's OUTGOING ledger + the connecting transition's own
 * contributions). At joins, an entry keeps `presence: 'always'` only when it
 * is always-present on EVERY incoming route; otherwise it degrades to
 * `'maybe'`. Cycles are tolerated: the merge is monotone (entry sets only
 * grow, presence only degrades toward `maybe`), so iteration reaches a stable
 * fixpoint, with a hard pass cap as a safety net.
 *
 * Producer inventory — every contribution below was verified against the
 * engine before being modeled; nothing is fabricated and opaque producers stay
 * explicit `unknown` entries:
 *
 * - Initial context (START steps): `contextSchema.input.fields` typed
 *   (`required` → always, else maybe) plus, per definition trigger, the
 *   whole-payload flat spread (one `'*'` wildcard entry), `contextMapping`
 *   target keys (named, untyped), and the `__trigger.*` metadata keys
 *   (event-trigger-service builds `initialContext` from
 *   `...payload, ...mappedContext, __trigger: {...}`). All trigger entries are
 *   `maybe` — a definition can always be started manually without the trigger.
 * - Transition activities run DURING the transition and their outputs are
 *   persisted (`applyTokenContextWrites`) BEFORE the target step executes
 *   (transition-handler), so they contribute to the TARGET step's incoming
 *   route: sync outputs land under `activityName || activityType`
 *   (activity-executor + transition-handler), SET_VARIABLE sync outputs land
 *   at their assignment dot paths (set-variable), and async outputs land under
 *   `${activityId}_result` at resume, still before the pending transition's
 *   target step runs (workflow-executor). `continueOnActivityFailure`
 *   degrades that transition's sync contributions to `maybe`.
 * - AUTOMATED steps' own sync activity outputs are NOT persisted into workflow
 *   context — handleAutomatedStep only stores them in
 *   `stepInstance.outputData` — so they contribute nothing here; the step's
 *   async activities DO contribute `${activityId}_result` (merged into
 *   `instance.context` by the async resume path).
 * - USER_TASK completion merges submitted formData FLAT into context
 *   (task-handler), typed via `userTaskConfig.formSchema` (fields array or
 *   JSON-Schema properties form).
 * - WAIT_FOR_SIGNAL merges the signal payload flat (untyped `'*'` wildcard)
 *   plus `signal_<name>_payload` / `signal_<name>_receivedAt`; the payload is
 *   optional so every signal entry is `maybe` (signal-handler).
 * - PARALLEL_JOIN sets `context.branches[branchKey]` unconditionally and lifts
 *   join `config.outputMapping` keys only when the source value resolves
 *   (parallel-handler fireJoin), so `branches` is always and mapped keys are
 *   maybe. Known 2a approximation: branch-namespace scoping is not modeled —
 *   entries produced inside parallel branches flow through the generic join
 *   rule as `maybe` even though post-join they live under `branches.<key>`.
 * - SUB_WORKFLOW contributes nothing: handleSubWorkflowStep maps
 *   `outputMapping` from the child context but only returns it as
 *   `stepInstance.outputData` — it is never merged into `instance.context` —
 *   so advertising those keys would fabricate availability.
 */

import { splitAssignmentPath } from './set-variable'

export type LedgerType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'select'
  | 'date'
  | 'object'
  | 'unknown'

export type LedgerPresence = 'always' | 'maybe'

export type LedgerSourceKind =
  | 'contextSchema'
  | 'trigger'
  | 'activity'
  | 'setVariable'
  | 'userTask'
  | 'signal'
  | 'subWorkflow'
  | 'join'
  | 'asyncResult'

export interface LedgerEntrySource {
  kind: LedgerSourceKind
  stepId?: string
  activityId?: string
  label: string
}

export interface LedgerEntry {
  path: string
  type: LedgerType
  presence: LedgerPresence
  source: LedgerEntrySource
  sample?: unknown
}

export interface LedgerStepView {
  entries: LedgerEntry[]
}

export interface ContextLedger {
  steps: Record<string, LedgerStepView>
}

export interface LedgerContract {
  entries: Array<{ path: string; type: LedgerType }>
}

export type ResolveOutputContract = (
  activityType: string,
  config: unknown,
) => LedgerContract | 'unknown'

export interface ComputeContextLedgerOptions {
  resolveOutputContract?: ResolveOutputContract
}

export interface LedgerActivityDefinition {
  activityId: string
  activityName?: string
  activityType: string
  config?: Record<string, unknown>
  async?: boolean
}

export interface LedgerStepDefinition {
  stepId: string
  stepType: string
  config?: Record<string, unknown>
  userTaskConfig?: Record<string, unknown>
  signalConfig?: Record<string, unknown>
  activities?: LedgerActivityDefinition[]
}

export interface LedgerTransitionDefinition {
  transitionId?: string
  fromStepId: string
  toStepId: string
  activities?: LedgerActivityDefinition[]
  continueOnActivityFailure?: boolean
}

export interface LedgerTriggerDefinition {
  triggerId: string
  config?: Record<string, unknown>
}

export interface LedgerContextSchemaField {
  name: string
  type: string
  required?: boolean
}

export interface LedgerContextSchema {
  input?: { fields: LedgerContextSchemaField[] }
}

export interface LedgerWorkflowDefinition {
  steps: LedgerStepDefinition[]
  transitions: LedgerTransitionDefinition[]
  triggers?: LedgerTriggerDefinition[]
  contextSchema?: LedgerContextSchema
}

type LedgerMap = Map<string, LedgerEntry>

const TRIGGER_PAYLOAD_WILDCARD = '*'

const FIELD_TYPE_MAP: Record<string, LedgerType> = {
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  select: 'select',
  date: 'date',
}

const JSON_SCHEMA_TYPE_MAP: Record<string, LedgerType> = {
  string: 'text',
  number: 'number',
  integer: 'number',
  boolean: 'boolean',
  object: 'object',
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mapFieldType(rawType: unknown): LedgerType {
  if (typeof rawType !== 'string') return 'unknown'
  return FIELD_TYPE_MAP[rawType] ?? 'unknown'
}

function mapJsonSchemaType(rawType: unknown): LedgerType {
  if (typeof rawType !== 'string') return 'unknown'
  return JSON_SCHEMA_TYPE_MAP[rawType] ?? 'unknown'
}

function literalValueType(value: unknown): LedgerType {
  if (typeof value === 'string') {
    return value.includes('{{') ? 'unknown' : 'text'
  }
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (isPlainObject(value)) return 'object'
  return 'unknown'
}

function makeEntry(
  path: string,
  type: LedgerType,
  presence: LedgerPresence,
  source: LedgerEntrySource,
): LedgerEntry {
  return { path, type, presence, source }
}

function initialContributions(definition: LedgerWorkflowDefinition): LedgerEntry[] {
  const entries: LedgerEntry[] = []

  const inputFields = definition.contextSchema?.input?.fields ?? []
  for (const field of inputFields) {
    if (!field.name) continue
    entries.push(
      makeEntry(field.name, mapFieldType(field.type), field.required ? 'always' : 'maybe', {
        kind: 'contextSchema',
        label: 'contextSchema.input',
      }),
    )
  }

  for (const trigger of definition.triggers ?? []) {
    entries.push(
      makeEntry(TRIGGER_PAYLOAD_WILDCARD, 'unknown', 'maybe', {
        kind: 'trigger',
        label: `trigger:${trigger.triggerId}:payload`,
      }),
    )

    const contextMapping = trigger.config?.contextMapping
    if (Array.isArray(contextMapping)) {
      for (const mapping of contextMapping) {
        if (!isPlainObject(mapping) || typeof mapping.targetKey !== 'string' || !mapping.targetKey) continue
        entries.push(
          makeEntry(mapping.targetKey, 'unknown', 'maybe', {
            kind: 'trigger',
            label: `trigger:${trigger.triggerId}:contextMapping`,
          }),
        )
      }
    }

    const metadataSource: LedgerEntrySource = {
      kind: 'trigger',
      label: `trigger:${trigger.triggerId}:metadata`,
    }
    const triggerMetadataEntries: Array<[string, LedgerType]> = [
      ['__trigger.triggerId', 'text'],
      ['__trigger.triggerName', 'text'],
      ['__trigger.eventName', 'text'],
      ['__trigger.eventPayload', 'object'],
      ['__trigger.triggeredAt', 'date'],
      ['__trigger.source', 'text'],
    ]
    for (const [path, type] of triggerMetadataEntries) {
      entries.push(makeEntry(path, type, 'maybe', metadataSource))
    }
  }

  return entries
}

function userTaskContributions(step: LedgerStepDefinition): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const formSchema = step.userTaskConfig?.formSchema
  if (!isPlainObject(formSchema)) return entries

  const source: LedgerEntrySource = {
    kind: 'userTask',
    stepId: step.stepId,
    label: `userTask:${step.stepId}`,
  }

  const fields = formSchema.fields
  if (Array.isArray(fields)) {
    for (const field of fields) {
      if (!isPlainObject(field) || typeof field.name !== 'string' || !field.name) continue
      entries.push(
        makeEntry(field.name, mapFieldType(field.type), field.required === true ? 'always' : 'maybe', source),
      )
    }
    return entries
  }

  const properties = formSchema.properties
  if (isPlainObject(properties)) {
    const requiredNames = Array.isArray(formSchema.required)
      ? formSchema.required.filter((name): name is string => typeof name === 'string')
      : []
    for (const [name, property] of Object.entries(properties)) {
      const propertyType = isPlainObject(property) ? property.type : undefined
      entries.push(
        makeEntry(
          name,
          mapJsonSchemaType(propertyType),
          requiredNames.includes(name) ? 'always' : 'maybe',
          source,
        ),
      )
    }
  }

  return entries
}

function signalContributions(step: LedgerStepDefinition): LedgerEntry[] {
  const configuredName = step.signalConfig?.signalName
  const signalName = typeof configuredName === 'string' && configuredName ? configuredName : step.stepId
  const source: LedgerEntrySource = {
    kind: 'signal',
    stepId: step.stepId,
    label: `signal:${signalName}`,
  }
  return [
    makeEntry(TRIGGER_PAYLOAD_WILDCARD, 'unknown', 'maybe', source),
    makeEntry(`signal_${signalName}_payload`, 'object', 'maybe', source),
    makeEntry(`signal_${signalName}_receivedAt`, 'date', 'maybe', source),
  ]
}

function joinContributions(step: LedgerStepDefinition): LedgerEntry[] {
  const source: LedgerEntrySource = {
    kind: 'join',
    stepId: step.stepId,
    label: `join:${step.stepId}`,
  }
  const entries: LedgerEntry[] = [makeEntry('branches', 'object', 'always', source)]

  const outputMapping = step.config?.outputMapping
  if (isPlainObject(outputMapping)) {
    for (const targetKey of Object.keys(outputMapping)) {
      if (targetKey === 'branches') continue
      entries.push(makeEntry(targetKey, 'unknown', 'maybe', source))
    }
  }

  return entries
}

function asyncResultContributions(
  activity: LedgerActivityDefinition,
  stepId: string | undefined,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  const resultKey = `${activity.activityId}_result`
  const source: LedgerEntrySource = {
    kind: 'asyncResult',
    stepId,
    activityId: activity.activityId,
    label: `asyncActivity:${activity.activityId}`,
  }
  const contract = options.resolveOutputContract?.(activity.activityType, activity.config)
  if (contract && contract !== 'unknown' && contract.entries.length > 0) {
    return contract.entries.map((entry) =>
      makeEntry(`${resultKey}.${entry.path}`, entry.type, 'always', source),
    )
  }
  return [makeEntry(resultKey, 'unknown', 'always', source)]
}

function setVariableContributions(
  activity: LedgerActivityDefinition,
  presence: LedgerPresence,
): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const assignments = activity.config?.assignments
  if (!Array.isArray(assignments)) return entries

  const source: LedgerEntrySource = {
    kind: 'setVariable',
    activityId: activity.activityId,
    label: `setVariable:${activity.activityId}`,
  }

  for (const assignment of assignments) {
    if (!isPlainObject(assignment) || typeof assignment.path !== 'string') continue
    const segments = splitAssignmentPath(assignment.path)
    if (segments === null || segments.length === 0) continue
    entries.push(makeEntry(segments.join('.'), literalValueType(assignment.value), presence, source))
  }

  return entries
}

function syncActivityContributions(
  activity: LedgerActivityDefinition,
  presence: LedgerPresence,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  const namespacedKey = activity.activityName || activity.activityType
  const source: LedgerEntrySource = {
    kind: 'activity',
    activityId: activity.activityId,
    label: `activity:${activity.activityId}`,
  }
  const contract = options.resolveOutputContract?.(activity.activityType, activity.config)
  if (contract && contract !== 'unknown' && contract.entries.length > 0) {
    return contract.entries.map((entry) =>
      makeEntry(`${namespacedKey}.${entry.path}`, entry.type, presence, source),
    )
  }
  return [makeEntry(namespacedKey, 'unknown', presence, source)]
}

function transitionContributions(
  transition: LedgerTransitionDefinition,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  const syncPresence: LedgerPresence = transition.continueOnActivityFailure === true ? 'maybe' : 'always'

  for (const activity of transition.activities ?? []) {
    if (activity.async === true) {
      entries.push(...asyncResultContributions(activity, undefined, options))
    } else if (activity.activityType === 'SET_VARIABLE') {
      entries.push(...setVariableContributions(activity, syncPresence))
    } else {
      entries.push(...syncActivityContributions(activity, syncPresence, options))
    }
  }

  return entries
}

function stepContributions(
  step: LedgerStepDefinition,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  switch (step.stepType) {
    case 'USER_TASK':
      return userTaskContributions(step)
    case 'WAIT_FOR_SIGNAL':
      return signalContributions(step)
    case 'PARALLEL_JOIN':
      return joinContributions(step)
    case 'AUTOMATED':
      return (step.activities ?? [])
        .filter((activity) => activity.async === true)
        .flatMap((activity) => asyncResultContributions(activity, step.stepId, options))
    default:
      return []
  }
}

function applyContributions(base: LedgerMap, contributions: LedgerEntry[]): LedgerMap {
  if (contributions.length === 0) return base
  const merged: LedgerMap = new Map(base)
  for (const entry of contributions) {
    merged.set(entry.path, entry)
  }
  return merged
}

function joinRoutes(routes: LedgerMap[]): LedgerMap {
  if (routes.length === 1) return routes[0]
  const joined: LedgerMap = new Map()
  const allPaths = new Set<string>()
  for (const route of routes) {
    for (const path of route.keys()) allPaths.add(path)
  }
  for (const path of allPaths) {
    const present = routes.filter((route) => route.has(path))
    const first = present[0].get(path) as LedgerEntry
    const onEveryRoute = present.length === routes.length
    const alwaysOnEveryRoute = onEveryRoute && present.every((route) => route.get(path)?.presence === 'always')
    const typesAgree = present.every((route) => route.get(path)?.type === first.type)
    joined.set(path, {
      path,
      type: typesAgree ? first.type : 'unknown',
      presence: alwaysOnEveryRoute ? 'always' : 'maybe',
      source: first.source,
    })
  }
  return joined
}

const UNREACHABLE_SENTINEL = '<unreachable>'

function serializeLedgerMap(ledger: LedgerMap | null): string {
  if (ledger === null) return UNREACHABLE_SENTINEL
  const parts: string[] = []
  for (const path of [...ledger.keys()].sort()) {
    const entry = ledger.get(path) as LedgerEntry
    parts.push(`${path}|${entry.type}|${entry.presence}|${entry.source.kind}|${entry.source.label}`)
  }
  return parts.join(';')
}

function resolveStartStepIds(definition: LedgerWorkflowDefinition): Set<string> {
  const startTyped = definition.steps.filter((step) => step.stepType === 'START')
  if (startTyped.length > 0) return new Set(startTyped.map((step) => step.stepId))
  const targetIds = new Set(definition.transitions.map((transition) => transition.toStepId))
  return new Set(definition.steps.filter((step) => !targetIds.has(step.stepId)).map((step) => step.stepId))
}

function orderStepsFromStarts(
  definition: LedgerWorkflowDefinition,
  startIds: Set<string>,
): LedgerStepDefinition[] {
  const stepById = new Map(definition.steps.map((step) => [step.stepId, step]))
  const successors = new Map<string, string[]>()
  for (const transition of definition.transitions) {
    const list = successors.get(transition.fromStepId) ?? []
    list.push(transition.toStepId)
    successors.set(transition.fromStepId, list)
  }

  const visited = new Set<string>()
  const ordered: LedgerStepDefinition[] = []
  const queue = definition.steps.filter((step) => startIds.has(step.stepId)).map((step) => step.stepId)
  while (queue.length > 0) {
    const stepId = queue.shift() as string
    if (visited.has(stepId)) continue
    visited.add(stepId)
    const step = stepById.get(stepId)
    if (step) ordered.push(step)
    for (const successor of successors.get(stepId) ?? []) {
      if (!visited.has(successor)) queue.push(successor)
    }
  }
  for (const step of definition.steps) {
    if (!visited.has(step.stepId)) ordered.push(step)
  }
  return ordered
}

export function computeContextLedger(
  definition: LedgerWorkflowDefinition,
  options: ComputeContextLedgerOptions = {},
): ContextLedger {
  const startIds = resolveStartStepIds(definition)
  const orderedSteps = orderStepsFromStarts(definition, startIds)
  const stepById = new Map(definition.steps.map((step) => [step.stepId, step]))

  const incomingTransitions = new Map<string, LedgerTransitionDefinition[]>()
  for (const transition of definition.transitions) {
    if (!stepById.has(transition.fromStepId) || !stepById.has(transition.toStepId)) continue
    const list = incomingTransitions.get(transition.toStepId) ?? []
    list.push(transition)
    incomingTransitions.set(transition.toStepId, list)
  }

  const initialRoute: LedgerMap = applyContributions(new Map(), initialContributions(definition))
  const incoming = new Map<string, LedgerMap | null>(
    definition.steps.map((step) => [step.stepId, null]),
  )

  const outgoingOf = (stepId: string): LedgerMap | null => {
    const stepIncoming = incoming.get(stepId)
    if (stepIncoming === null || stepIncoming === undefined) return null
    const step = stepById.get(stepId)
    if (!step) return stepIncoming
    return applyContributions(stepIncoming, stepContributions(step, options))
  }

  const maxPasses = definition.steps.length * 2 + 4
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false
    for (const step of orderedSteps) {
      const routes: LedgerMap[] = []
      if (startIds.has(step.stepId)) {
        routes.push(initialRoute)
      }
      for (const transition of incomingTransitions.get(step.stepId) ?? []) {
        const sourceOutgoing = outgoingOf(transition.fromStepId)
        if (sourceOutgoing === null) continue
        routes.push(applyContributions(sourceOutgoing, transitionContributions(transition, options)))
      }
      const nextIncoming = routes.length === 0 ? null : joinRoutes(routes)
      if (serializeLedgerMap(nextIncoming) !== serializeLedgerMap(incoming.get(step.stepId) ?? null)) {
        incoming.set(step.stepId, nextIncoming)
        changed = true
      }
    }
    if (!changed) break
  }

  const steps: Record<string, LedgerStepView> = {}
  for (const step of definition.steps) {
    const ledger = incoming.get(step.stepId)
    const entries = ledger
      ? [...ledger.values()].sort((left, right) => left.path.localeCompare(right.path))
      : []
    steps[step.stepId] = { entries }
  }

  return { steps }
}
