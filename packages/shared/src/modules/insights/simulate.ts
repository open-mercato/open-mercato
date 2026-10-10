import type { EntityManager } from '@mikro-orm/postgresql'
import type { ZodType } from 'zod'
import type { ExplainHistoryEntry } from './explain'

/**
 * Change simulator contract (`insights.simulate.ts`, spec `2026-10-08-insights-change-simulator.md`).
 *
 * A module that owns a configurable artifact (a business rule, a workflow trigger, ...)
 * contributes a pure simulator ("kind") that evaluates a proposed change of that artifact
 * against recorded history; a module that emits domain events contributes event adapters that
 * rebuild the payloads of its events from audit history. Simulators evaluate, never execute:
 * they read through the read-only context they are given and never call commands, action
 * executors or event emitters. `insights` orchestrates private, budgeted, cancellable runs and
 * applies the privacy rules (k-suppression, live sample resolution) to what a kind returns.
 */

export const SIMULATE_CONFIG_VERSION = 1 as const

/** `<module>.<name>`, e.g. `business_rules.rule_backtest`. */
export const SIMULATION_KIND_PATTERN = /^[a-z][a-z0-9_]{0,63}\.[a-z][a-z0-9_]{0,63}$/

/** A dotted event id, e.g. `customers.deal.updated`. */
export const SIMULATION_EVENT_ID_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/

export const SIMULATION_FIDELITIES = ['observed', 'reconstructed', 'mixed', 'none'] as const

export type SimulationFidelity = (typeof SIMULATION_FIDELITIES)[number]

/**
 * Codes a kind's `validate` may answer with (the request route maps them to 422 with a
 * translated message). `artifact_not_found` is used by insights when `readArtifactVersion`
 * finds no artifact for an explicit artifact id.
 */
export const SIMULATION_PROPOSAL_ERROR_CODES = [
  'invalid_proposal',
  'unsupported_event_payload',
  'not_customized',
  'artifact_not_found',
] as const

export type SimulationProposalErrorCode = (typeof SIMULATION_PROPOSAL_ERROR_CODES)[number]

export type SimulationScope = {
  tenantId: string
  organizationId: string
}

export type SimulationWindow = {
  from: Date
  to: Date
}

/**
 * The live version of an artifact: `updatedAt` (ISO, null when the artifact has none) and a
 * kind-defined `fingerprint` of its simulated definition (rules: `computeRuleDefinitionHash`).
 * `artifactId` is the artifact that was found (a kind may locate an unsaved proposal's artifact
 * by a business key once it has been created).
 */
export type SimulationArtifactVersion = {
  artifactId: string | null
  updatedAt: string | null
  fingerprint: string | null
}

export type SimulationArtifactContext = {
  em: EntityManager
  scope: SimulationScope
}

export type SimulationArtifactRef<TInput> = {
  artifactId: string | null
  input: TInput
}

export type SimulationValidationResult =
  | { ok: true }
  | { ok: false; code: SimulationProposalErrorCode }

/** One decrypted, organization-scoped audit entry handed to event adapters. */
export type SimulationAuditEntry = Pick<
  ExplainHistoryEntry,
  | 'logId'
  | 'at'
  | 'commandId'
  | 'actionType'
  | 'executionState'
  | 'actorUserId'
  | 'resourceKind'
  | 'resourceId'
  | 'snapshotBefore'
  | 'snapshotAfter'
  | 'changes'
  | 'causeKind'
> & {
  organizationId: string | null
  correlationId: string | null
  causedByLogId: string | null
  actorKind: 'user' | 'api_key' | 'system'
}

/**
 * The payload an event adapter rebuilds for one audit entry. `unknownPaths` are payload paths
 * the adapter cannot reconstruct (a condition reading them is `cannot_tell`); `valuePaths` are
 * paths whose values come from the record's audit snapshots (past record values) — insights
 * turns them into unknown paths when the requester may not read past values
 * (`audit_logs.view_tenant`). A path absent from `payload` and from `unknownPaths` is a known
 * absence and evaluates exactly as in production.
 */
