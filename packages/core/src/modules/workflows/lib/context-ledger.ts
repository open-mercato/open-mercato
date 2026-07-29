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
 *   (`required` → always, else maybe). `contextSchema.input` is the CANONICAL
 *   input contract; when it is absent, `definition.io.inputs` (the sub-workflow
 *   port contract) is read through as a deprecated alias — port fields share
 *   the same name/type/required vocabulary, so they map 1:1 onto START entries.
 *   Full `@deprecated` dual-emit for `io.inputs` is follow-up work; this is the
 *   read-through half only. Plus, per definition trigger, the
 *   whole-payload flat spread (one `'*'` wildcard entry, always untyped),
 *   `contextMapping` target keys (named; typed from the trigger event's
 *   payload contract when the caller pre-resolves one into
 *   `options.triggerPayloadContracts`, `unknown` otherwise), and the `__trigger.*` metadata keys
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
 * - SUB_WORKFLOW is PATH-DEPENDENT and contributes its `config.outputMapping`
 *   target keys, all `maybe`. Two resolution paths exist and only one of them
 *   merges. When the child terminates inside the parent's own call,
 *   handleSubWorkflowStep returns the mapped output as `stepInstance.outputData`
 *   only (`exitStep` writes it there and nowhere else). When the child instead
 *   parks on its first async/agent step, the parent parks on
 *   SUB_WORKFLOW_SIGNAL_NAME and the child's terminal
 *   `resume_subworkflow_parent` job maps the same output through the shared
 *   `mapSubWorkflowOutput` and hands it to `sendSignal`, which spreads the
 *   payload FLAT into `instance.context` (signal-handler). So a mapped key
 *   genuinely lands on the async path and never on the inline one, and which
 *   path runs is a property of the CHILD at runtime rather than of the parent
 *   definition — hence `maybe` on every entry (the mapping additionally drops
 *   any target whose source path resolves to `undefined`). Targets stay
 *   `unknown`-typed: their source paths address the CHILD's context and the
 *   child's `io.outputs` contract lives on the CHILD definition, which this
 *   pure function is never given.
 *   Two real contributions are deliberately NOT modeled. (1) With no mapping —
 *   or when no mapped source resolves — `mapOutputData` falls back to the WHOLE
 *   child context; those keys cannot be named from the parent definition, and a
 *   `'*'` wildcard would silence every downstream unresolved-ref warning, so a
 *   step declaring no `outputMapping` advertises nothing. (2) `sendSignal` also
 *   records `signal_<name>_payload`/`_receivedAt`, but the sub-workflow signal
 *   name is `workflows.sub_workflow.completed`, so the flat key contains dots
 *   and `{{context.*}}` resolution (getNestedValue splits on `.`) can never
 *   reach it — advertising it would hand the picker a path that cannot resolve.
 * - INVOKE_AGENT (an AUTOMATED step carrying an `INVOKE_AGENT` activity) is
 *   the verified exception to the "AUTOMATED sync outputs stay in outputData"
 *   rule: its result IS merged top-level into `instance.context`. Three
 *   resolution paths (step-handler inline branch, activity-worker-handler
 *   parked resume, agent_orchestrator's human dispose → sendSignal) merge
 *   different key sets, so every entry is `maybe`: `outputMapping` target keys
 *   when a mapping is declared (mapAgentResultToContext, machine paths only;
 *   typed from the mapping's source path against the INVOKE_AGENT envelope the
 *   injected `resolveOutputContract` seam resolves from the selected agent's
 *   OUTCOME schema, `unknown` when the optional agent peer cannot type it);
 *   the legacy fixed keys `disposition`/`agentId`/`agentProposalId`/
 *   `proposalPayload`/`<stepId>_agent` when it is not; the human dispose path
 *   always merges `disposition`/`proposalId`/`stepId`/`proposalPayload`
 *   regardless of mapping; and any parked resume goes through sendSignal,
 *   adding `signal_<name>_payload`/`signal_<name>_receivedAt` for the step's
 *   `signalConfig.signalName` (default `agent_orchestrator.proposal.ready`).
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
  | 'invokeAgent'

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
  /**
   * Pre-resolved payload contracts for the definition's triggers, keyed by
   * triggerId — plain data, so the lib stays pure (no event-registry access
   * here). Build them at the call site with `buildTriggerPayloadContracts`
   * from the declared events. When a trigger has a contract, its
   * `contextMapping` target entries are typed from the mapping's source path;
   * otherwise they stay `unknown`.
   */
  triggerPayloadContracts?: Record<string, LedgerContract>
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
  eventPattern?: string
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

export interface LedgerIoContract {
  inputs?: LedgerContextSchemaField[]
}

export interface LedgerWorkflowDefinition {
  steps: LedgerStepDefinition[]
  transitions: LedgerTransitionDefinition[]
  triggers?: LedgerTriggerDefinition[]
  contextSchema?: LedgerContextSchema
  io?: LedgerIoContract
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

const LEDGER_TYPE_VALUES: ReadonlySet<string> = new Set<LedgerType>([
  'text',
  'number',
  'boolean',
  'select',
  'date',
  'object',
  'unknown',
])

function toLedgerType(raw: unknown): LedgerType {
  return typeof raw === 'string' && LEDGER_TYPE_VALUES.has(raw) ? (raw as LedgerType) : 'unknown'
}

export interface TriggerPayloadEventInput {
  id: string
  payloadSchema?: {
    fields: ReadonlyArray<{ path: string; type: string; optional?: boolean }>
  }
}

/**
 * Pure pre-resolution of trigger payload contracts from declared events, for
 * `ComputeContextLedgerOptions.triggerPayloadContracts`. Only an EXACT event
 * pattern (no `*` wildcard) with a non-empty declared payloadSchema resolves;
 * wildcard patterns and schema-less events yield no contract so their mapping
 * targets stay `unknown`. Both call sites (the server context-schema route via
 * `getDeclaredEvents()` and the client editor via its fetched events list)
 * feed this the same plain-data shape.
 */
export function buildTriggerPayloadContracts(
  triggers: ReadonlyArray<{ triggerId: string; eventPattern?: string | null }>,
  events: ReadonlyArray<TriggerPayloadEventInput>,
): Record<string, LedgerContract> {
  const contracts: Record<string, LedgerContract> = {}
  if (triggers.length === 0 || events.length === 0) return contracts
  const eventsById = new Map(events.map(event => [event.id, event]))
  for (const trigger of triggers) {
    if (!trigger.triggerId) continue
    const pattern = typeof trigger.eventPattern === 'string' ? trigger.eventPattern.trim() : ''
    if (!pattern || pattern.includes('*')) continue
    const fields = eventsById.get(pattern)?.payloadSchema?.fields
    if (!fields || fields.length === 0) continue
    contracts[trigger.triggerId] = {
      entries: fields.map(field => ({ path: field.path, type: toLedgerType(field.type) })),
    }
  }
  return contracts
}

function initialContributions(
  definition: LedgerWorkflowDefinition,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  const entries: LedgerEntry[] = []

  // contextSchema.input is canonical; definition.io.inputs (the sub-workflow
  // port contract) is a deprecated read-through alias consulted only when no
  // contextSchema input is declared. Both share the name/type/required field
  // vocabulary, so the mapping is identical.
  const declaredFields = definition.contextSchema?.input?.fields
  const usingIoAlias = !declaredFields || declaredFields.length === 0
  const inputFields = usingIoAlias ? definition.io?.inputs ?? [] : declaredFields
  for (const field of inputFields) {
    if (!field.name) continue
    entries.push(
      makeEntry(field.name, mapFieldType(field.type), field.required ? 'always' : 'maybe', {
        kind: 'contextSchema',
        label: usingIoAlias ? 'io.inputs (read-through)' : 'contextSchema.input',
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

    const payloadContract = options.triggerPayloadContracts?.[trigger.triggerId]
    const contextMapping = trigger.config?.contextMapping
    if (Array.isArray(contextMapping)) {
      for (const mapping of contextMapping) {
        if (!isPlainObject(mapping) || typeof mapping.targetKey !== 'string' || !mapping.targetKey) continue
        const sourcePath = typeof mapping.sourceExpression === 'string' ? mapping.sourceExpression : null
        const mappedType =
          payloadContract && sourcePath
            ? payloadContract.entries.find(entry => entry.path === sourcePath)?.type ?? 'unknown'
            : 'unknown'
        entries.push(
          makeEntry(mapping.targetKey, mappedType, 'maybe', {
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

function subWorkflowContributions(step: LedgerStepDefinition): LedgerEntry[] {
  const outputMapping = step.config?.outputMapping
  if (!isPlainObject(outputMapping)) return []

  const source: LedgerEntrySource = {
    kind: 'subWorkflow',
    stepId: step.stepId,
    label: `subWorkflow:${step.stepId}`,
  }

  const entries: LedgerEntry[] = []
  for (const targetKey of Object.keys(outputMapping)) {
    if (!targetKey) continue
    entries.push(makeEntry(targetKey, 'unknown', 'maybe', source))
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

// Mirrors INVOKE_AGENT_SIGNAL_NAME in lib/activity-executor.ts — duplicated
// here because the ledger's purity boundary forbids importing engine modules.
const INVOKE_AGENT_DEFAULT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'

function invokeAgentContributions(
  step: LedgerStepDefinition,
  options: ComputeContextLedgerOptions,
): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const activity of step.activities ?? []) {
    if (activity.activityType !== 'INVOKE_AGENT') continue
    const source: LedgerEntrySource = {
      kind: 'invokeAgent',
      stepId: step.stepId,
      activityId: activity.activityId,
      label: `invokeAgent:${activity.activityId}`,
    }

    // Everything is `maybe`: which keys land depends on the resolution path
    // (inline auto_approved/informative, parked machine resume, or human
    // dispose) and, for mapped keys, on the source path resolving.
    const outputMapping = activity.config?.outputMapping
    const hasMapping = isPlainObject(outputMapping) && Object.keys(outputMapping).length > 0
    if (hasMapping) {
      const envelopeContract = options.resolveOutputContract?.(activity.activityType, activity.config)
      const typedEnvelope = envelopeContract && envelopeContract !== 'unknown' ? envelopeContract : null
      for (const [targetKey, sourcePath] of Object.entries(outputMapping)) {
        if (!targetKey) continue
        const mappedType =
          typedEnvelope && typeof sourcePath === 'string'
            ? typedEnvelope.entries.find(entry => entry.path === sourcePath)?.type ?? 'unknown'
            : 'unknown'
        entries.push(makeEntry(targetKey, mappedType, 'maybe', source))
      }
    } else {
      // Legacy fixed-key merge (step-handler inline branch and
      // activity-worker-handler parked resume).
      entries.push(makeEntry('agentId', 'text', 'maybe', source))
      entries.push(makeEntry('agentProposalId', 'text', 'maybe', source))
      entries.push(makeEntry(`${step.stepId}_agent`, 'unknown', 'maybe', source))
    }

    // agent_orchestrator's human dispose path (lib/disposition/resume.ts)
    // merges these regardless of any declared outputMapping.
    entries.push(makeEntry('disposition', 'text', 'maybe', source))
    entries.push(makeEntry('proposalId', 'text', 'maybe', source))
    entries.push(makeEntry('stepId', 'text', 'maybe', source))
    entries.push(makeEntry('proposalPayload', 'unknown', 'maybe', source))

    // Any parked resume arrives via sendSignal, which also records the signal
    // envelope keys for the step's park signal.
    const configuredSignal = step.signalConfig?.signalName
    const signalName =
      typeof configuredSignal === 'string' && configuredSignal
        ? configuredSignal
        : INVOKE_AGENT_DEFAULT_SIGNAL_NAME
    entries.push(makeEntry(`signal_${signalName}_payload`, 'object', 'maybe', source))
    entries.push(makeEntry(`signal_${signalName}_receivedAt`, 'date', 'maybe', source))
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
    case 'SUB_WORKFLOW':
      return subWorkflowContributions(step)
    case 'AUTOMATED':
      return [
        ...(step.activities ?? [])
          .filter((activity) => activity.async === true)
          .flatMap((activity) => asyncResultContributions(activity, step.stepId, options)),
        ...invokeAgentContributions(step, options),
      ]
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
  for (const path of [...ledger.keys()].sort((left, right) => left.localeCompare(right))) {
    const entry = ledger.get(path) as LedgerEntry
    parts.push(`${path}|${entry.type}|${entry.presence}|${entry.source.kind}|${entry.source.stepId ?? ''}|${entry.source.activityId ?? ''}|${entry.source.label}`)
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

  const initialRoute: LedgerMap = applyContributions(new Map(), initialContributions(definition, options))
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
