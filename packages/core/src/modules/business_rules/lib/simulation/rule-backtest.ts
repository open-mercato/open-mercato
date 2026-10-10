import { createHash } from 'node:crypto'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isUuid } from '@open-mercato/shared/lib/causation/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import {
  defineSimulationKind,
  simulationEventEntityType,
  simulationEventType,
  type RegisteredSimulationEventAdapter,
  type SimulationArtifactVersion,
  type SimulationAuditCursor,
  type SimulationAuditEntry,
  type SimulationCoverage,
  type SimulationFidelity,
  type SimulationGroup,
  type SimulationKindResult,
  type SimulationRunContext,
  type SimulationSliceResult,
} from '@open-mercato/shared/modules/insights/simulate'
import { BusinessRule } from '../../data/entities'
import { businessRuleDefinitionSchema, type BusinessRuleDefinitionInput } from '../../data/validators'
import { computeRuleDefinitionHash } from '../definition-hash'
import { MAX_RULES_PER_EXECUTION } from '../rule-engine'
import { isRuleEffective } from '../rule-evaluator'
import {
  findObservedCoverage,
  isCrudTriggerRow,
  readObservedRuleLogs,
  type ObservedRuleLogCursor,
  type ObservedRuleLogDatabase,
} from './observed'
import { evaluateConditionsTri } from './tri-state-evaluator'

const logger = createLogger('business_rules').child({ component: 'rule-backtest' })

export const RULE_BACKTEST_KIND = 'business_rules.rule_backtest'

export const RULE_BACKTEST_ARTIFACT_KIND = 'business_rules.rule'

/** Bump when the backtest semantics change: it is part of every run's inputs hash. */
export const RULE_BACKTEST_VERSION = 1

export const RULE_BACKTEST_CELLS = ['fires', 'does_not_fire', 'runs_failure_actions', 'cannot_tell'] as const

export type RuleBacktestCell = (typeof RULE_BACKTEST_CELLS)[number]

export const RULE_BACKTEST_FEATURES = ['business_rules.view', 'business_rules.view_logs']

/**
 * Sliding dedupe window of observed rows: a row repeating the key of a row executed at most this long
 * before it is a duplicate delivery; a repeat after a longer gap counts again. Rows arrive ordered by
 * `executed_at`, so the result never depends on page boundaries.
 */
export const OBSERVED_DEDUPE_WINDOW_MS = 10 * 60 * 1000

const SAMPLE_CANDIDATES = 10

const PAYLOAD_ENTITY_ID_KEYS = ['id', 'entityId', 'recordId'] as const

const MAX_ENTITY_ID_LENGTH = 255

const ENTITY_ID_CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

export const RULE_BACKTEST_I18N = {
  label: 'business_rules.simulation.kind.ruleBacktest',
  caveats: {
    firstOrder: 'business_rules.simulation.caveats.firstOrder',
    currentRules: 'business_rules.simulation.caveats.currentRules',
    queueClock: 'business_rules.simulation.caveats.queueClock',
    observedSanitized: 'business_rules.simulation.caveats.observedSanitized',
    reconstructed: 'business_rules.simulation.caveats.reconstructed',
    truncated: 'business_rules.simulation.caveats.truncated',
  },
  warnings: {
    nullEventType: 'business_rules.simulation.warnings.nullEventType',
    eventTypeMismatch: 'business_rules.simulation.warnings.eventTypeMismatch',
    disabled: 'business_rules.simulation.warnings.disabled',
    notEffective: 'business_rules.simulation.warnings.notEffective',
    neverFires: 'business_rules.simulation.warnings.neverFires',
    failureActionsEveryEvent: 'business_rules.simulation.warnings.failureActionsEveryEvent',
    ruleLimitExceeded: 'business_rules.simulation.warnings.ruleLimitExceeded',
  },
} as const

export const RULE_LIMIT_EXCEEDED_FLAG = 'rule_limit_exceeded'

