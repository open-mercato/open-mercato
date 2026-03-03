import { Entity, PrimaryKey, Property, Index, ManyToOne, Unique } from '@mikro-orm/core'

export type AgentAutonomyMode = 'propose' | 'assist' | 'auto'
export type AgentRiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type AgentRunStatus = 'queued' | 'running' | 'checkpoint' | 'paused' | 'failed' | 'completed' | 'terminated'
export type AgentRunStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
export type AgentApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'
export type AgentDecisionControlPath = 'auto' | 'checkpoint' | 'override' | 'rejected'
export type AgentDecisionStatus = 'success' | 'failed' | 'blocked'
export type AgentSkillStatus = 'draft' | 'validated' | 'active' | 'deprecated'
export type AgentSkillSourceType = 'interview' | 'trace_mining' | 'hybrid'

@Entity({ tableName: 'agent_governance_policies' })
@Index({ name: 'agent_governance_policies_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'agent_governance_policies_scope_name_unique', properties: ['tenantId', 'organizationId', 'name'] })
export class AgentGovernancePolicy {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'default_mode', type: 'text', default: 'propose' })
  defaultMode: AgentAutonomyMode = 'propose'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'agent_governance_risk_bands' })
@Index({ name: 'agent_governance_risk_bands_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'agent_governance_risk_bands_scope_name_unique', properties: ['tenantId', 'organizationId', 'name'] })
export class AgentGovernanceRiskBand {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'risk_level', type: 'text' })
  riskLevel!: AgentRiskLevel

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval: boolean = false

  @Property({ name: 'fail_closed', type: 'boolean', default: false })
  failClosed: boolean = false

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'min_score', type: 'int', default: 0 })
  minScore: number = 0

  @Property({ name: 'max_score', type: 'int', default: 100 })
  maxScore: number = 100

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'agent_governance_playbooks' })
@Index({ name: 'agent_governance_playbooks_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'agent_governance_playbooks_scope_name_unique', properties: ['tenantId', 'organizationId', 'name'] })
export class AgentGovernancePlaybook {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'policy_id', type: 'uuid', nullable: true })
  policyId?: string | null

  @Property({ name: 'risk_band_id', type: 'uuid', nullable: true })
  riskBandId?: string | null

  @Property({ name: 'trigger_type', type: 'text', default: 'manual' })
  triggerType: 'manual' | 'scheduled' = 'manual'

  @Property({ name: 'schedule_cron', type: 'text', nullable: true })
  scheduleCron?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'agent_governance_runs' })
@Index({ name: 'agent_governance_runs_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_runs_status_idx', properties: ['status', 'createdAt'] })
@Unique({
  name: 'agent_governance_runs_scope_idempotency_key_unique',
  properties: ['tenantId', 'organizationId', 'idempotencyKey'],
})
export class AgentGovernanceRun {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'playbook_id', type: 'uuid', nullable: true })
  playbookId?: string | null

  @Property({ name: 'policy_id', type: 'uuid', nullable: true })
  policyId?: string | null

  @Property({ name: 'risk_band_id', type: 'uuid', nullable: true })
  riskBandId?: string | null

  @Property({ type: 'text' })
  status: AgentRunStatus = 'queued'

  @Property({ name: 'autonomy_mode', type: 'text' })
  autonomyMode: AgentAutonomyMode = 'propose'

  @Property({ name: 'action_type', type: 'text' })
  actionType!: string

  @Property({ name: 'target_entity', type: 'text' })
  targetEntity!: string

  @Property({ name: 'target_id', type: 'text', nullable: true })
  targetId?: string | null

  @Property({ name: 'input_context', type: 'jsonb', nullable: true })
  inputContext?: Record<string, unknown> | null

  @Property({ name: 'output_summary', type: 'text', nullable: true })
  outputSummary?: string | null

  @Property({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey?: string | null

  @Property({ name: 'pause_reason', type: 'text', nullable: true })
  pauseReason?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'failed_at', type: Date, nullable: true })
  failedAt?: Date | null

  @Property({ name: 'terminated_at', type: Date, nullable: true })
  terminatedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_run_steps' })
