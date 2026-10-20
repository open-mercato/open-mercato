import { createHash } from 'node:crypto'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getAllDeclaredEventIds } from '@open-mercato/shared/modules/events'
import {
  defineSimulationKind,
  simulationEventEntityType,
  type RegisteredSimulationEventAdapter,
  type SimulationArtifactContext,
  type SimulationArtifactVersion,
  type SimulationAuditCursor,
  type SimulationAuditEntry,
  type SimulationCoverage,
  type SimulationGroup,
  type SimulationKindResult,
  type SimulationRunContext,
  type SimulationSliceResult,
  type SimulationValidationResult,
} from '@open-mercato/shared/modules/insights/simulate'
import { getAllCodeWorkflows, getCodeWorkflow } from '@open-mercato/shared/modules/workflows/code-registry'
import { WorkflowDefinition, WorkflowEventTrigger } from '../../data/entities'
import {
  startPreConditionSchema,
  workflowDefinitionTriggerSchema,
  workflowTriggerBacktestProposalSchema,
  type WorkflowTriggerBacktestProposal,
} from '../../data/validators'
import { isWorkflowTriggerExcludedEvent } from '../../subscribers/event-trigger'
import { codeWorkflowUuid } from '../find-definition'
import { readOwnTriggerPayloadPath } from '../trigger-filter'
import { evaluateFilterConditionsTri, isUnknownTriggerPayloadPath } from './trigger-filter-tri'

const logger = createLogger('workflows').child({ component: 'trigger-backtest' })

export const TRIGGER_BACKTEST_KIND = 'workflows.trigger_backtest'

export const TRIGGER_BACKTEST_ARTIFACT_KIND = 'workflows.definition'

/** Bump when the backtest semantics change: it is part of every run's inputs hash. */
export const TRIGGER_BACKTEST_VERSION = 1

export const TRIGGER_BACKTEST_CELLS = ['would_start', 'would_not_start', 'debounced', 'cannot_tell'] as const

export type TriggerBacktestCell = (typeof TRIGGER_BACKTEST_CELLS)[number]

export const TRIGGER_BACKTEST_FEATURES = ['workflows.definitions.view']

export const TRIGGER_BACKTEST_FINGERPRINT_VERSION = 1

const SAMPLE_CANDIDATES = 10

const MAX_RECORD_ID_LENGTH = 255

const RECORD_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

const GROUP_KEY_SEPARATOR = ':'

const CODE_ARTIFACT_PREFIX = 'code:'

export const TRIGGER_BACKTEST_I18N = {
  label: 'workflows.simulation.kind.triggerBacktest',
  caveats: {
    firstOrder: 'workflows.simulation.caveats.firstOrder',
    queueClock: 'workflows.simulation.caveats.queueClock',
    debounceProcess: 'workflows.simulation.caveats.debounceProcess',
    reconstructed: 'workflows.simulation.caveats.reconstructed',
    partialEvents: 'workflows.simulation.caveats.partialEvents',
    truncated: 'workflows.simulation.caveats.truncated',
    legacyTriggers: 'workflows.simulation.caveats.legacyTriggers',
    shadowsCodeTriggers: 'workflows.simulation.caveats.shadowsCodeTriggers',
  },
  warnings: {
    definitionDisabled: 'workflows.simulation.warnings.definitionDisabled',
    notPublished: 'workflows.simulation.warnings.notPublished',
    notLiveVersion: 'workflows.simulation.warnings.notLiveVersion',
    triggerDisabled: 'workflows.simulation.warnings.triggerDisabled',
    maxConcurrentInstances: 'workflows.simulation.warnings.maxConcurrentInstances',
    startPreConditions: 'workflows.simulation.warnings.startPreConditions',
    partialEvents: 'workflows.simulation.warnings.partialEvents',
    excludedEvents: 'workflows.simulation.warnings.excludedEvents',
    noAdapter: 'workflows.simulation.warnings.noAdapter',
    noEvents: 'workflows.simulation.warnings.noEvents',
    neverMatches: 'workflows.simulation.warnings.neverMatches',
    prototypePath: 'workflows.simulation.warnings.prototypePath',
  },
} as const

type ProposalTrigger = WorkflowTriggerBacktestProposal['triggers'][number]

type DefinitionVersionRow = {
  id: string
  version: number
  enabled: boolean
  lifecycle: string
}

export type TriggerBacktestSetup = {
  live: boolean
  liveWarnings: string[]
  legacyTriggers: boolean
  shadowsCodeTriggers: boolean
}

type GroupState = {
  triggerId: string
  eventId: string
  cells: Record<TriggerBacktestCell, number>
  samples: Record<TriggerBacktestCell, string[]>
  prototypePath: boolean
}

/**
 * Debounce windows of the simulated triggers, as epoch ms, persisted between slices (jsonb, so keys
 * are JSON-encoded tuples: never a NUL, never a prototype member name). `windows` maps
 * `["<triggerId>","<payload id>"]` to `[knownUntil, uncertainUntil]`: `knownUntil` ends a window a
 * certain start opened (open in every possible history), `uncertainUntil` the latest end of a window
 * an uncertain event may have opened. `wildcard` maps `["<triggerId>"]` to the latest end of a
 * window that may exist for ANY payload id of the trigger (an event without a known payload id, or a
 * window opened before the run window started).
 */
