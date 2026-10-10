import { BigIntType, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export const PROCESS_CURSOR_STATUSES = ['idle', 'backfilling'] as const

export type ProcessCursorStatus = (typeof PROCESS_CURSOR_STATUSES)[number]

export const PROCESS_SCAN_KINDS = ['backfill', 'reconcile', 'full_reconcile'] as const

export type ProcessScanKind = (typeof PROCESS_SCAN_KINDS)[number]

export const AUTOMATION_SUGGESTION_STATUSES = ['open', 'dismissed', 'drafted', 'superseded'] as const

export type AutomationSuggestionStatus = (typeof AUTOMATION_SUGGESTION_STATUSES)[number]

/**
 * Per-organization ingest state of the Process X-Ray projection. The incremental cursor
 * walks `action_logs` on `(created_at, id)`; the state watermark walks undo/redo state
 * changes on `(updated_at, id)`; the `scan_*` columns hold one resumable range scan
 * (backfill or reconciliation, optionally limited to `scan_process_keys`) and `scan_chain_id`
 * the single job chain allowed to advance it. `contract_hashes` maps each projected process to
 * the contract its rows were written under (null until the first slice adopts the current
 * ones); a changed or added process is cleared and queued in `pending_rebuild_keys` for a
 * process-limited full reconciliation. `coverage_from` / `history_scanned_at` tell how far
 * back the projection is complete. `actor_key_fingerprint` pins the pseudonym key the
 * organization's rows were written under. Every projection write runs under the CAS lease
 * and is fenced by `lease_token`, which only ever increases.
 */
@Entity({ tableName: 'insights_process_cursors' })
@Unique({ name: 'insights_process_cursors_scope_unique', properties: ['tenantId', 'organizationId'] })
export class InsightsProcessCursor {
  [OptionalProps]?: 'status' | 'leaseToken' | 'scanProcessedCount' | 'pendingRebuildKeys' | 'undecryptableRows' | 'overlapTimeouts' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'last_created_at', type: Date, nullable: true })
  lastCreatedAt: Date | null = null

  @Property({ name: 'last_log_id', type: 'uuid', nullable: true })
  lastLogId: string | null = null

  @Property({ name: 'state_watermark', type: Date, nullable: true })
  stateWatermark: Date | null = null

  @Property({ name: 'state_last_log_id', type: 'uuid', nullable: true })
  stateLastLogId: string | null = null

  @Property({ name: 'scan_id', type: 'uuid', nullable: true })
  scanId: string | null = null

  @Property({ name: 'scan_kind', type: 'text', nullable: true })
  scanKind: ProcessScanKind | null = null

  @Property({ name: 'scan_from', type: Date, nullable: true })
  scanFrom: Date | null = null

  @Property({ name: 'scan_until', type: Date, nullable: true })
  scanUntil: Date | null = null

  @Property({ name: 'scan_after_created_at', type: Date, nullable: true })
  scanAfterCreatedAt: Date | null = null

  @Property({ name: 'scan_after_log_id', type: 'uuid', nullable: true })
  scanAfterLogId: string | null = null

  @Property({ name: 'scan_progress_job_id', type: 'uuid', nullable: true })
  scanProgressJobId: string | null = null

  @Property({ name: 'scan_processed_count', type: new BigIntType('number'), default: 0 })
  scanProcessedCount: number = 0

  @Property({ name: 'scan_started_at', type: Date, nullable: true })
  scanStartedAt: Date | null = null

  @Property({ name: 'scan_updated_at', type: Date, nullable: true })
  scanUpdatedAt: Date | null = null

  @Property({ name: 'scan_chain_id', type: 'uuid', nullable: true })
  scanChainId: string | null = null

  @Property({ name: 'actor_key_fingerprint', type: 'text', nullable: true })
  actorKeyFingerprint: string | null = null

  @Property({ name: 'last_reconciled_at', type: Date, nullable: true })
  lastReconciledAt: Date | null = null

  @Property({ name: 'last_full_reconciled_at', type: Date, nullable: true })
  lastFullReconciledAt: Date | null = null

  @Property({ name: 'last_pruned_at', type: Date, nullable: true })
  lastPrunedAt: Date | null = null

  @Property({ name: 'lease_owner', type: 'text', nullable: true })
  leaseOwner: string | null = null

  @Property({ name: 'lease_token', type: new BigIntType('number'), default: 0 })
  leaseToken: number = 0

  @Property({ name: 'lease_until', type: Date, nullable: true })
  leaseUntil: Date | null = null

  @Property({ name: 'contract_hashes', type: 'jsonb', nullable: true })
  contractHashes: Record<string, string> | null = null

  @Property({ name: 'pending_rebuild_keys', type: 'jsonb', default: [] })
  pendingRebuildKeys: string[] = []

  @Property({ name: 'scan_process_keys', type: 'jsonb', nullable: true })
  scanProcessKeys: string[] | null = null

  @Property({ name: 'contract_changed_at', type: Date, nullable: true })
  contractChangedAt: Date | null = null

  @Property({ name: 'contract_change', type: 'jsonb', nullable: true })
  contractChange: { changed: string[]; added: string[]; removed: string[] } | null = null

  @Property({ name: 'coverage_from', type: Date, nullable: true })
  coverageFrom: Date | null = null

  @Property({ name: 'history_scanned_at', type: Date, nullable: true })
  historyScannedAt: Date | null = null

  @Property({ name: 'undecryptable_rows', type: new BigIntType('number'), default: 0 })
  undecryptableRows: number = 0

  @Property({ name: 'overlap_timeouts', type: new BigIntType('number'), default: 0 })
  overlapTimeouts: number = 0

  @Property({ name: 'last_overlap_timeout_at', type: Date, nullable: true })
  lastOverlapTimeoutAt: Date | null = null

  @Property({ name: 'status', type: 'text', default: 'idle' })
  status: ProcessCursorStatus = 'idle'

  @Property({ name: 'last_run_at', type: Date, nullable: true })
  lastRunAt: Date | null = null

  @Property({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One projected process activity. Holds identifiers only: activity values are sanitized
 * (`other` / `none`), actors are per-tenant HMAC pseudonyms, and `cause_kind` is
 * `legacy` for audit rows written before causation tracking. Idempotent on
 * `(source_log_id, process_key, seq)`; an undo voids the row instead of deleting it.
 */
@Entity({ tableName: 'insights_process_events' })
@Unique({ name: 'insights_process_events_source_unique', properties: ['sourceLogId', 'processKey', 'seq'] })
@Index({ name: 'insights_process_events_case_idx', properties: ['tenantId', 'organizationId', 'processKey', 'caseId', 'occurredAt'] })
@Index({ name: 'insights_process_events_window_idx', properties: ['tenantId', 'organizationId', 'processKey', 'occurredAt'] })
@Index({ name: 'insights_process_events_value_idx', properties: ['tenantId', 'organizationId', 'processKey', 'followupField', 'followupValue'] })
@Index({ name: 'insights_process_events_actor_idx', properties: ['tenantId', 'actorPseudonym'] })
@Index({ name: 'insights_process_events_occurred_idx', properties: ['tenantId', 'organizationId', 'occurredAt'] })
export class InsightsProcessEvent {
  [OptionalProps]?: 'voided' | 'viaSyncRun' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_key', type: 'text' })
  processKey!: string

  @Property({ name: 'case_kind', type: 'text' })
  caseKind!: string

  @Property({ name: 'case_id', type: 'uuid' })
  caseId!: string

  @Property({ name: 'activity_key', type: 'text' })
  activityKey!: string

  @Property({ name: 'activity_kind', type: 'text' })
  activityKind!: string

  @Property({ name: 'occurred_at', type: Date })
  occurredAt!: Date

  @Property({ name: 'source_log_id', type: 'uuid' })
  sourceLogId!: string

  @Property({ name: 'seq', type: 'integer' })
  seq!: number

  @Property({ name: 'actor_pseudonym', type: 'text', nullable: true })
  actorPseudonym: string | null = null

  @Property({ name: 'actor_role_ids', type: 'text[]', nullable: true })
  actorRoleIds: string[] | null = null

  @Property({ name: 'actor_team_id', type: 'uuid', nullable: true })
  actorTeamId: string | null = null

  @Property({ name: 'cause_kind', type: 'text' })
  causeKind!: string

  @Property({ name: 'cause_id', type: 'text', nullable: true })
  causeId: string | null = null

  @Property({ name: 'via_sync_run', type: 'boolean', default: false })
  viaSyncRun: boolean = false

  @Property({ name: 'followup_field', type: 'text', nullable: true })
  followupField: string | null = null

  @Property({ name: 'followup_value', type: 'text', nullable: true })
  followupValue: string | null = null

  @Property({ name: 'voided', type: 'boolean', default: false })
  voided: boolean = false

  @Property({ name: 'voided_by_log_id', type: 'uuid', nullable: true })
  voidedByLogId: string | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * GDPR erasure ledger of Process X-Ray: one row per user erased in a tenant, holding the
 * random pseudonym (`erased:<uuid>`) that replaces the user's actor pseudonym and user-kind
 * values. Ingest applies it inside every fenced commit, so a later backfill, reconciliation,
 * rebuild or pseudonym re-key never restores an erased user's pseudonym. The user id is the
 * internal surrogate key the audit log keeps anyway; it is never exposed by an API.
 */
@Entity({ tableName: 'insights_process_erasures' })
@Unique({ name: 'insights_process_erasures_user_unique', properties: ['tenantId', 'userId'] })
export class InsightsProcessErasure {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'replacement', type: 'text' })
  replacement!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/** Per-case summary recomputed from the non-voided events of the case. */
@Entity({ tableName: 'insights_process_cases' })
@Unique({ name: 'insights_process_cases_case_unique', properties: ['tenantId', 'organizationId', 'processKey', 'caseId'] })
@Index({ name: 'insights_process_cases_activity_idx', properties: ['tenantId', 'organizationId', 'processKey', 'lastActivityAt'] })
@Index({ name: 'insights_process_cases_variant_idx', properties: ['tenantId', 'organizationId', 'processKey', 'variantHash'] })
@Index({ name: 'insights_process_cases_retention_idx', properties: ['tenantId', 'organizationId', 'lastActivityAt'] })
export class InsightsProcessCase {
  [OptionalProps]?: 'truncated' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_key', type: 'text' })
  processKey!: string

  @Property({ name: 'case_kind', type: 'text' })
  caseKind!: string

  @Property({ name: 'case_id', type: 'uuid' })
  caseId!: string

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'last_activity_at', type: Date })
  lastActivityAt!: Date

  @Property({ name: 'ended_at', type: Date, nullable: true })
  endedAt: Date | null = null

  @Property({ name: 'status', type: 'text' })
  status!: string

  @Property({ name: 'event_count', type: 'integer' })
  eventCount!: number

  @Property({ name: 'rework_count', type: 'integer' })
  reworkCount!: number

  @Property({ name: 'distinct_actor_count', type: 'integer' })
  distinctActorCount!: number

  @Property({ name: 'automated_share', type: 'float' })
  automatedShare!: number

  @Property({ name: 'variant_hash', type: 'text' })
  variantHash!: string

  @Property({ name: 'variant_keys', type: 'jsonb' })
  variantKeys!: string[]

  @Property({ name: 'dimensions', type: 'jsonb' })
  dimensions!: Record<string, unknown>

  @Property({ name: 'truncated', type: 'boolean', default: false })
  truncated: boolean = false

  @Property({ name: 'recomputed_at', type: Date })
  recomputedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/** Precomputed analytics windows, written only by the rollup worker (not user-editable). */
@Entity({ tableName: 'insights_process_rollups' })
@Unique({
  name: 'insights_process_rollups_window_unique',
  properties: ['tenantId', 'organizationId', 'processKey', 'windowKey', 'windowStart'],
})
export class InsightsProcessRollup {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_key', type: 'text' })
  processKey!: string

  @Property({ name: 'window_key', type: 'text' })
  windowKey!: string

  @Property({ name: 'window_start', type: Date })
  windowStart!: Date

  @Property({ name: 'window_end', type: Date })
  windowEnd!: Date

  @Property({ name: 'computed_at', type: Date })
  computedAt!: Date

  @Property({ name: 'metrics', type: 'jsonb' })
  metrics!: Record<string, unknown>

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/** User-editable Process X-Ray settings of one organization (optimistic lock on `updated_at`). */
@Entity({ tableName: 'insights_process_settings' })
@Unique({ name: 'insights_process_settings_scope_unique', properties: ['tenantId', 'organizationId'] })
export class InsightsProcessSettings {
  [OptionalProps]?: 'enabled' | 'retentionDays' | 'kAnonymity' | 'debounceSeconds' | 'individualsEnabled' | 'timeZone' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'retention_days', type: 'integer', default: 365 })
  retentionDays: number = 365

  @Property({ name: 'k_anonymity', type: 'integer', default: 10 })
  kAnonymity: number = 10

  @Property({ name: 'debounce_seconds', type: 'integer', default: 120 })
  debounceSeconds: number = 120

  @Property({ name: 'individuals_enabled', type: 'boolean', default: false })
  individualsEnabled: boolean = false

  @Property({ name: 'time_zone', type: 'text', default: 'UTC' })
  timeZone: string = 'UTC'

  @Property({ name: 'suggestion_min_support', type: 'integer', nullable: true })
  suggestionMinSupport: number | null = null

  @Property({ name: 'conformance_workflow_id', type: 'uuid', nullable: true })
  conformanceWorkflowId: string | null = null

  @Property({ name: 'activity_step_map', type: 'jsonb', nullable: true })
  activityStepMap: Record<string, string> | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

/**
 * A mined automation suggestion of one organization: trigger activity (+ optional condition) →
 * follow-up field change within `window_seconds`, with support, trigger count, Wilson lower
 * bound of the confidence, lift and the number of distinct actors (a count only: no actor ids
 * or pseudonyms are stored). Upserted by `signature_hash`; status changes by users use the
 * optimistic lock on `updated_at`.
 */
@Entity({ tableName: 'insights_automation_suggestions' })
@Unique({ name: 'insights_automation_suggestions_signature_unique', properties: ['tenantId', 'organizationId', 'signatureHash'] })
@Index({ name: 'insights_automation_suggestions_status_idx', properties: ['tenantId', 'organizationId', 'processKey', 'status'] })
export class InsightsAutomationSuggestion {
  [OptionalProps]?: 'status' | 'draftable' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'process_key', type: 'text' })
  processKey!: string

  @Property({ name: 'signature_hash', type: 'text' })
  signatureHash!: string

  @Property({ name: 'trigger_activity_key', type: 'text' })
  triggerActivityKey!: string

  @Property({ name: 'trigger_json', type: 'jsonb' })
  triggerJson!: Record<string, unknown>

  @Property({ name: 'condition_json', type: 'jsonb', nullable: true })
  conditionJson: Record<string, unknown> | null = null

  @Property({ name: 'followups_json', type: 'jsonb' })
  followupsJson!: Record<string, unknown>[]

  @Property({ name: 'window_seconds', type: 'integer' })
  windowSeconds!: number

  @Property({ name: 'support', type: 'integer' })
  support!: number

  @Property({ name: 'trigger_count', type: 'integer' })
  triggerCount!: number

  @Property({ name: 'confidence', type: 'float' })
  confidence!: number

  @Property({ name: 'lift', type: 'float' })
  lift!: number

  @Property({ name: 'distinct_actor_count', type: 'integer' })
  distinctActorCount!: number

  @Property({ name: 'status', type: 'text', default: 'open' })
  status: AutomationSuggestionStatus = 'open'

  @Property({ name: 'draftable', type: 'boolean', default: false })
  draftable: boolean = false

  @Property({ name: 'not_draftable_reason', type: 'text', nullable: true })
  notDraftableReason: string | null = null

  @Property({ name: 'drafted_artifact_id', type: 'uuid', nullable: true })
  draftedArtifactId: string | null = null

  @Property({ name: 'computed_at', type: Date })
  computedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}