@Index({ name: 'agent_governance_run_steps_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_run_steps_run_idx', properties: ['run', 'sequenceNo'] })
@Unique({ name: 'agent_governance_run_steps_run_seq_unique', properties: ['run', 'sequenceNo'] })
export class AgentGovernanceRunStep {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => AgentGovernanceRun, { fieldName: 'run_id' })
  run!: AgentGovernanceRun

  @Property({ name: 'sequence_no', type: 'int' })
  sequenceNo!: number

  @Property({ name: 'action_type', type: 'text' })
  actionType!: string

  @Property({ name: 'tool_name', type: 'text', nullable: true })
  toolName?: string | null

  @Property({ name: 'is_irreversible', type: 'boolean', default: false })
  isIrreversible: boolean = false

  @Property({ type: 'text', default: 'pending' })
  status: AgentRunStepStatus = 'pending'

  @Property({ name: 'input_json', type: 'jsonb', nullable: true })
  inputJson?: Record<string, unknown> | null

  @Property({ name: 'output_json', type: 'jsonb', nullable: true })
  outputJson?: Record<string, unknown> | null

  @Property({ name: 'error_code', type: 'text', nullable: true })
  errorCode?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_decision_events' })
@Index({ name: 'agent_governance_decision_events_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_decision_events_run_idx', properties: ['runId', 'createdAt'] })
@Index({ name: 'agent_governance_decision_events_signature_idx', properties: ['signature', 'createdAt'] })
@Unique({ name: 'agent_governance_decision_events_hash_unique', properties: ['immutableHash'] })
export class AgentGovernanceDecisionEvent {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'run_id', type: 'uuid', nullable: true })
  runId?: string | null

  @Property({ name: 'step_id', type: 'text', nullable: true })
  stepId?: string | null

  @Property({ name: 'action_type', type: 'text' })
  actionType!: string

  @Property({ name: 'target_entity', type: 'text' })
  targetEntity!: string

  @Property({ name: 'target_id', type: 'text', nullable: true })
  targetId?: string | null

  @Property({ name: 'policy_id', type: 'uuid', nullable: true })
  policyId?: string | null

  @Property({ name: 'risk_band_id', type: 'uuid', nullable: true })
  riskBandId?: string | null

  @Property({ name: 'risk_score', type: 'int', nullable: true })
  riskScore?: number | null

  @Property({ name: 'control_path', type: 'text' })
  controlPath!: AgentDecisionControlPath

  @Property({ name: 'input_evidence', type: 'jsonb' })
  inputEvidence: string[] = []

  @Property({ name: 'approver_ids', type: 'jsonb' })
  approverIds: string[] = []

  @Property({ name: 'exception_ids', type: 'jsonb' })
  exceptionIds: string[] = []

  @Property({ name: 'write_set', type: 'jsonb', nullable: true })
  writeSet?: Record<string, unknown> | null

  @Property({ type: 'text' })
  status!: AgentDecisionStatus

  @Property({ name: 'error_code', type: 'text', nullable: true })
  errorCode?: string | null

  @Property({ name: 'harness_provider', type: 'text', nullable: true })
  harnessProvider?: string | null

  @Property({ name: 'immutable_hash', type: 'text' })
  immutableHash!: string

  @Property({ name: 'supersedes_event_id', type: 'uuid', nullable: true })
  supersedesEventId?: string | null

  @Property({ type: 'text', nullable: true })
  signature?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_approval_tasks' })
@Index({ name: 'agent_governance_approval_tasks_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_approval_tasks_status_idx', properties: ['status', 'createdAt'] })
@Unique({
  name: 'agent_governance_approval_tasks_scope_resolution_idempotency_unique',
  properties: ['tenantId', 'organizationId', 'resolutionIdempotencyKey'],
})
export class AgentGovernanceApprovalTask {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => AgentGovernanceRun, { fieldName: 'run_id' })
  run!: AgentGovernanceRun

  @Property({ name: 'decision_event_id', type: 'uuid', nullable: true })
  decisionEventId?: string | null

  @Property({ type: 'text' })
  status: AgentApprovalStatus = 'pending'

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'reviewer_user_id', type: 'uuid', nullable: true })
  reviewerUserId?: string | null

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'review_comment', type: 'text', nullable: true })
  reviewComment?: string | null

  @Property({ name: 'resolution_idempotency_key', type: 'text', nullable: true })
  resolutionIdempotencyKey?: string | null

  @Property({ name: 'requested_at', type: Date })
  requestedAt: Date = new Date()

  @Property({ name: 'reviewed_at', type: Date, nullable: true })
  reviewedAt?: Date | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_decision_entity_links' })