export type TriggerDebounceState = {
  windows: Record<string, [number, number]>
  wildcard: Record<string, number>
}

export type TriggerBacktestState = {
  phase: 'scan' | 'done'
  setup: TriggerBacktestSetup | null
  auditCursor: SimulationAuditCursor | null
  debounce: TriggerDebounceState
  groups: Record<string, GroupState>
  coverage: Record<string, number>
  events: number
  truncated: boolean
}

export function initialTriggerBacktestState(): TriggerBacktestState {
  return {
    phase: 'scan',
    setup: null,
    auditCursor: null,
    debounce: { windows: {}, wildcard: {} },
    groups: {},
    coverage: {},
    events: 0,
    truncated: false,
  }
}

function emptyCells(): Record<TriggerBacktestCell, number> {
  return { would_start: 0, would_not_start: 0, debounced: 0, cannot_tell: 0 }
}

function emptySamples(): Record<TriggerBacktestCell, string[]> {
  return { would_start: [], would_not_start: [], debounced: [], cannot_tell: [] }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function bump(state: TriggerBacktestState, key: string, by = 1): void {
  if (by === 0) return
  state.coverage[key] = (state.coverage[key] ?? 0) + by
}

function readOwn<TValue>(record: Record<string, TValue>, key: string): TValue | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined
}

export function triggerDebounceWindowKey(triggerId: string, bucket: string): string {
  return JSON.stringify([triggerId, bucket])
}

export function triggerDebounceWildcardKey(triggerId: string): string {
  return JSON.stringify([triggerId])
}

export function triggerBacktestGroupKey(triggerId: string, eventId: string | null): string {
  return eventId ? `${triggerId}${GROUP_KEY_SEPARATOR}${eventId}` : triggerId
}

/** Adapters of events the trigger subscriber evaluates at all (excluded prefixes never reach triggers). */
function evaluableAdapters(adapters: readonly RegisteredSimulationEventAdapter[]): RegisteredSimulationEventAdapter[] {
  return adapters.filter((adapter) => !isWorkflowTriggerExcludedEvent(adapter.eventId))
}

/** Whether the trigger's pattern selects the event, exactly as `findMatchingTriggers` does. */
export function triggerMatchesEvent(trigger: Pick<ProposalTrigger, 'eventPattern'>, eventId: string): boolean {
  return !isWorkflowTriggerExcludedEvent(eventId) && matchEventPattern(eventId, trigger.eventPattern)
}

/** The adapters whose event at least one proposed trigger (enabled or not) listens to. */
export function matchedTriggerAdapters(
  triggers: readonly Pick<ProposalTrigger, 'eventPattern'>[],
  adapters: readonly RegisteredSimulationEventAdapter[],
): RegisteredSimulationEventAdapter[] {
  return evaluableAdapters(adapters).filter((adapter) => triggers.some((trigger) => matchEventPattern(adapter.eventId, trigger.eventPattern)))
}

/**
 * Whether every event the pattern selects in production can be rebuilt: `complete` when the
 * declared event catalog proves that each declared, non-excluded event the pattern matches has an
 * adapter. A `*` pattern, or a pattern whose module's events are not declared in this process, is
 * never complete. A pattern that selects no adapted event replays nothing (the trigger is reported
 * with `noAdapter` instead). `unreplayed` lists the declared events the replay misses.
 */
export function triggerEventCompleteness(
  eventPattern: string,
  adapters: readonly RegisteredSimulationEventAdapter[],
  declaredEventIds: readonly string[] = getAllDeclaredEventIds(),
): { complete: boolean; unreplayed: string[] } {
  const listened = evaluableAdapters(adapters).filter((adapter) => matchEventPattern(adapter.eventId, eventPattern))
  if (listened.length === 0) return { complete: true, unreplayed: [] }
  if (eventPattern === '*') return { complete: false, unreplayed: [] }
  const declared = new Set(declaredEventIds)
  if (!listened.every((adapter) => declared.has(adapter.eventId))) return { complete: false, unreplayed: [] }
  const adapted = new Set(listened.map((adapter) => adapter.eventId))
  const unreplayed = Array.from(declared)
    .filter((eventId) => !adapted.has(eventId) && triggerMatchesEvent({ eventPattern }, eventId))
    .sort(compareCodeUnits)
  return { complete: unreplayed.length === 0, unreplayed }
}

function hasMaxConcurrentInstances(trigger: ProposalTrigger): boolean {
  return Boolean(trigger.config?.maxConcurrentInstances)
}

function debounceMsOf(trigger: ProposalTrigger): number {
  const debounceMs = trigger.config?.debounceMs
  return typeof debounceMs === 'number' && debounceMs > 0 ? debounceMs : 0
}

/** START pre-conditions `validateWorkflowStart` can fail on (only `required` ones block a start). */
export function hasBlockingStartPreConditions(preConditions: readonly { required?: boolean }[] | null | undefined): boolean {
  return (preConditions ?? []).some((condition) => condition.required !== false)
}

