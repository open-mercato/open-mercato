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
 * Codes a kind's `validate` may answer with (the request route answers them with a translated
 * message): `artifact_unavailable` with 404 (the artifact does not exist or is outside the
 * requester's scope — one answer for both), `forbidden` with 403 (the requester may not apply the
 * proposal, mirroring the owning module's own write guards), every other code with 422.
 * `artifact_not_found` is used by insights when `readArtifactVersion` finds no artifact for an
 * explicit artifact id.
 */
export const SIMULATION_PROPOSAL_ERROR_CODES = [
  'invalid_proposal',
  'unsupported_event_payload',
  'not_customized',
  'artifact_not_found',
  'artifact_unavailable',
  'forbidden',
] as const

export type SimulationProposalErrorCode = (typeof SIMULATION_PROPOSAL_ERROR_CODES)[number]

/**
 * How a kind runs. `queued` (the default): background slices on the `insights-simulation` queue.
 * `inline`: computed while the request is handled, in the app process, and stored at once as a
 * completed run (for kinds that read the app's live configuration, e.g. the role permission
 * preview). Inline runs are never deduplicated: their result depends on live state that the
 * artifact version does not capture.
 */
export const SIMULATION_EXECUTION_MODES = ['queued', 'inline'] as const

export type SimulationExecutionMode = (typeof SIMULATION_EXECUTION_MODES)[number]

/**
 * The access-log resource kind of permission previews (`auth.role_acl_preview`): insights writes
 * one row (fail closed) before a preview is computed and before its affected principals are
 * listed; the kind is kept under the core access-log retention.
 */
export const SIMULATION_PERMISSION_PREVIEW_ACCESS_LOG_KIND = 'insights.simulation.permission_preview'

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

/** Resolves an app-process service by its DI name (`undefined` when it is not registered). */
export type SimulationServiceResolver = <TService>(name: string) => TService | undefined

/**
 * `artifactId` is the artifact id exactly as the requester sent it (null for an unsaved artifact),
 * before `readArtifactVersion` resolved it, so a kind can refuse ids it cannot simulate (e.g.
 * `not_customized` for a code-defined artifact). `requesterUserId` and `resolve` are present while
 * a request is handled (a kind that mirrors its owning module's write guards fails closed without
 * them).
 */
export type SimulationValidationContext = {
  em: EntityManager
  scope: SimulationScope
  eventAdapters: readonly RegisteredSimulationEventAdapter[]
  artifactId?: string | null
  requesterUserId?: string
  resolve?: SimulationServiceResolver
}

/**
 * What an `inline` run sees beyond the slice context: the requester's organization scope in the
 * tenant (`null` = every organization, `[]` = none) and the app-process services. Present only for
 * inline runs.
 */
export type SimulationInlineContext = {
  organizationIds: readonly string[] | null
  resolve: SimulationServiceResolver
}

/**
 * Context of one slice. `em` runs inside a READ ONLY transaction with a statement timeout;
 * `scanAuditLog` reads decrypted audit entries of the run's organization inside the run window
 * (created_at, id ascending). `hasFeatures` checks the requester's features (wildcard-aware) at
 * the run's organization. `state` is what the previous slice returned (null on the first one).
 * `artifactId` is the artifact the proposal replaces (null for an unsaved artifact). `inline` is
 * present only for an `inline` kind, which must answer `done` in its single slice.
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
  inline?: SimulationInlineContext
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

/**
 * Kind-level facts of a result that are not counts of records, so they are never k-suppressed:
 * `warnings` are i18n keys shown prominently (e.g. "you would lock yourself out"); `counts` are
 * non-negative integers under snake_case keys (e.g. `pages_lost`); `lists` hold identifiers from a
 * public catalog under snake_case keys (e.g. feature ids) — never record values or record ids.
 */
export type SimulationResultSummary = {
  warnings?: string[]
  counts?: Record<string, number>
  lists?: Record<string, string[]>
}

export type SimulationKindResult = {
  groups: SimulationGroup[]
  coverage: SimulationCoverage
  caveats: string[]
  fidelity: SimulationFidelity
  truncated: boolean
  summary?: SimulationResultSummary
}

export type SimulationSliceResult<TState> =
  | { status: 'continue'; state: TState; recordsProcessed: number; progress?: number }
  | { status: 'done'; result: SimulationKindResult; recordsProcessed: number }

/**
 * Context of a live-records read of a completed run: the viewer (the run's requester), the
 * viewer's current organization scope (`null` = every organization, `[]` = none), the requested
 * page (`pageSize` ≤ 100) and the app-process services.
 */
export type SimulationLiveRecordsContext = {
  em: EntityManager
  scope: SimulationScope
  viewerUserId: string
  artifactId: string | null
  organizationIds: readonly string[] | null
  page: number
  pageSize: number
  hasFeatures: SimulationFeatureCheck
  resolve: SimulationServiceResolver
}

/**
 * One record a run concerns, resolved live for the viewer (e.g. a user whose permissions would
 * change). `type` is kind-defined (label `<module>.simulation.records.types.<type>`), `href` an
 * app-internal link (anything else is dropped), `groupKeys` the result groups the record belongs
 * to, `counts` non-negative integers under snake_case keys.
 */
export type SimulationLiveRecord = {
  id: string
  type: string
  label: string | null
  href: string | null
  groupKeys: string[]
  counts: Record<string, number>
}

/**
 * One page of live records. `notes` are i18n keys about the list (e.g. "the proposal is already in
 * effect"); `groupLabels` are display names of the result groups resolved live for the viewer.
 */
export type SimulationLiveRecordsPage = {
  items: SimulationLiveRecord[]
  total: number
  notes?: string[]
  groupLabels?: Record<string, string>
}

/**
 * Records a completed run concerns, never stored: resolved on every read under the viewer's
 * current permissions. `requiredFeatures` (non-empty, else the kind is skipped at registration)
 * are the viewer features the list needs on top of the kind's own.
 */
export type SimulationLiveRecordsDefinition<TInput> = {
  requiredFeatures: string[]
  list(input: TInput, ctx: SimulationLiveRecordsContext): Promise<SimulationLiveRecordsPage>
}

/**
 * A simulator. `requiredFeatures` must be non-empty and cover every source the kind reads (a
 * kind without them is skipped at registration); `inputFeatures` adds the features a particular
 * proposal reads (e.g. the view feature of the record type a rule targets). Both are checked at
 * request time, before every slice and on every read. `inputSchema` validates the proposal with
 * the owning module's own schema. `version` is part of every run's inputs hash: bump it when the
 * simulation semantics change. `cellKeys` orders the cells of every group. `execution` (default
 * `queued`) selects background slices or an `inline` run computed at request time.
 * `accessLogResourceKind`, when set, makes insights write one access-log row (fail closed) before a
 * run is computed and before its live records are listed. `liveRecords` lists the records a
 * completed run concerns, resolved live on read.
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
  execution?: SimulationExecutionMode
  accessLogResourceKind?: string
  readArtifactVersion(ctx: SimulationArtifactContext, ref: SimulationArtifactRef<TInput>): Promise<SimulationArtifactVersion | null>
  fingerprintProposal(input: TInput): string
  inputFeatures?(input: TInput, ctx: SimulationInputFeaturesContext): string[]
  validate?(input: TInput, ctx: SimulationValidationContext): Promise<SimulationValidationResult>
  run(input: TInput, ctx: SimulationRunContext<TState>): Promise<SimulationSliceResult<TState>>
  applyHref?(ref: { artifactId: string | null; runId: string }): string | null
  liveRecords?: SimulationLiveRecordsDefinition<TInput>
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