@Index({ name: 'agent_governance_decision_entity_links_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_decision_entity_links_entity_idx', properties: ['entityType', 'entityId'] })
export class AgentGovernanceDecisionEntityLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => AgentGovernanceDecisionEvent, { fieldName: 'decision_event_id' })
  decisionEvent!: AgentGovernanceDecisionEvent

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'text' })
  entityId!: string

  @Property({ name: 'relationship_type', type: 'text' })
  relationshipType!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_decision_why_links' })
@Index({ name: 'agent_governance_decision_why_links_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_decision_why_links_reason_idx', properties: ['reasonType', 'refId'] })
export class AgentGovernanceDecisionWhyLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => AgentGovernanceDecisionEvent, { fieldName: 'decision_event_id' })
  decisionEvent!: AgentGovernanceDecisionEvent

  @Property({ name: 'reason_type', type: 'text' })
  reasonType!: 'policy' | 'precedent' | 'exception' | 'human_override' | 'other'

  @Property({ name: 'ref_id', type: 'text', nullable: true })
  refId?: string | null

  @Property({ type: 'text', nullable: true })
  summary?: string | null

  @Property({ type: 'float', nullable: true })
  confidence?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_precedent_index' })
@Index({ name: 'agent_governance_precedent_index_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_precedent_index_signature_idx', properties: ['signature', 'score'] })
export class AgentGovernancePrecedentIndex {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'decision_event_id', type: 'uuid' })
  decisionEventId!: string

  @Property({ type: 'text' })
  signature!: string

  @Property({ type: 'text', nullable: true })
  summary?: string | null

  @Property({ type: 'float', default: 0 })
  score: number = 0

  @Property({ type: 'text', nullable: true })
  checksum?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'agent_governance_skills' })
@Index({ name: 'agent_governance_skills_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ name: 'agent_governance_skills_scope_name_unique', properties: ['tenantId', 'organizationId', 'name'] })
export class AgentGovernanceSkill {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', default: 'draft' })
  status: AgentSkillStatus = 'draft'

  @Property({ name: 'framework_json', type: 'jsonb', nullable: true })
  frameworkJson?: Record<string, unknown> | null

  @Property({ name: 'source_type', type: 'text', default: 'hybrid' })
  sourceType: AgentSkillSourceType = 'hybrid'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'agent_governance_skill_versions' })
@Index({ name: 'agent_governance_skill_versions_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'agent_governance_skill_versions_skill_idx', properties: ['skill', 'versionNo'] })
@Unique({ name: 'agent_governance_skill_versions_skill_version_unique', properties: ['skill', 'versionNo'] })
@Unique({
  name: 'agent_governance_skill_versions_scope_promotion_idempotency_unique',
  properties: ['tenantId', 'organizationId', 'promotionIdempotencyKey'],
})
export class AgentGovernanceSkillVersion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @ManyToOne(() => AgentGovernanceSkill, { fieldName: 'skill_id' })
  skill!: AgentGovernanceSkill

  @Property({ name: 'version_no', type: 'int' })
  versionNo!: number

  @Property({ name: 'diff_json', type: 'jsonb', nullable: true })
  diffJson?: Record<string, unknown> | null

  @Property({ name: 'validation_report_json', type: 'jsonb', nullable: true })
  validationReportJson?: Record<string, unknown> | null

  @Property({ name: 'promoted_by_user_id', type: 'uuid', nullable: true })
  promotedByUserId?: string | null

  @Property({ name: 'promotion_idempotency_key', type: 'text', nullable: true })
  promotionIdempotencyKey?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