/**
 * Which version's triggers are live after the proposal is saved (S7): triggers come only from the
 * highest enabled, published version of the workflow (`loadEmbeddedTriggers`). The proposal is live
 * when it is enabled, published and no other enabled, published version of the same workflow has an
 * equal or higher version.
 */
export function resolveProposalLiveness(
  proposal: { enabled: boolean; version: number },
  lifecycle: string,
  others: readonly DefinitionVersionRow[],
): { live: boolean; warnings: string[] } {
  const warnings: string[] = []
  if (!proposal.enabled) warnings.push(TRIGGER_BACKTEST_I18N.warnings.definitionDisabled)
  if (lifecycle !== 'published') warnings.push(TRIGGER_BACKTEST_I18N.warnings.notPublished)
  if (others.some((row) => row.enabled && row.lifecycle === 'published' && row.version >= proposal.version)) {
    warnings.push(TRIGGER_BACKTEST_I18N.warnings.notLiveVersion)
  }
  return { live: warnings.length === 0, warnings }
}

/** The debounce bucket production keys a window by (`payload.id`, numbers stringified, else `*`); null when the id is unknown. */
export function triggerDebounceBucket(payload: Record<string, unknown>, unknownPaths: readonly string[]): string | null {
  if (isUnknownTriggerPayloadPath('id', unknownPaths)) return null
  const read = readOwnTriggerPayloadPath(payload, 'id')
  const value = read.status === 'found' ? read.value : undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return '*'
}

export type TriggerEventInput = {
  trigger: ProposalTrigger
  active: boolean
  startCertain: boolean
  /** False when events the replay cannot rebuild may open or occupy this trigger's debounce windows. */
  windowsComplete: boolean
  payload: Record<string, unknown>
  unknownPaths: readonly string[]
  at: number
}

/**
 * The outcome of one event for one trigger, mirroring `processEventTriggers`: an inactive trigger
 * (disabled, or its definition is not the live version) never starts; a filter that fails does not
 * touch the debounce window; a matching event inside an open window (leading edge, per trigger and
 * payload id) is `debounced`; otherwise the event starts the workflow and opens the window. An
 * unknown filter input, a configured `maxConcurrentInstances` or blocking START pre-conditions make
 * the start uncertain (`cannot_tell`); production releases the window of a start that did not
 * happen, so an uncertain start leaves an uncertain window, and events inside it are `cannot_tell`
 * too. A debounced trigger whose windows unreplayed events may share answers `cannot_tell` for every
 * matching event. Mutates `debounce`.
 */
export function evaluateTriggerEvent(
  input: TriggerEventInput,
  debounce: TriggerDebounceState,
): { cell: TriggerBacktestCell; prototypePath: boolean } {
  if (!input.active) return { cell: 'would_not_start', prototypePath: false }
  const filter = evaluateFilterConditionsTri(input.trigger.config?.filterConditions, input.payload, { unknownPaths: input.unknownPaths })
  if (filter.outcome === 'false') return { cell: 'would_not_start', prototypePath: false }
  const prototypePath = filter.reasons.includes('prototype_path')
  const matched = filter.outcome === 'true'
  const certainStart = matched && input.startCertain
  const debounceMs = debounceMsOf(input.trigger)
  if (debounceMs === 0) return { cell: certainStart ? 'would_start' : 'cannot_tell', prototypePath }
  if (!input.windowsComplete) return { cell: 'cannot_tell', prototypePath }
  const until = input.at + debounceMs
  const wildcardKey = triggerDebounceWildcardKey(input.trigger.triggerId)
  const wildcardUntil = readOwn(debounce.wildcard, wildcardKey) ?? 0
  const bucket = triggerDebounceBucket(input.payload, input.unknownPaths)
  if (bucket === null) {
    debounce.wildcard[wildcardKey] = Math.max(wildcardUntil, until)
    return { cell: 'cannot_tell', prototypePath }
  }
  const key = triggerDebounceWindowKey(input.trigger.triggerId, bucket)
  const [knownUntil, uncertainUntil] = readOwn(debounce.windows, key) ?? [0, 0]
  if (input.at < knownUntil) return { cell: matched ? 'debounced' : 'cannot_tell', prototypePath }
  if (input.at < Math.max(uncertainUntil, wildcardUntil) || !certainStart) {
    debounce.windows[key] = [knownUntil, Math.max(uncertainUntil, until)]
    return { cell: 'cannot_tell', prototypePath }
  }
  debounce.windows[key] = [until, uncertainUntil]
  return { cell: 'would_start', prototypePath }
}

/**
 * Windows production may have opened before the run window began (from events the scan does not
 * read) can still debounce its first events: every debounced trigger starts with a window that may
 * exist for any payload id until `windowFrom + debounceMs`.
 */
export function seedTriggerDebounceState(debounce: TriggerDebounceState, triggers: readonly ProposalTrigger[], windowFrom: number): void {
  for (const trigger of triggers) {
    const debounceMs = debounceMsOf(trigger)
    if (debounceMs === 0) continue
    const key = triggerDebounceWildcardKey(trigger.triggerId)
    debounce.wildcard[key] = Math.max(readOwn(debounce.wildcard, key) ?? 0, windowFrom + debounceMs)
  }
}

