import { BigIntType, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export const PROCESS_CURSOR_STATUSES = ['idle', 'backfilling', 'rebuild_required'] as const

export type ProcessCursorStatus = (typeof PROCESS_CURSOR_STATUSES)[number]

export const PROCESS_SCAN_KINDS = ['backfill', 'reconcile', 'full_reconcile'] as const

export type ProcessScanKind = (typeof PROCESS_SCAN_KINDS)[number]

export const AUTOMATION_SUGGESTION_STATUSES = ['open', 'dismissed', 'drafted', 'superseded'] as const

export type AutomationSuggestionStatus = (typeof AUTOMATION_SUGGESTION_STATUSES)[number]

/**
 * Per-organization ingest state of the Process X-Ray projection. The incremental cursor
 * walks `action_logs` on `(created_at, id)`; the state watermark walks undo/redo state
 * changes on `(updated_at, id)`; the `scan_*` columns hold one resumable range scan
 * (backfill or reconciliation) and `scan_chain_id` the single job chain allowed to advance
 * it. `actor_key_fingerprint` pins the pseudonym key the organization's rows were written
 * under. Every projection write runs under the CAS lease and is fenced by `lease_token`,
 * which only ever increases.
 */
@Entity({ tableName: 'insights_process_cursors' })
@Unique({ name: 'insights_process_cursors_scope_unique', properties: ['tenantId', 'organizationId'] })
export class InsightsProcessCursor {
  [OptionalProps]?: 'status' | 'leaseToken' | 'scanProcessedCount' | 'createdAt' | 'updatedAt'

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

  @Property({ name: 'contract_hash', type: 'text', nullable: true })
  contractHash: string | null = null

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
  [OptionalProps]?: 'enabled' | 'retentionDays' | 'kAnonymity' | 'debounceSeconds' | 'individualsEnabled' | 'createdAt' | 'updatedAt'

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

/** Mined automation suggestions (Phase 6 writes them; status changes use the optimistic lock). */
@Entity({ tableName: 'insights_automation_suggestions' })
@Unique({ name: 'insights_automation_suggestions_signature_unique', properties: ['tenantId', 'organizationId', 'signatureHash'] })
@Index({ name: 'insights_automation_suggestions_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
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

  @Property({ name: 'trigger_json', type: 'jsonb' })
  triggerJson!: Record<string, unknown>

  @Property({ name: 'condition_json', type: 'jsonb', nullable: true })
  conditionJson: Record<string, unknown> | null = null

  @Property({ name: 'followups_json', type: 'jsonb' })
  followupsJson!: Record<string, unknown>[]

  @Property({ name: 'support', type: 'integer' })
  support!: number

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

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date(), nullable: true })
  updatedAt: Date | null = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt: Date | null = null
}