export const SIMULATION_RUN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'] as const

export type SimulationRunStatus = (typeof SIMULATION_RUN_STATUSES)[number]

export const SIMULATION_DECISIONS = ['applied', 'discarded'] as const

export type SimulationDecisionValue = (typeof SIMULATION_DECISIONS)[number]

export const SIMULATION_ERROR_CODES = [
  'forbidden',
  'kind_unavailable',
  'statement_timeout',
  'decryption_unavailable',
  'abandoned',
  'internal',
] as const

export type SimulationErrorCode = (typeof SIMULATION_ERROR_CODES)[number]

/**
 * One change-simulation run, private to its requester and bound to exactly one verified
 * organization. `input_json` (the proposal) and `result_json` (the continuation state while
 * queued/running, then the k-suppressed result: aggregates and confirmed sample ids only) are
 * encrypted. The row is immutable once terminal; `updated_at` only moves while queued/running
 * and is the compare-and-set version of every slice write. The partial unique index dedupes
 * active and completed runs by `inputs_hash`; failed and cancelled runs never block a retry.
 */
@Entity({ tableName: 'insights_simulation_runs' })
@Index({
  name: 'insights_simulation_runs_requester_idx',
  expression: 'create index "insights_simulation_runs_requester_idx" on "insights_simulation_runs" ("tenant_id", "organization_id", "requested_by_user_id", "created_at" desc)',
})
@Index({ name: 'insights_simulation_runs_expires_idx', properties: ['expiresAt'] })
@Index({
  name: 'insights_simulation_runs_active_idx',
  expression: 'create index "insights_simulation_runs_active_idx" on "insights_simulation_runs" ("tenant_id", "requested_by_user_id") where "status" in (\'queued\', \'running\')',
})
@Index({
  name: 'insights_simulation_runs_dedupe_unique',
  expression: 'create unique index "insights_simulation_runs_dedupe_unique" on "insights_simulation_runs" ("tenant_id", "organization_id", "kind", "inputs_hash") where "status" in (\'queued\', \'running\', \'completed\')',
})
export class InsightsSimulationRun {
  [OptionalProps]?: 'status' | 'caveats' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: string