/** Drops windows that closed before `at` (events arrive in time order, so they can never apply again). */
export function pruneTriggerDebounceState(debounce: TriggerDebounceState, at: number): void {
  for (const [key, [knownUntil, uncertainUntil]] of Object.entries(debounce.windows)) {
    if (Math.max(knownUntil, uncertainUntil) <= at) delete debounce.windows[key]
  }
  for (const [key, until] of Object.entries(debounce.wildcard)) {
    if (until <= at) delete debounce.wildcard[key]
  }
}

function normalizeRecordId(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_RECORD_ID_LENGTH) return null
  if (RECORD_ID_CONTROL_CHARACTER_PATTERN.test(trimmed)) return null
  return trimmed
}

/**
 * The record id used for sample confirmation: the payload's `entityId` when present (customers
 * person/company payloads carry the profile id in `id`), else its `id`; never an unknown path.
 */
export function triggerSampleRecordId(payload: Record<string, unknown>, unknownPaths: readonly string[]): string | null {
  for (const key of ['entityId', 'id']) {
    if (isUnknownTriggerPayloadPath(key, unknownPaths)) continue
    const read = readOwnTriggerPayloadPath(payload, key)
    const candidate = read.status === 'found' ? normalizeRecordId(read.value) : null
    if (candidate) return candidate
  }
  return null
}

function recordOutcome(state: TriggerBacktestState, triggerId: string, eventId: string, cell: TriggerBacktestCell, prototypePath: boolean, sampleId: string | null): void {
  const key = triggerBacktestGroupKey(triggerId, eventId)
  const group = readOwn(state.groups, key) ?? (state.groups[key] = { triggerId, eventId, cells: emptyCells(), samples: emptySamples(), prototypePath: false })
  group.cells[cell] += 1
  if (prototypePath) group.prototypePath = true
  const samples = group.samples[cell]
  if (sampleId && samples.length < SAMPLE_CANDIDATES && !samples.includes(sampleId)) samples.push(sampleId)
}

function isTriggerActive(trigger: ProposalTrigger, setup: TriggerBacktestSetup): boolean {
  return setup.live && trigger.enabled !== false
}

function triggerStructuralWarnings(
  trigger: ProposalTrigger,
  proposal: WorkflowTriggerBacktestProposal,
  setup: TriggerBacktestSetup,
  complete: boolean,
): string[] {
  const warnings = [...setup.liveWarnings]
  if (!complete) warnings.push(TRIGGER_BACKTEST_I18N.warnings.partialEvents)
  if (!trigger.enabled) {
    warnings.push(TRIGGER_BACKTEST_I18N.warnings.triggerDisabled)
    return warnings
  }
  if (!setup.live) return warnings
  if (hasMaxConcurrentInstances(trigger)) warnings.push(TRIGGER_BACKTEST_I18N.warnings.maxConcurrentInstances)
  if (hasBlockingStartPreConditions(proposal.startPreConditions)) warnings.push(TRIGGER_BACKTEST_I18N.warnings.startPreConditions)
  return warnings
}

function triggerGroups(
  trigger: ProposalTrigger,
  proposal: WorkflowTriggerBacktestProposal,
  state: TriggerBacktestState,
  setup: TriggerBacktestSetup,
  evaluable: readonly RegisteredSimulationEventAdapter[],
): SimulationGroup[] {
  const completeness = triggerEventCompleteness(trigger.eventPattern, evaluable)
  const warnings = triggerStructuralWarnings(trigger, proposal, setup, completeness.complete)
  const own = Object.values(state.groups)
    .filter((group) => group.triggerId === trigger.triggerId)
    .sort((left, right) => compareCodeUnits(left.eventId, right.eventId))
  if (own.length === 0) {
    const listened = evaluable.some((adapter) => matchEventPattern(adapter.eventId, trigger.eventPattern))
    const triggerWarnings = [...warnings]
    if (isWorkflowTriggerExcludedEvent(trigger.eventPattern)) triggerWarnings.push(TRIGGER_BACKTEST_I18N.warnings.excludedEvents)
    else if (!listened) triggerWarnings.push(TRIGGER_BACKTEST_I18N.warnings.noAdapter)
    return [{
      key: triggerBacktestGroupKey(trigger.triggerId, null),
      labelKey: null,
      sampleResourceKind: null,
      cells: TRIGGER_BACKTEST_CELLS.map((cell) => ({ key: cell, count: 0, sampleIds: [] })),
      warnings: triggerWarnings,
      dataWarnings: listened && completeness.complete && !state.truncated ? [TRIGGER_BACKTEST_I18N.warnings.noEvents] : [],
      flags: [],
    }]
  }
  const active = isTriggerActive(trigger, setup)
  return own.map((group): SimulationGroup => {
    const total = TRIGGER_BACKTEST_CELLS.reduce((sum, cell) => sum + group.cells[cell], 0)
    const dataWarnings: string[] = []
    if (active && total > 0 && group.cells.would_start === 0 && group.cells.debounced === 0 && group.cells.cannot_tell === 0) {
      dataWarnings.push(TRIGGER_BACKTEST_I18N.warnings.neverMatches)
    }
    if (group.prototypePath) dataWarnings.push(TRIGGER_BACKTEST_I18N.warnings.prototypePath)
    return {
      key: triggerBacktestGroupKey(group.triggerId, group.eventId),
      labelKey: null,
      sampleResourceKind: simulationEventEntityType(group.eventId),
      cells: TRIGGER_BACKTEST_CELLS.map((cell) => ({ key: cell, count: group.cells[cell], sampleIds: [...group.samples[cell]] })),
      warnings: [...warnings],
      dataWarnings,
      flags: [],
    }
  })
}