export type SimulationEventPayload = {
  payload: Record<string, unknown>
  unknownPaths?: string[]
  valuePaths?: string[]
}

export type SimulationEventAdapterContext = {
  scope: SimulationScope
}

/**
 * Declared by the module that emits `eventId`: which audit entries (resource kinds + derived
 * action types, optionally narrowed to command ids) emitted the event, and how its payload
 * looked. `payloadFrom` returns `null` for an entry that did not emit the event (e.g. an update
 * that did not change the status of a lifecycle event). `requiredFeatures` (non-empty, else the
 * adapter is skipped at registration) are the features needed to read the event's record (e.g.
 * `customers.deals.view`); a kind that evaluates proposals against the event requires them too.
 */
export type SimulationEventAdapter = {
  eventId: string
  logResourceKinds: string[]
  actionTypes: string[]
  requiredFeatures: string[]
  commandIds?: string[]
  payloadFrom(entry: SimulationAuditEntry, ctx: SimulationEventAdapterContext): SimulationEventPayload | null
}

export type RegisteredSimulationEventAdapter = SimulationEventAdapter & { moduleId: string }

export type SimulationAuditCursor = {
  createdAt: string
  id: string
}

export type SimulationAuditScanQuery = {
  resourceKinds: string[]
  after: SimulationAuditCursor | null
  limit: number
}

export type SimulationAuditScanPage = {
  entries: SimulationAuditEntry[]
  lastCursor: SimulationAuditCursor | null
  exhausted: boolean
  payloadBytes: number
  undecryptable: number
}

/**
 * Budgets of one slice. `recordsRemaining` is what is left of the run's record budget;
 * `sliceDeadlineAt` ends this slice (return `continue`), `runDeadlineAt` ends the run (return
 * `done` with `truncated: true`). Check both inside every record loop.
 */
export type SimulationBudget = {
  recordsRemaining: number
  sliceDeadlineAt: number
  runDeadlineAt: number
  maxBatchRows: number
  maxBatchBytes: number
}

export type SimulationFeatureCheck = (features: readonly string[]) => Promise<boolean>

export type SimulationInputFeaturesContext = {
  eventAdapters: readonly RegisteredSimulationEventAdapter[]
}

/**
 * `artifactId` is the artifact id exactly as the requester sent it (null for an unsaved artifact),
 * before `readArtifactVersion` resolved it, so a kind can refuse ids it cannot simulate (e.g.
 * `not_customized` for a code-defined artifact).
 */
export type SimulationValidationContext = {
  em: EntityManager
  scope: SimulationScope
  eventAdapters: readonly RegisteredSimulationEventAdapter[]
  artifactId?: string | null
}

/**
 * Context of one slice. `em` runs inside a READ ONLY transaction with a statement timeout;
 * `scanAuditLog` reads decrypted audit entries of the run's organization inside the run window
 * (created_at, id ascending). `hasFeatures` checks the requester's features (wildcard-aware) at
 * the run's organization. `state` is what the previous slice returned (null on the first one).
 * `artifactId` is the artifact the proposal replaces (null for an unsaved artifact).
 */
export type SimulationRunContext<TState> = {
  em: EntityManager
  scope: SimulationScope
  requesterUserId: string
  artifactId: string | null
  window: SimulationWindow
  budget: SimulationBudget
  state: TState | null
  now: () => number
  hasFeatures: SimulationFeatureCheck
  eventAdapters: readonly RegisteredSimulationEventAdapter[]
  scanAuditLog: (query: SimulationAuditScanQuery) => Promise<SimulationAuditScanPage>
}

/**
 * One count cell of a result group (e.g. `fires`). `sampleIds` are candidate record ids of
 * `SimulationGroup.sampleResourceKind`; insights keeps a few of them only for cells that pass
 * k-suppression and only after the owning module's explain `loadCurrent` confirms them.
 */
export type SimulationCell = {
  key: string
  count: number
  sampleIds?: string[]
}