  @Property({ name: 'status', type: 'text', default: 'queued' })
  status: SimulationRunStatus = 'queued'

  @Property({ name: 'progress_job_id', type: 'uuid', nullable: true })
  progressJobId: string | null = null

  @Property({ name: 'requested_by_user_id', type: 'uuid' })
  requestedByUserId!: string

  @Property({ name: 'input_json', type: 'jsonb' })
  inputJson!: unknown

  @Property({ name: 'inputs_hash', type: 'text' })
  inputsHash!: string

  @Property({ name: 'artifact_kind', type: 'text' })
  artifactKind!: string

  @Property({ name: 'artifact_id', type: 'text', nullable: true })
  artifactId: string | null = null

  @Property({ name: 'artifact_version_json', type: 'jsonb', nullable: true })
  artifactVersionJson: { updatedAt: string | null; fingerprint: string | null } | null = null

  @Property({ name: 'proposal_fingerprint', type: 'text' })
  proposalFingerprint!: string

  @Property({ name: 'window_from', type: Date })
  windowFrom!: Date

  @Property({ name: 'window_to', type: Date })
  windowTo!: Date

  @Property({ name: 'budgets_json', type: 'jsonb' })
  budgetsJson!: Record<string, unknown>

  @Property({ name: 'fidelity', type: 'text', nullable: true })
  fidelity: string | null = null