export function buildTriggerBacktestResult(
  state: TriggerBacktestState,
  proposal: WorkflowTriggerBacktestProposal,
  adapters: readonly RegisteredSimulationEventAdapter[],
): SimulationKindResult {
  const setup = state.setup ?? { live: false, liveWarnings: [], legacyTriggers: false, shadowsCodeTriggers: false }
  const evaluable = evaluableAdapters(adapters)
  const groups = proposal.triggers.flatMap((trigger) => triggerGroups(trigger, proposal, state, setup, evaluable))
  const unreplayed = new Set<string>()
  let partial = false
  for (const trigger of proposal.triggers) {
    const completeness = triggerEventCompleteness(trigger.eventPattern, evaluable)
    if (!completeness.complete) partial = true
    for (const eventId of completeness.unreplayed) unreplayed.add(eventId)
  }
  const caveats: string[] = [TRIGGER_BACKTEST_I18N.caveats.firstOrder, TRIGGER_BACKTEST_I18N.caveats.queueClock]
  if (proposal.triggers.some((trigger) => isTriggerActive(trigger, setup) && debounceMsOf(trigger) > 0)) caveats.push(TRIGGER_BACKTEST_I18N.caveats.debounceProcess)
  if (state.events > 0) caveats.push(TRIGGER_BACKTEST_I18N.caveats.reconstructed)
  if (partial) caveats.push(TRIGGER_BACKTEST_I18N.caveats.partialEvents)
  if (setup.legacyTriggers) caveats.push(TRIGGER_BACKTEST_I18N.caveats.legacyTriggers)
  if (setup.shadowsCodeTriggers) caveats.push(TRIGGER_BACKTEST_I18N.caveats.shadowsCodeTriggers)
  if (state.truncated) caveats.push(TRIGGER_BACKTEST_I18N.caveats.truncated)
  const coverage: SimulationCoverage = { ...state.coverage, reconstructed_events: state.events }
  if (unreplayed.size > 0) coverage.unreplayed_event_types = unreplayed.size
  return {
    groups,
    coverage,
    caveats,
    fidelity: state.events > 0 ? 'reconstructed' : 'none',
    truncated: state.truncated,
  }
}

type ArtifactLookupContext = Pick<SimulationArtifactContext, 'em' | 'scope'>

async function findDefinition(ctx: ArtifactLookupContext, where: Record<string, unknown>): Promise<WorkflowDefinition | null> {
  return findOneWithDecryption(
    ctx.em,
    WorkflowDefinition,
    { ...where, tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId, deletedAt: null },
    undefined,
    { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId },
  )
}

/**
 * What decides the liveness of the proposal's triggers, read once in the first slice: the edited
 * row (its workflow id and lifecycle; a save never changes either), every other version of the same
 * workflow, legacy trigger rows of those versions, and a code-defined workflow the save would shadow.
 */