/**
 * One result group (rule backtest: one event id). `warnings` are i18n keys derived from the
 * proposal's configuration; `dataWarnings` are i18n keys derived from the counts and are dropped
 * when the group is suppressed; `flags` are machine-readable markers (e.g. `rule_limit_exceeded`).
 */
export type SimulationGroup = {
  key: string
  labelKey?: string | null
  sampleResourceKind?: string | null
  cells: SimulationCell[]
  warnings?: string[]
  dataWarnings?: string[]
  flags?: string[]
}

/** Counts describing what was (not) read; keys are kind-defined snake_case identifiers. */
export type SimulationCoverage = Record<string, number>

export type SimulationKindResult = {
  groups: SimulationGroup[]
  coverage: SimulationCoverage
  caveats: string[]
  fidelity: SimulationFidelity
  truncated: boolean
}

export type SimulationSliceResult<TState> =
  | { status: 'continue'; state: TState; recordsProcessed: number; progress?: number }
  | { status: 'done'; result: SimulationKindResult; recordsProcessed: number }

/**
 * A simulator. `requiredFeatures` must be non-empty and cover every source the kind reads (a
 * kind without them is skipped at registration); `inputFeatures` adds the features a particular
 * proposal reads (e.g. the view feature of the record type a rule targets). Both are checked at
 * request time, before every slice and on every read. `inputSchema` validates the proposal with
 * the owning module's own schema. `version` is part of every run's inputs hash: bump it when the
 * simulation semantics change. `cellKeys` orders the cells of every group.
 */
export type SimulationKindDefinition<TInput = unknown, TState = unknown> = {
  kind: string
  artifactKind: string
  labelKey: string
  requiredFeatures: string[]
  inputSchema: ZodType<TInput>
  version: number
  cellKeys: string[]
  ttlHours?: number
  readArtifactVersion(ctx: SimulationArtifactContext, ref: SimulationArtifactRef<TInput>): Promise<SimulationArtifactVersion | null>
  fingerprintProposal(input: TInput): string
  inputFeatures?(input: TInput, ctx: SimulationInputFeaturesContext): string[]
  validate?(input: TInput, ctx: SimulationValidationContext): Promise<SimulationValidationResult>
  run(input: TInput, ctx: SimulationRunContext<TState>): Promise<SimulationSliceResult<TState>>
  applyHref?(ref: { artifactId: string | null; runId: string }): string | null
}

export type SimulateModuleConfig = {
  version: typeof SIMULATE_CONFIG_VERSION
  kinds?: SimulationKindDefinition[]
  eventAdapters?: SimulationEventAdapter[]
}

export type SimulateModuleConfigEntry = {
  moduleId: string
  config: SimulateModuleConfig
}

export function defineSimulateConfig(config: SimulateModuleConfig): SimulateModuleConfig {
  return config
}

/**
 * Types one kind with its proposal and state types, and erases them for `defineSimulateConfig`.
 * The registry validates every proposal with `inputSchema` before calling the kind.
 */
export function defineSimulationKind<TInput, TState>(kind: SimulationKindDefinition<TInput, TState>): SimulationKindDefinition {
  return kind as unknown as SimulationKindDefinition
}

export type SimulationCrudEventAction = 'created' | 'updated' | 'deleted'

/** Audit action types (`deriveActionLogActionType`) of the commands behind each CRUD event. */
export const SIMULATION_CRUD_ACTION_TYPES: Record<SimulationCrudEventAction, string[]> = {
  created: ['create'],
  updated: ['edit'],
  deleted: ['delete'],
}