  @Property({ name: 'coverage_json', type: 'jsonb', nullable: true })
  coverageJson: Record<string, number> | null = null

  @Property({ name: 'result_json', type: 'jsonb', nullable: true })
  resultJson: unknown = null

  @Property({ name: 'caveats', type: 'jsonb', default: '[]' })
  caveats: string[] = []

  @Property({ name: 'engine_version', type: 'integer' })
  engineVersion!: number

  @Property({ name: 'contribution_version', type: 'integer' })
  contributionVersion!: number

  @Property({ name: 'error_code', type: 'text', nullable: true })
  errorCode: SimulationErrorCode | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt: Date | null = null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt: Date | null = null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * An append-only decision on a completed simulation run (`applied` or `discarded`). Tenant and
 * organization are copied from the run; `artifact_updated_at_after` and `verified` are set by the
 * server from the live artifact (S15). There is no FK to the run, so decisions outlive the run
 * purge (retained 13 months); `decided_by_user_id` is rewritten to an `erased:<uuid>` token when
 * the user is deleted.
 */
@Entity({ tableName: 'insights_simulation_decisions' })
@Unique({ name: 'insights_simulation_decisions_run_decision_unique', properties: ['runId', 'decision'] })
@Index({ name: 'insights_simulation_decisions_decider_idx', properties: ['tenantId', 'decidedByUserId'] })
@Index({ name: 'insights_simulation_decisions_created_idx', properties: ['createdAt'] })
export class InsightsSimulationDecision {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Property({ name: 'decision', type: 'text' })
  decision!: SimulationDecisionValue

  @Property({ name: 'decided_by_user_id', type: 'text' })
  decidedByUserId!: string

  @Property({ name: 'artifact_kind', type: 'text' })
  artifactKind!: string

  @Property({ name: 'artifact_id', type: 'text', nullable: true })
  artifactId: string | null = null

  @Property({ name: 'artifact_updated_at_after', type: Date, nullable: true })
  artifactUpdatedAtAfter: Date | null = null

  @Property({ name: 'verified', type: 'boolean', nullable: true })
  verified: boolean | null = null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