async function loadSetup(proposal: WorkflowTriggerBacktestProposal, ctx: SimulationRunContext<TriggerBacktestState>): Promise<TriggerBacktestSetup> {
  const scope = { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId }
  const artifact = ctx.artifactId && isUuid(ctx.artifactId) ? await findDefinition(ctx, { id: ctx.artifactId }) : null
  const workflowId = artifact?.workflowId ?? proposal.workflowId
  const rows = await findWithDecryption(
    ctx.em,
    WorkflowDefinition,
    { workflowId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { fields: ['id', 'workflowId', 'version', 'enabled', 'lifecycle'] },
    scope,
  )
  const others: DefinitionVersionRow[] = rows
    .filter((row) => row.id !== artifact?.id)
    .map((row) => ({ id: row.id, version: row.version, enabled: row.enabled, lifecycle: row.lifecycle }))
  const liveness = resolveProposalLiveness(proposal, artifact?.lifecycle ?? 'published', others)
  const versionIds = Array.from(new Set([...rows.map((row) => row.id), ...(artifact ? [artifact.id] : [])]))
  const legacyTriggers = versionIds.length > 0
    ? await ctx.em.count(WorkflowEventTrigger, { workflowDefinitionId: { $in: versionIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, enabled: true, deletedAt: null })
    : 0
  const codeWorkflow = rows.length === 0 && !artifact ? getCodeWorkflow(workflowId) : undefined
  const shadowsCodeTriggers = Boolean(codeWorkflow?.enabled && (codeWorkflow.definition?.triggers ?? []).some((trigger) => trigger.enabled))
  return { live: liveness.live, liveWarnings: liveness.warnings, legacyTriggers: legacyTriggers > 0, shadowsCodeTriggers }
}

function windowProgress(window: { from: Date; to: Date }, position: string | null | undefined): number {
  if (!position) return 0
  const from = window.from.getTime()
  const to = window.to.getTime()
  const at = Date.parse(position)
  if (!(to > from) || Number.isNaN(at)) return 0
  return Math.min(1, Math.max(0, (at - from) / (to - from)))
}

function matchesAdapter(adapter: RegisteredSimulationEventAdapter, entry: SimulationAuditEntry): boolean {
  if (!entry.resourceKind || !adapter.logResourceKinds.includes(entry.resourceKind)) return false
  if (!entry.actionType || !adapter.actionTypes.includes(entry.actionType)) return false
  if (adapter.commandIds && (!entry.commandId || !adapter.commandIds.includes(entry.commandId))) return false
  return true
}

type ReplayPlan = {
  adapters: RegisteredSimulationEventAdapter[]
  triggersByEvent: Map<string, ProposalTrigger[]>
  windowsComplete: Map<string, boolean>
  blockingPreConditions: boolean
  setup: TriggerBacktestSetup
}

type ReplayCounters = {
  processed: number
  recordsRemaining: number
  adapterErrorReported: boolean
}

function buildReplayPlan(proposal: WorkflowTriggerBacktestProposal, ctx: SimulationRunContext<TriggerBacktestState>, setup: TriggerBacktestSetup): ReplayPlan {
  const adapters = matchedTriggerAdapters(proposal.triggers, ctx.eventAdapters)
  const triggersByEvent = new Map<string, ProposalTrigger[]>()
  for (const adapter of adapters) {
    triggersByEvent.set(adapter.eventId, proposal.triggers.filter((trigger) => triggerMatchesEvent(trigger, adapter.eventId)))
  }
  const windowsComplete = new Map<string, boolean>()
  for (const trigger of proposal.triggers) {
    windowsComplete.set(trigger.triggerId, triggerEventCompleteness(trigger.eventPattern, ctx.eventAdapters).complete)
  }
  return { adapters, triggersByEvent, windowsComplete, blockingPreConditions: hasBlockingStartPreConditions(proposal.startPreConditions), setup }
}

/**
 * Replays one audit entry: every adapter that rebuilds an event from it is evaluated against every
 * proposed trigger whose pattern selects that event. Answers false when the record budget ran out.
 */
function replayEntry(
  entry: SimulationAuditEntry,
  plan: ReplayPlan,
  state: TriggerBacktestState,
  counters: ReplayCounters,
  ctx: SimulationRunContext<TriggerBacktestState>,
): boolean {
  bump(state, 'reconstructed_entries')
  const at = Date.parse(entry.at)
  let matched = false
  for (const adapter of plan.adapters) {
    if (!matchesAdapter(adapter, entry)) continue
    let rebuilt
    try {
      rebuilt = adapter.payloadFrom(entry, { scope: ctx.scope })
    } catch (error) {
      bump(state, 'adapter_errors')
      if (!counters.adapterErrorReported) {
        counters.adapterErrorReported = true
        logger.warn('[internal] A simulation event adapter could not rebuild an event; it is counted in coverage', { eventId: adapter.eventId, moduleId: adapter.moduleId, err: error })
        getTelemetryRuntime()?.reportError(error, { module: 'workflows', code: 'workflows.simulation_adapter_failed', attributes: { eventId: adapter.eventId } })
      }
      continue
    }
    if (!rebuilt || Number.isNaN(at)) continue
    matched = true
    if (counters.recordsRemaining <= 0) return false
    const unknownPaths = [...(rebuilt.unknownPaths ?? [])]
    const sampleId = triggerSampleRecordId(rebuilt.payload, unknownPaths)
    for (const trigger of plan.triggersByEvent.get(adapter.eventId) ?? []) {
      const outcome = evaluateTriggerEvent({
        trigger,
        active: isTriggerActive(trigger, plan.setup),
        startCertain: !hasMaxConcurrentInstances(trigger) && !plan.blockingPreConditions,
        windowsComplete: plan.windowsComplete.get(trigger.triggerId) === true,
        payload: rebuilt.payload,
        unknownPaths,
        at,
      }, state.debounce)
      recordOutcome(state, trigger.triggerId, adapter.eventId, outcome.cell, outcome.prototypePath, sampleId)
    }
    state.events += 1
    counters.processed += 1
    counters.recordsRemaining -= 1
  }
  if (!matched) bump(state, 'reconstructed_entries_without_event')
  return true
}

/**
 * One slice of a trigger backtest (S7). The first slice reads which version's triggers would be
 * live after the save and seeds the debounce windows that may predate the run window; then audit
 * entries of the run window are turned into event payloads by the emitting modules' adapters
 * (events with an excluded prefix never reach triggers) and every proposed trigger whose pattern
 * selects the event is evaluated in time order, keeping the debounce windows in the continuation
 * state. Nothing is executed: no instance is started, no event emitted.
 */
export async function runTriggerBacktestSlice(
  proposal: WorkflowTriggerBacktestProposal,
  ctx: SimulationRunContext<TriggerBacktestState>,
): Promise<SimulationSliceResult<TriggerBacktestState>> {
  const state: TriggerBacktestState = ctx.state ?? initialTriggerBacktestState()
  if (!state.setup) {
    state.setup = await loadSetup(proposal, ctx)
    seedTriggerDebounceState(state.debounce, proposal.triggers, ctx.window.from.getTime())
  }
  const plan = buildReplayPlan(proposal, ctx, state.setup)
  const counters: ReplayCounters = { processed: 0, recordsRemaining: Math.max(0, Math.floor(ctx.budget.recordsRemaining)), adapterErrorReported: false }
  const finish = (truncated: boolean): SimulationSliceResult<TriggerBacktestState> => {
    if (truncated) state.truncated = true
    state.phase = 'done'
    return { status: 'done', result: buildTriggerBacktestResult(state, proposal, ctx.eventAdapters), recordsProcessed: counters.processed }
  }
  const resourceKinds = Array.from(new Set(plan.adapters.flatMap((adapter) => adapter.logResourceKinds)))
  if (plan.adapters.length === 0 || resourceKinds.length === 0) return finish(false)
  while (state.phase === 'scan') {
    if (ctx.now() >= ctx.budget.runDeadlineAt || counters.recordsRemaining <= 0) return finish(true)
    if (ctx.now() >= ctx.budget.sliceDeadlineAt) {
      return { status: 'continue', state, recordsProcessed: counters.processed, progress: windowProgress(ctx.window, state.auditCursor?.createdAt) }
    }
    const page = await ctx.scanAuditLog({ resourceKinds, after: state.auditCursor, limit: Math.max(1, Math.min(ctx.budget.maxBatchRows, counters.recordsRemaining)) })
    bump(state, 'undecryptable_entries', page.undecryptable)
    let latestAt: number | null = null
    for (const entry of page.entries) {
      if (ctx.now() >= ctx.budget.runDeadlineAt) return finish(true)
      if (!replayEntry(entry, plan, state, counters, ctx)) return finish(true)
      const at = Date.parse(entry.at)
      if (!Number.isNaN(at)) latestAt = at
    }
    if (latestAt !== null) pruneTriggerDebounceState(state.debounce, latestAt)
    state.auditCursor = page.lastCursor ?? state.auditCursor
    if (page.exhausted) state.phase = 'done'
  }
  return finish(false)
}

function canonicalJson(value: unknown): string | undefined {
  if (value === null) return 'null'
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item) ?? 'null').join(',')}]`
  if (typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const entries: string[] = []
  for (const key of Object.keys(record).sort(compareCodeUnits)) {
    const serialized = canonicalJson(record[key])
    if (serialized !== undefined) entries.push(`${JSON.stringify(key)}:${serialized}`)
  }
  return `{${entries.join(',')}}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeFingerprintTrigger(raw: unknown): unknown {
  const parsed = workflowDefinitionTriggerSchema.safeParse(raw)
  if (!parsed.success) return isRecord(raw) ? { invalid: raw } : null
  const trigger = parsed.data
  const debounceMs = trigger.config?.debounceMs
  const maxConcurrentInstances = trigger.config?.maxConcurrentInstances
  return {
    triggerId: trigger.triggerId,
    eventPattern: trigger.eventPattern,
    enabled: trigger.enabled !== false,
    filterConditions: (trigger.config?.filterConditions ?? []).map((condition) => ({ field: condition.field, operator: condition.operator, value: condition.value })),
    debounceMs: typeof debounceMs === 'number' && debounceMs > 0 ? debounceMs : null,
    maxConcurrentInstances: maxConcurrentInstances ? maxConcurrentInstances : null,
  }
}