type GroupState = {
  cells: Record<RuleBacktestCell, number>
  samples: Record<RuleBacktestCell, string[]>
  discovered: number
  ruleLimitExceeded: number
}

export type RuleBacktestState = {
  phase: 'observed' | 'reconstructed' | 'done'
  observedCursor: ObservedRuleLogCursor | null
  auditCursor: SimulationAuditCursor | null
  recentKeys: Array<[string, string]>
  groups: Record<string, GroupState>
  coverage: Record<string, number>
  observedEvents: number
  reconstructedEvents: number
  truncated: boolean
}

type BacktestEvent = {
  eventId: string
  eventType: string
  entityId: string | null
  sampleId: string | null
  at: Date
  payload: unknown
  unknownPaths: string[]
}

type CurrentRule = Pick<BusinessRule, 'id' | 'eventType' | 'effectiveFrom' | 'effectiveTo'>

function emptyCells(): Record<RuleBacktestCell, number> {
  return { fires: 0, does_not_fire: 0, runs_failure_actions: 0, cannot_tell: 0 }
}

function emptySamples(): Record<RuleBacktestCell, string[]> {
  return { fires: [], does_not_fire: [], runs_failure_actions: [], cannot_tell: [] }
}

export function initialRuleBacktestState(): RuleBacktestState {
  return {
    phase: 'observed',
    observedCursor: null,
    auditCursor: null,
    recentKeys: [],
    groups: {},
    coverage: {},
    observedEvents: 0,
    reconstructedEvents: 0,
    truncated: false,
  }
}

function bump(state: RuleBacktestState, key: string, by = 1): void {
  state.coverage[key] = (state.coverage[key] ?? 0) + by
}

function normalizeEntityIdCandidate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > MAX_ENTITY_ID_LENGTH) return null
  if (ENTITY_ID_CONTROL_CHARACTER_PATTERN.test(trimmed)) return null
  return trimmed
}

/**
 * The record id used for sample confirmation: a payload's `entityId` when present (customers
 * person/company payloads carry the profile id in `id` and the record id in `entityId`), else the
 * resolved entity id.
 */
export function resolveSampleRecordId(payload: unknown, entityId: string | null): string | null {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const candidate = normalizeEntityIdCandidate((payload as Record<string, unknown>).entityId)
    if (candidate) return candidate
  }
  return entityId
}

/** The entity id the CRUD rule trigger would resolve from a payload (`id`, `entityId`, `recordId`). */
export function resolvePayloadEntityId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  for (const key of PAYLOAD_ENTITY_ID_KEYS) {
    const candidate = normalizeEntityIdCandidate((payload as Record<string, unknown>)[key])
    if (candidate) return candidate
  }
  return null
}

function hasActions(actions: unknown): boolean {
  return Array.isArray(actions) && actions.length > 0
}

/**
 * Production discovery for one event (S5): the proposal participates when it is enabled, its
 * entity type equals the event's, its event type EQUALS the event's (a null event type never
 * matches a CRUD event) and it is effective at the event's time.
 */
export function isProposalDiscovered(proposal: BusinessRuleDefinitionInput, entityType: string, eventType: string, at: Date): boolean {
  if (proposal.enabled === false) return false
  if (proposal.entityType !== entityType) return false
  if (!proposal.eventType || proposal.eventType !== eventType) return false
  return isRuleEffective({ effectiveFrom: proposal.effectiveFrom ?? null, effectiveTo: proposal.effectiveTo ?? null }, at)
}

/**
 * The outcome of one event for the proposal, mirroring `executeRules` → `executeSingleRule`: more
 * than `MAX_RULES_PER_EXECUTION` discovered rules stop every rule of the event; conditions that
 * pass run the success actions (`fires`); conditions that fail run the failure actions when there
 * are any; an evaluation error, an unknown input or a regex refused by the guard is `cannot_tell`.
 */