export type CrudEventAdapterOptions = {
  /** Event id prefix (`<module>.<entity>`); adapters are declared for `<prefix>.<action>`. */
  eventPrefix: string
  logResourceKinds: string[]
  /** Features needed to read the event's record (e.g. `customers.deals.view`). */
  requiredFeatures: string[]
  /** CRUD events the module really emits (default: all three). */
  actions?: SimulationCrudEventAction[]
  /** Narrows each action to the commands that emit it. */
  commandIds?: Partial<Record<SimulationCrudEventAction, string[]>>
  /**
   * Whether the emitter adds `syncOrigin` to writes originating from a sync (the generated CRUD
   * payload does; a custom `buildPayload` may not). When true, `syncOrigin` is unknown for entries
   * whose cause could be a sync (`SIMULATION_SYNC_CAPABLE_CAUSE_KINDS`) or that carry no causation.
   */
  syncOrigin?: boolean
  /** Additional identifier fields of a custom `buildPayload` (never record values). */
  extraPayload?: (entry: SimulationAuditEntry, ctx: SimulationEventAdapterContext) => SimulationEventPayload
}

/** Causes under which a write may originate from a sync (a sync bridge can run as a subscriber or a schedule). */
export const SIMULATION_SYNC_CAPABLE_CAUSE_KINDS: readonly string[] = ['sync_run', 'subscriber', 'schedule', 'system', 'unknown']

function readRecordId(entry: SimulationAuditEntry): string | null {
  const id = typeof entry.resourceId === 'string' ? entry.resourceId.trim() : ''
  return id.length > 0 ? id : null
}

/**
 * Event adapters for CRUD after-events whose payload is the generated CRUD payload
 * (`{ id, organizationId, tenantId }`, plus `syncOrigin` for sync writes when `syncOrigin` is
 * true) or that payload with extra identifier fields (`extraPayload`). Entries that were later
 * undone still emitted their event when they ran, so they are kept. Undo traces (`causeKind`
 * `undo`) and failed entries are skipped: what an undo emits is module-specific (often the inverse
 * event, sometimes nothing), so a module that wants undo events counted declares its own adapter.
 */
export function createCrudEventAdapters(options: CrudEventAdapterOptions): SimulationEventAdapter[] {
  const actions = options.actions ?? (['created', 'updated', 'deleted'] as SimulationCrudEventAction[])
  const syncOrigin = options.syncOrigin !== false
  return actions.map((action): SimulationEventAdapter => {
    const commandIds = options.commandIds?.[action]
    return {
      eventId: `${options.eventPrefix}.${action}`,
      logResourceKinds: [...options.logResourceKinds],
      requiredFeatures: [...options.requiredFeatures],
      actionTypes: [...SIMULATION_CRUD_ACTION_TYPES[action]],
      ...(commandIds && commandIds.length > 0 ? { commandIds: [...commandIds] } : {}),
      payloadFrom(entry, ctx) {
        if (entry.causeKind === 'undo' || entry.executionState === 'failed') return null
        const id = readRecordId(entry)
        if (!id) return null
        const extra = options.extraPayload ? options.extraPayload(entry, ctx) : { payload: {} }
        const unknownPaths = [...(extra.unknownPaths ?? [])]
        if (syncOrigin && (entry.causeKind === null || SIMULATION_SYNC_CAPABLE_CAUSE_KINDS.includes(entry.causeKind))) unknownPaths.push('syncOrigin')
        return {
          payload: {
            id,
            organizationId: entry.organizationId ?? ctx.scope.organizationId,
            tenantId: ctx.scope.tenantId,
            ...extra.payload,
          },
          ...(unknownPaths.length > 0 ? { unknownPaths } : {}),
          ...(extra.valuePaths && extra.valuePaths.length > 0 ? { valuePaths: [...extra.valuePaths] } : {}),
        }
      },
    }
  })
}

/** The `<module>.<entity>` part of an event id (`customers.deal.updated` → `customers.deal`). */
export function simulationEventEntityType(eventId: string): string {
  const index = eventId.lastIndexOf('.')
  return index > 0 ? eventId.slice(0, index) : eventId
}

/** The action part of an event id (`customers.deal.updated` → `updated`). */
export function simulationEventType(eventId: string): string {
  const index = eventId.lastIndexOf('.')
  return index > 0 ? eventId.slice(index + 1) : ''
}