function normalizeFingerprintPreCondition(raw: unknown): unknown {
  const parsed = startPreConditionSchema.safeParse(raw)
  if (!parsed.success) return isRecord(raw) ? { invalid: raw } : null
  return { ruleId: parsed.data.ruleId, required: parsed.data.required !== false }
}

export type TriggerFingerprintSource = {
  version: number
  enabled: boolean
  triggers: unknown
  startPreConditions: unknown
}

/**
 * The fingerprint of what a trigger backtest simulates (S15): the version and enabled flag (which
 * version's triggers are live), each trigger's id, pattern, enabled flag, filter conditions,
 * debounce and concurrency limit, and the START step's pre-conditions (rule id + required). Names,
 * descriptions, priorities and context mappings decide nothing about a start and are left out.
 */
export function fingerprintTriggerSource(source: TriggerFingerprintSource): string {
  const triggers = Array.isArray(source.triggers) ? source.triggers : []
  const preConditions = Array.isArray(source.startPreConditions) ? source.startPreConditions : []
  const canonical = canonicalJson({
    fingerprintVersion: TRIGGER_BACKTEST_FINGERPRINT_VERSION,
    version: source.version,
    enabled: source.enabled !== false,
    triggers: triggers.map(normalizeFingerprintTrigger),
    startPreConditions: preConditions.map(normalizeFingerprintPreCondition),
  }) ?? 'null'
  return createHash('sha256').update(canonical).digest('hex')
}

export function fingerprintTriggerProposal(proposal: WorkflowTriggerBacktestProposal): string {
  return fingerprintTriggerSource({
    version: proposal.version,
    enabled: proposal.enabled,
    triggers: proposal.triggers,
    startPreConditions: proposal.startPreConditions,
  })
}