export function evaluateBacktestEvent(
  proposal: BusinessRuleDefinitionInput,
  entityType: string,
  event: BacktestEvent,
  otherRules: readonly CurrentRule[],
): { cell: RuleBacktestCell; discovered: boolean; ruleLimitExceeded: boolean } {
  if (!isProposalDiscovered(proposal, entityType, event.eventType, event.at)) {
    return { cell: 'does_not_fire', discovered: false, ruleLimitExceeded: false }
  }
  let discoveredRules = 1
  for (const rule of otherRules) {
    if (rule.eventType === event.eventType && isRuleEffective(rule, event.at)) discoveredRules += 1
  }
  if (discoveredRules > MAX_RULES_PER_EXECUTION) return { cell: 'does_not_fire', discovered: true, ruleLimitExceeded: true }
  const outcome = evaluateConditionsTri(
    proposal.conditionExpression,
    event.payload,
    {
      entityType,
      entityId: event.entityId ?? undefined,
      eventType: event.eventType,
      evaluatedAt: event.at,
    },
    { unknownPaths: event.unknownPaths },
  )
  if (outcome.outcome === 'true') return { cell: 'fires', discovered: true, ruleLimitExceeded: false }
  if (outcome.outcome === 'false') {
    return { cell: hasActions(proposal.failureActions) ? 'runs_failure_actions' : 'does_not_fire', discovered: true, ruleLimitExceeded: false }
  }
  return { cell: 'cannot_tell', discovered: true, ruleLimitExceeded: false }
}

function recordEvent(
  state: RuleBacktestState,
  proposal: BusinessRuleDefinitionInput,
  entityType: string,
  event: BacktestEvent,
  otherRules: readonly CurrentRule[],
): void {
  const result = evaluateBacktestEvent(proposal, entityType, event, otherRules)
  const group = state.groups[event.eventId] ?? (state.groups[event.eventId] = { cells: emptyCells(), samples: emptySamples(), discovered: 0, ruleLimitExceeded: 0 })
  group.cells[result.cell] += 1
  if (result.discovered) group.discovered += 1
  if (result.ruleLimitExceeded) group.ruleLimitExceeded += 1
  const samples = group.samples[result.cell]
  if (event.sampleId && samples.length < SAMPLE_CANDIDATES && !samples.includes(event.sampleId)) samples.push(event.sampleId)
}

function dedupeKey(entityType: string, eventType: string, entityId: string, correlationId: string | null, causedByLogId: string | null, dataHash: string): string {
  return createHash('sha256')
    .update([entityType, eventType, entityId, correlationId ?? '', causedByLogId ?? '', dataHash].join('\u0000'))
    .digest('hex')
}

function pruneRecentKeys(state: RuleBacktestState, latestAt: string | null): void {
  if (!latestAt) return
  const cutoff = Date.parse(latestAt) - OBSERVED_DEDUPE_WINDOW_MS
  state.recentKeys = state.recentKeys.filter(([, at]) => Date.parse(at) >= cutoff)
}

function windowProgress(window: { from: Date; to: Date }, position: string | null | undefined): number {
  if (!position) return 0
  const from = window.from.getTime()
  const to = window.to.getTime()
  const at = Date.parse(position)
  if (!(to > from) || Number.isNaN(at)) return 0
  return Math.min(1, Math.max(0, (at - from) / (to - from)))
}

function adaptersOf(adapters: readonly RegisteredSimulationEventAdapter[], entityType: string): RegisteredSimulationEventAdapter[] {
  return adapters.filter((adapter) => simulationEventEntityType(adapter.eventId) === entityType)
}

function matchesAdapter(adapter: RegisteredSimulationEventAdapter, entry: SimulationAuditEntry): boolean {
  if (!entry.resourceKind || !adapter.logResourceKinds.includes(entry.resourceKind)) return false
  if (!entry.actionType || !adapter.actionTypes.includes(entry.actionType)) return false
  if (adapter.commandIds && (!entry.commandId || !adapter.commandIds.includes(entry.commandId))) return false
  return true
}

function coverageKey(eventType: string | null, entityId: string): string {
  return `${eventType ?? ''}\u0000${entityId}`
}

function structuralWarnings(proposal: BusinessRuleDefinitionInput, eventType: string, window: { from: Date; to: Date }): string[] {
  const warnings: string[] = []
  if (!proposal.eventType) warnings.push(RULE_BACKTEST_I18N.warnings.nullEventType)
  else if (proposal.eventType !== eventType) warnings.push(RULE_BACKTEST_I18N.warnings.eventTypeMismatch)
  if (proposal.enabled === false) warnings.push(RULE_BACKTEST_I18N.warnings.disabled)
  const effectiveFrom = proposal.effectiveFrom ?? null
  const effectiveTo = proposal.effectiveTo ?? null
  if ((effectiveFrom && effectiveFrom > window.to) || (effectiveTo && effectiveTo < window.from)) {
    warnings.push(RULE_BACKTEST_I18N.warnings.notEffective)
  }
  return warnings
}

export function buildRuleBacktestResult(
  state: RuleBacktestState,
  proposal: BusinessRuleDefinitionInput,
  window: { from: Date; to: Date },
): SimulationKindResult {
  const groups: SimulationGroup[] = Object.keys(state.groups)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((eventId) => {
      const group = state.groups[eventId]
      const total = RULE_BACKTEST_CELLS.reduce((sum, cell) => sum + group.cells[cell], 0)
      const dataWarnings: string[] = []
      if (group.discovered > 0 && group.cells.fires === 0) dataWarnings.push(RULE_BACKTEST_I18N.warnings.neverFires)
      if (group.discovered > 0 && total > 0 && group.cells.runs_failure_actions === total) dataWarnings.push(RULE_BACKTEST_I18N.warnings.failureActionsEveryEvent)
      const warnings = structuralWarnings(proposal, simulationEventType(eventId), window)
      const flags: string[] = []
      if (group.ruleLimitExceeded > 0) {
        flags.push(RULE_LIMIT_EXCEEDED_FLAG)
        warnings.push(RULE_BACKTEST_I18N.warnings.ruleLimitExceeded)
      }
      return {
        key: eventId,
        labelKey: null,
        sampleResourceKind: simulationEventEntityType(eventId),
        cells: RULE_BACKTEST_CELLS.map((cell) => ({ key: cell, count: group.cells[cell], sampleIds: [...group.samples[cell]] })),
        warnings,
        dataWarnings,
        flags,
      }
    })
  const fidelity: SimulationFidelity = state.observedEvents > 0 && state.reconstructedEvents > 0
    ? 'mixed'
    : state.observedEvents > 0
      ? 'observed'
      : state.reconstructedEvents > 0
        ? 'reconstructed'
        : 'none'
  const caveats: string[] = [RULE_BACKTEST_I18N.caveats.firstOrder, RULE_BACKTEST_I18N.caveats.currentRules, RULE_BACKTEST_I18N.caveats.queueClock]
  if (state.observedEvents > 0) caveats.push(RULE_BACKTEST_I18N.caveats.observedSanitized)
  if (state.reconstructedEvents > 0) caveats.push(RULE_BACKTEST_I18N.caveats.reconstructed)
  if (state.truncated) caveats.push(RULE_BACKTEST_I18N.caveats.truncated)
  const coverage: SimulationCoverage = {
    ...state.coverage,
    observed_events: state.observedEvents,
    reconstructed_events: state.reconstructedEvents,
  }
  return { groups, coverage, caveats, fidelity, truncated: state.truncated }
}

async function loadOtherRules(ctx: SimulationRunContext<RuleBacktestState>, entityType: string): Promise<CurrentRule[]> {
  const rules = await findWithDecryption(
    ctx.em,
    BusinessRule,
    { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId, entityType, enabled: true, deletedAt: null },
    { fields: ['id', 'eventType', 'effectiveFrom', 'effectiveTo'] },
    { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId },
  )
  return rules.filter((rule) => rule.id !== ctx.artifactId)
}

type SliceClock = {
  sliceOver: () => boolean
  runOver: () => boolean
}