function startStepPreConditions(definition: unknown): unknown {
  if (!isRecord(definition) || !Array.isArray(definition.steps)) return []
  const start = definition.steps.find((step) => isRecord(step) && step.stepType === 'START')
  return isRecord(start) && Array.isArray(start.preConditions) ? start.preConditions : []
}

export function fingerprintWorkflowDefinition(row: Pick<WorkflowDefinition, 'version' | 'enabled' | 'definition'>): string {
  const definition: unknown = row.definition
  return fingerprintTriggerSource({
    version: row.version,
    enabled: row.enabled,
    triggers: isRecord(definition) && Array.isArray(definition.triggers) ? definition.triggers : [],
    startPreConditions: startStepPreConditions(definition),
  })
}

function toArtifactVersion(row: WorkflowDefinition): SimulationArtifactVersion {
  return {
    artifactId: row.id,
    updatedAt: row.updatedAt instanceof Date && !Number.isNaN(row.updatedAt.getTime()) ? row.updatedAt.toISOString() : null,
    fingerprint: fingerprintWorkflowDefinition(row),
  }
}

/**
 * Artifact ids the backtest refuses before reading anything (S7): a code-registry definition
 * (`code:<workflowId>`, or the deterministic id of a code workflow no database row carries) has to
 * be customized first; a `code:` id of an unknown workflow does not exist.
 */
export function classifyCodeArtifactId(artifactId: string | null | undefined): 'not_customized' | 'artifact_not_found' | null {
  if (!artifactId) return null
  if (artifactId.startsWith(CODE_ARTIFACT_PREFIX)) {
    return getCodeWorkflow(artifactId.slice(CODE_ARTIFACT_PREFIX.length)) ? 'not_customized' : 'artifact_not_found'
  }
  if (!isUuid(artifactId)) return null
  const normalized = artifactId.toLowerCase()
  return getAllCodeWorkflows().some((workflow) => codeWorkflowUuid(workflow.workflowId) === normalized) ? 'not_customized' : null
}

async function validateTriggerProposal(
  input: WorkflowTriggerBacktestProposal,
  ctx: { em: SimulationArtifactContext['em']; scope: SimulationArtifactContext['scope']; eventAdapters: readonly RegisteredSimulationEventAdapter[]; artifactId?: string | null },
): Promise<SimulationValidationResult> {
  const codeArtifact = classifyCodeArtifactId(ctx.artifactId)
  if (codeArtifact) return { ok: false, code: codeArtifact }
  if (ctx.artifactId && isUuid(ctx.artifactId) && input.triggers.length > 0) {
    const artifact = await findDefinition(ctx, { id: ctx.artifactId })
    if (artifact?.kind === 'component') return { ok: false, code: 'invalid_proposal' }
  }
  return matchedTriggerAdapters(input.triggers, ctx.eventAdapters).length > 0
    ? { ok: true }
    : { ok: false, code: 'unsupported_event_payload' }
}

/**
 * `workflows.trigger_backtest` (spec S7): the proposal is the trigger-relevant part of a workflow
 * definition the editor would save (`workflowTriggerBacktestProposalSchema`). Sources: the workflow
 * definitions (`workflows.definitions.view`) and the events of the record types its triggers listen
 * to, whose view features the emitting modules' adapters declare (`inputFeatures`); past record
 * values rebuilt from audit history need `audit_logs.view_tenant` (insights turns them into unknown
 * paths otherwise), and sample ids are confirmed through the owning module's explain resource.
 */
export const triggerBacktestKind = defineSimulationKind<WorkflowTriggerBacktestProposal, TriggerBacktestState>({
  kind: TRIGGER_BACKTEST_KIND,
  artifactKind: TRIGGER_BACKTEST_ARTIFACT_KIND,
  labelKey: TRIGGER_BACKTEST_I18N.label,
  requiredFeatures: [...TRIGGER_BACKTEST_FEATURES],
  inputSchema: workflowTriggerBacktestProposalSchema,
  version: TRIGGER_BACKTEST_VERSION,
  cellKeys: [...TRIGGER_BACKTEST_CELLS],
  async readArtifactVersion(ctx, ref) {
    if (ref.artifactId) {
      if (!isUuid(ref.artifactId)) return null
      const row = await findDefinition(ctx, { id: ref.artifactId })
      return row ? toArtifactVersion(row) : null
    }
    const row = await findDefinition(ctx, { workflowId: ref.input.workflowId, version: ref.input.version })
    return row ? toArtifactVersion(row) : null
  },
  fingerprintProposal: fingerprintTriggerProposal,
  inputFeatures(input, ctx) {
    return Array.from(new Set(matchedTriggerAdapters(input.triggers, ctx.eventAdapters).flatMap((adapter) => adapter.requiredFeatures)))
  },
  validate: validateTriggerProposal,
  run: runTriggerBacktestSlice,
  applyHref({ artifactId, runId }) {
    if (!artifactId) return null
    return `/backend/definitions/visual-editor?id=${encodeURIComponent(artifactId)}&simulationRunId=${encodeURIComponent(runId)}`
  },
})