function createSliceClock(ctx: SimulationRunContext<RuleBacktestState>): SliceClock {
  return {
    sliceOver: () => ctx.now() >= ctx.budget.sliceDeadlineAt,
    runOver: () => ctx.now() >= ctx.budget.runDeadlineAt,
  }
}

/**
 * One slice of a rule backtest. Tier 1 (observed): `rule_execution_logs` rows written by the CRUD
 * rule trigger (innermost causation frame), deduplicated per event, evaluated against the payload
 * production saw at `executed_at`. Tier 2 (reconstructed): audit entries turned into event payloads
 * by the emitting modules' adapters, skipping events the observed tier already covered, evaluated
 * at `created_at`. Every event is evaluated with the tri-state evaluator inside the current rule set
 * (discovery, limit, failure actions). Deadlines and the record budget are checked inside the loops.
 */
export async function runRuleBacktestSlice(
  proposal: BusinessRuleDefinitionInput,
  ctx: SimulationRunContext<RuleBacktestState>,
): Promise<SimulationSliceResult<RuleBacktestState>> {
  const state: RuleBacktestState = ctx.state ?? initialRuleBacktestState()
  const entityType = proposal.entityType
  const clock = createSliceClock(ctx)
  const db = ctx.em.getKysely<ObservedRuleLogDatabase>()
  const otherRules = await loadOtherRules(ctx, entityType)
  let recordsRemaining = Math.max(0, Math.floor(ctx.budget.recordsRemaining))
  let processed = 0
  const finish = (): SimulationSliceResult<RuleBacktestState> => {
    state.phase = 'done'
    return { status: 'done', result: buildRuleBacktestResult(state, proposal, ctx.window), recordsProcessed: processed }
  }
  const exhaust = (): SimulationSliceResult<RuleBacktestState> => {
    state.truncated = true
    return finish()
  }

  while (state.phase === 'observed') {
    if (clock.runOver() || recordsRemaining <= 0) return exhaust()
    if (clock.sliceOver()) return { status: 'continue', state, recordsProcessed: processed, progress: windowProgress(ctx.window, state.observedCursor?.executedAt) * 0.5 }
    const page = await readObservedRuleLogs(db, {
      tenantId: ctx.scope.tenantId,
      organizationId: ctx.scope.organizationId,
      entityType,
      from: ctx.window.from,
      to: ctx.window.to,
      after: state.observedCursor,
      limit: Math.max(1, Math.min(ctx.budget.maxBatchRows, recordsRemaining)),
      maxBytes: ctx.budget.maxBatchBytes,
    })
    const recent = new Map<string, string>(state.recentKeys)
    for (const row of page.rows) {
      if (clock.runOver()) return exhaust()
      bump(state, 'observed_rows')
      if (!isCrudTriggerRow(row)) {
        bump(state, 'observed_excluded_rows')
        continue
      }
      if (!row.eventType) {
        bump(state, 'observed_rows_without_event_type')
        continue
      }
      const key = dedupeKey(row.entityType, row.eventType, row.entityId, row.correlationId, row.causedByLogId, row.dataHash)
      const previousAt = recent.get(key)
      recent.set(key, row.executedAt)
      if (previousAt !== undefined && Date.parse(row.executedAt) - Date.parse(previousAt) <= OBSERVED_DEDUPE_WINDOW_MS) {
        bump(state, 'observed_duplicate_rows')
        continue
      }
      const observedEntityId = row.entityId === 'unknown' ? null : row.entityId
      recordEvent(state, proposal, entityType, {
        eventId: `${entityType}.${row.eventType}`,
        eventType: row.eventType,
        entityId: observedEntityId,
        sampleId: resolveSampleRecordId(row.data, observedEntityId),
        at: new Date(row.executedAt),
        payload: row.data,
        unknownPaths: [],
      }, otherRules)
      state.observedEvents += 1
      processed += 1
      recordsRemaining -= 1
    }
    state.observedCursor = page.lastCursor ?? state.observedCursor
    state.recentKeys = Array.from(recent)
    pruneRecentKeys(state, state.observedCursor?.executedAt ?? null)
    if (page.exhausted) {
      state.phase = 'reconstructed'
      state.recentKeys = []
    }
  }

  const adapters = adaptersOf(ctx.eventAdapters, entityType)
  const resourceKinds = Array.from(new Set(adapters.flatMap((adapter) => adapter.logResourceKinds)))
  if (adapters.length === 0 || resourceKinds.length === 0) return finish()
  let adapterErrorReported = false
  while (state.phase === 'reconstructed') {
    if (clock.runOver() || recordsRemaining <= 0) return exhaust()
    if (clock.sliceOver()) return { status: 'continue', state, recordsProcessed: processed, progress: 0.5 + windowProgress(ctx.window, state.auditCursor?.createdAt) * 0.5 }
    const page = await ctx.scanAuditLog({ resourceKinds, after: state.auditCursor, limit: Math.max(1, Math.min(ctx.budget.maxBatchRows, recordsRemaining)) })
    bump(state, 'undecryptable_entries', page.undecryptable)
    const events: Array<BacktestEvent & { logId: string; correlationId: string | null }> = []
    for (const entry of page.entries) {
      bump(state, 'reconstructed_entries')
      let matched = false
      for (const adapter of adapters) {
        if (!matchesAdapter(adapter, entry)) continue
        let rebuilt
        try {
          rebuilt = adapter.payloadFrom(entry, { scope: ctx.scope })
        } catch (error) {
          bump(state, 'adapter_errors')
          if (!adapterErrorReported) {
            adapterErrorReported = true
            logger.warn('[internal] A simulation event adapter could not rebuild an event; it is counted in coverage', { eventId: adapter.eventId, moduleId: adapter.moduleId, err: error })
            getTelemetryRuntime()?.reportError(error, { module: 'business_rules', code: 'business_rules.simulation_adapter_failed', attributes: { eventId: adapter.eventId } })
          }
          continue
        }
        if (!rebuilt) continue
        matched = true
        const entityId = resolvePayloadEntityId(rebuilt.payload)
        events.push({
          eventId: adapter.eventId,
          eventType: simulationEventType(adapter.eventId),
          entityId,
          sampleId: resolveSampleRecordId(rebuilt.payload, entityId),
          at: new Date(entry.at),
          payload: rebuilt.payload,
          unknownPaths: [...(rebuilt.unknownPaths ?? [])],
          logId: entry.logId,
          correlationId: entry.correlationId,
        })
      }
      if (!matched) bump(state, 'reconstructed_entries_without_event')
    }
    const entityIds = Array.from(new Set(events.map((event) => event.entityId).filter((id): id is string => typeof id === 'string')))
    const covered = new Map<string, Array<{ correlationId: string | null; causedByLogId: string | null }>>()
    if (entityIds.length > 0) {
      const rows = await findObservedCoverage(db, {
        tenantId: ctx.scope.tenantId,
        organizationId: ctx.scope.organizationId,
        entityType,
        entityIds,
        from: ctx.window.from,
        to: ctx.window.to,
      })
      for (const row of rows) {
        if (!isCrudTriggerRow(row)) continue
        const key = coverageKey(row.eventType, row.entityId)
        const list = covered.get(key) ?? []
        list.push({ correlationId: row.correlationId, causedByLogId: row.causedByLogId })
        covered.set(key, list)
      }
    }
    for (const event of events) {
      if (recordsRemaining <= 0 || clock.runOver()) {
        state.truncated = true
        break
      }
      const candidates = event.entityId ? covered.get(coverageKey(event.eventType, event.entityId)) ?? [] : []
      const observed = candidates.some((candidate) => (
        (candidate.correlationId !== null && candidate.correlationId === event.correlationId)
        || (candidate.causedByLogId !== null && candidate.causedByLogId === event.logId)
      ))
      if (observed) {
        bump(state, 'reconstructed_covered_by_observed')
        continue
      }
      recordEvent(state, proposal, entityType, event, otherRules)
      state.reconstructedEvents += 1
      processed += 1
      recordsRemaining -= 1
    }
    if (state.truncated) return finish()
    state.auditCursor = page.lastCursor ?? state.auditCursor
    if (page.exhausted) state.phase = 'done'
  }
  return finish()
}

async function findRule(ctx: { em: SimulationRunContext<RuleBacktestState>['em']; scope: SimulationRunContext<RuleBacktestState>['scope'] }, where: Record<string, unknown>): Promise<BusinessRule | null> {
  return findOneWithDecryption(
    ctx.em,
    BusinessRule,
    { ...where, tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId, deletedAt: null },
    undefined,
    { tenantId: ctx.scope.tenantId, organizationId: ctx.scope.organizationId },
  )
}

function toArtifactVersion(rule: BusinessRule): SimulationArtifactVersion {
  return {
    artifactId: rule.id,
    updatedAt: rule.updatedAt instanceof Date && !Number.isNaN(rule.updatedAt.getTime()) ? rule.updatedAt.toISOString() : null,
    fingerprint: computeRuleDefinitionHash(rule),
  }
}

export function fingerprintRuleProposal(proposal: BusinessRuleDefinitionInput): string {
  return computeRuleDefinitionHash({
    ruleType: proposal.ruleType,
    entityType: proposal.entityType,
    eventType: proposal.eventType ?? null,
    conditionExpression: proposal.conditionExpression ?? null,
    successActions: proposal.successActions ?? null,
    failureActions: proposal.failureActions ?? null,
    effectiveFrom: proposal.effectiveFrom ?? null,
    effectiveTo: proposal.effectiveTo ?? null,
    enabled: proposal.enabled,
  })
}

/**
 * `business_rules.rule_backtest` (spec S3–S6): the proposal is the full rule definition, validated
 * by the business rules schema. Sources: rule execution logs (`business_rules.view_logs`), the
 * rule definitions (`business_rules.view`) and the events of the targeted record type, whose view
 * features the emitting module's adapters declare (`inputFeatures`); past record values rebuilt
 * from audit history need `audit_logs.view_tenant` (insights turns them into unknown paths
 * otherwise), and sample ids are confirmed through the owning module's explain resource.
 */
export const ruleBacktestKind = defineSimulationKind<BusinessRuleDefinitionInput, RuleBacktestState>({
  kind: RULE_BACKTEST_KIND,
  artifactKind: RULE_BACKTEST_ARTIFACT_KIND,
  labelKey: RULE_BACKTEST_I18N.label,
  requiredFeatures: [...RULE_BACKTEST_FEATURES],
  inputSchema: businessRuleDefinitionSchema,
  version: RULE_BACKTEST_VERSION,
  cellKeys: [...RULE_BACKTEST_CELLS],
  async readArtifactVersion(ctx, ref) {
    if (ref.artifactId) {
      if (!isUuid(ref.artifactId)) return null
      const rule = await findRule(ctx, { id: ref.artifactId })
      return rule ? toArtifactVersion(rule) : null
    }
    const rule = await findRule(ctx, { ruleId: ref.input.ruleId })
    return rule ? toArtifactVersion(rule) : null
  },
  fingerprintProposal: fingerprintRuleProposal,
  inputFeatures(input, ctx) {
    return Array.from(new Set(adaptersOf(ctx.eventAdapters, input.entityType).flatMap((adapter) => adapter.requiredFeatures)))
  },
  async validate(input, ctx) {
    const adapters = adaptersOf(ctx.eventAdapters, input.entityType)
    const matched = input.eventType ? adapters.filter((adapter) => simulationEventType(adapter.eventId) === input.eventType) : adapters
    return matched.length > 0 ? { ok: true } : { ok: false, code: 'unsupported_event_payload' }
  },
  run: runRuleBacktestSlice,
  applyHref({ artifactId, runId }) {
    const query = `simulationRunId=${encodeURIComponent(runId)}`
    return artifactId ? `/backend/rules/${encodeURIComponent(artifactId)}?${query}` : `/backend/rules/create?${query}`
  },
})
