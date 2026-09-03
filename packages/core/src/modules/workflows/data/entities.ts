/**
 * Workflows Module - Database Entities
 *
 * MikroORM entities for workflow engine.
 */

import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type { WorkflowRunOutcome } from '../lib/run-outcome'

export type { WorkflowRunOutcome }

// ============================================================================
// Type Definitions
// ============================================================================

export type WorkflowStepType =
  | 'START'
  | 'END'
  | 'USER_TASK'
  | 'AUTOMATED'
  | 'PARALLEL_FORK'
  | 'PARALLEL_JOIN'
  | 'SUB_WORKFLOW'
  | 'WAIT_FOR_SIGNAL'
  | 'WAIT_FOR_TIMER'
  | 'WAIT_FOR_CONDITION'
  | 'IF_ELSE'
  | 'SWITCH'

export type WorkflowInstanceStatus =
  | 'RUNNING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'WAITING_FOR_ACTIVITIES'
  | 'FORKED'

export type WorkflowBranchInstanceStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'WAITING_FOR_ACTIVITIES'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'

export type StepInstanceStatus =
  | 'PENDING'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'SKIPPED'
  | 'CANCELLED'

export type UserTaskStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'ESCALATED'

/**
 * Which principal namespace `user_tasks.assigned_to` names.
 *
 * `'user'` = a backoffice user id. `'customer'` = a portal principal
 * (`CustomerAuthContext.sub`). A discriminator column rather than a
 * `customer:<id>` string prefix (maintainer decision): a prefix is unindexable,
 * collides with any id containing a colon, and would force a parsing rule into
 * every existing comparison — the claim filter, the `myWork` `$or`, the
 * reassign write.
 */
export type UserTaskAssigneeKind = 'user' | 'customer'

// ============================================================================
// Event Trigger Types
// ============================================================================

export type TriggerFilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'in'
  | 'notIn'
  | 'exists'
  | 'notExists'
  | 'regex'

export interface TriggerFilterCondition {
  field: string // JSON path (e.g., "status", "metadata.type")
  operator: TriggerFilterOperator
  value: unknown
}

export interface TriggerContextMapping {
  targetKey: string // Key in workflow initial context
  sourceExpression: string // Path from event payload (supports dot notation)
  defaultValue?: unknown
}

export interface WorkflowEventTriggerConfig {
  filterConditions?: TriggerFilterCondition[]
  contextMapping?: TriggerContextMapping[]
  debounceMs?: number // Debounce rapid events
  maxConcurrentInstances?: number // Limit concurrent instances
  entityType?: string // Entity type for workflow instance metadata (e.g., "SalesOrder")
}

/**
 * WorkflowDefinitionTrigger - Embedded trigger configuration
 *
 * Triggers are now embedded directly in the workflow definition,
 * allowing users to configure event-based workflow starts during
 * workflow creation in the visual editor.
 */
export interface WorkflowDefinitionTrigger {
  triggerId: string
  name: string
  description?: string | null
  eventPattern: string // e.g., "sales.orders.created", "customers.*"
  config?: WorkflowEventTriggerConfig | null
  enabled: boolean
  priority: number
}

// ============================================================================
// JSONB Structure Interfaces
// ============================================================================

export interface WorkflowContextSchemaField {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'date'
  label?: string
  required?: boolean
  options?: string[]
}

export interface WorkflowContextSchema {
  input?: {
    fields: WorkflowContextSchemaField[]
  }
}

export interface WorkflowIoPortField {
  name: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'date'
  label: string
  required?: boolean
  options?: string[]
}

export interface WorkflowIoContract {
  inputs?: WorkflowIoPortField[]
  outputs?: WorkflowIoPortField[]
}

export interface WorkflowErrorHandlerData {
  workflowId?: string
  version?: number
  stepId?: string
}

export interface WorkflowDefinitionData {
  steps: any[] // WorkflowStep[] - will define schema in validators.ts
  transitions: any[] // WorkflowTransition[] - will define schema in validators.ts
  triggers?: WorkflowDefinitionTrigger[] // Event triggers for automatic workflow start
  contextSchema?: WorkflowContextSchema // Declared typed-input contract (spec §3.1) — canonical input contract
  io?: WorkflowIoContract // Sub-workflow port contract; io.inputs is a read-through alias of contextSchema.input
  interpolation?: 'strict' | 'lenient' // Interpolation mode (spec §3.6): absent = lenient; create path defaults new definitions to 'strict'
  errorHandler?: WorkflowErrorHandlerData // Catch-all error handler (spec §5.9): a handler workflow OR a handler step, never both
  activities?: any[] // ActivityDefinition[] - will define schema in validators.ts
  queries?: any[]
  signals?: any[]
  timers?: any[]
}

export interface WorkflowSampleEnvelope {
  pinnedAt: string
  source: 'manual' | 'test'
  data: unknown
}

export interface WorkflowEditorMetadata {
  samples?: Record<string, WorkflowSampleEnvelope>
  [key: string]: unknown
}

export interface WorkflowMetadata {
  tags?: string[]
  category?: string
  icon?: string
  // Forward-compatibility guard (spec section 5.8): the lowest engine version
  // able to execute this definition. Engines older than the declared version
  // refuse to instantiate it instead of misexecuting unknown capabilities.
  minEngineVersion?: number
  editor?: WorkflowEditorMetadata
}

/**
 * Failure-queue park marker (spec 5.9 "Send to failure queue"). Written when a
 * step's `failureQueue` error directive parks the instance instead of failing
 * it; the instances list filters on it (`?attention=true`) and the Phase 5
 * triage UI consumes it. Additive and engine-owned — never user-writable.
 */
export interface WorkflowInstanceAttention {
  reason: string
  stepId?: string
  error?: string
  at: string
}

/**
 * Recursion marker for the workflow-level error handler (spec 5.9). Engine-owned
 * and durable — deliberately NOT in `context`, which the context PATCH API lets
 * callers write, so the guard cannot be spoofed away.
 */
export interface WorkflowInstanceErrorHandlerMetadata {
  depth: number
  forInstanceId?: string
  forStepId?: string
}

import type { WorkflowInstanceStepThrough } from '../lib/step-through'

export interface WorkflowInstanceMetadata {
  entityType?: string
  entityId?: string
  initiatedBy?: string
  labels?: Record<string, string>
  attention?: WorkflowInstanceAttention | null
  errorHandler?: WorkflowInstanceErrorHandlerMetadata | null
  /**
   * Step-through release token (spec section 8.2). Engine-owned and never
   * user-writable: the start route sets it from a feature-gated flag and the
   * step-through route advances it, so a client cannot release a step by
   * writing metadata directly. See `lib/step-through.ts`.
   */
  stepThrough?: WorkflowInstanceStepThrough | null
}

// ============================================================================
// Entity: WorkflowDefinition
// ============================================================================

/**
 * WorkflowDefinition entity
 *
 * Stores workflow definitions (templates) that can be instantiated
 * to create workflow instances.
 */
@Entity({ tableName: 'workflow_definitions' })
// Versions of the same workflow coexist as separate rows; uniqueness is per
// (workflowId, version, tenantId) so draft/published versions can live together.
@Unique({ properties: ['workflowId', 'version', 'tenantId'] })
@Index({ name: 'workflow_definitions_enabled_idx', properties: ['enabled'] })
@Index({ name: 'workflow_definitions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'workflow_definitions_workflow_id_idx', properties: ['workflowId'] })
@Index({ name: 'workflow_definitions_kind_idx', properties: ['kind'] })
@Index({ name: 'workflow_definitions_definition_gin_idx', properties: ['definition'], type: 'gin' })
export class WorkflowDefinition {
  [OptionalProps]?: 'enabled' | 'version' | 'kind' | 'lifecycle' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'codeWorkflowId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string

  @Property({ name: 'code_workflow_id', type: 'varchar', length: 100, nullable: true })
  codeWorkflowId?: string | null

  @Property({ name: 'workflow_name', type: 'varchar', length: 255 })
  workflowName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'version', type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'definition', type: 'jsonb' })
  definition!: WorkflowDefinitionData

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: WorkflowMetadata | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  // Distinguishes a reusable library component (no trigger, not standalone-
  // startable, callable only as a SUB_WORKFLOW) from a normal workflow.
  @Property({ name: 'kind', type: 'varchar', length: 20, default: 'workflow' })
  kind: 'workflow' | 'component' = 'workflow'

  // Draft/published version lifecycle. Existing rows backfill to 'published';
  // the publish flow + version coexistence land with the versioning phase.
  @Property({ name: 'lifecycle', type: 'varchar', length: 20, default: 'published' })
  lifecycle: 'draft' | 'published' | 'archived' = 'published'

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /**
   * The least-privilege ACL features every run of THIS version executes with.
   *
   * Null/empty (the default, and every pre-existing row) keeps the historic
   * behaviour: the run borrows the identity of whoever started it. A non-empty
   * grant makes the run act as its own `auth` execution principal instead —
   * always, regardless of who started it — so it can neither inherit an admin's
   * powers nor be left without an actor when an event trigger starts it.
   *
   * A real column rather than a `metadata` key because it is a security
   * boundary: it is read on every advance, written only through the
   * `workflows.definitions.grant_features` gate, and must be diffable in an
   * audit. Per version by construction — a published version is a new row.
   */
  @Property({ name: 'granted_features', type: 'jsonb', nullable: true })
  grantedFeatures?: string[] | null

  @Property({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: WorkflowDefinitionDraft
// ============================================================================

/**
 * WorkflowDefinitionDraft entity
 *
 * Per-user autosaved editor drafts for workflow definitions. A draft may
 * reference an existing definition (definitionId set) or a not-yet-saved one
 * (definitionId null). baseUpdatedAt captures the definition's updatedAt the
 * draft forked from, enabling conflict-aware restore messaging.
 */
@Entity({ tableName: 'workflow_definition_drafts' })
@Unique({ properties: ['definitionId', 'userId', 'tenantId'] })
@Index({ name: 'workflow_definition_drafts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowDefinitionDraft {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'definition_id', type: 'uuid', nullable: true })
  definitionId?: string | null

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'definition', type: 'jsonb' })
  definition!: WorkflowDefinitionData

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: WorkflowMetadata | null

  @Property({ name: 'base_updated_at', type: Date, nullable: true })
  baseUpdatedAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: WorkflowInstance
// ============================================================================

/**
 * WorkflowInstance entity
 *
 * Represents a running instance of a workflow definition.
 * Tracks the current state, context data, and execution status.
 */
@Entity({ tableName: 'workflow_instances' })
@Index({ name: 'workflow_instances_definition_status_idx', properties: ['definitionId', 'status'] })
@Index({ name: 'workflow_instances_correlation_key_idx', properties: ['correlationKey'] })
@Index({ name: 'workflow_instances_status_tenant_idx', properties: ['status', 'tenantId'] })
@Index({ name: 'workflow_instances_current_step_idx', properties: ['currentStepId', 'status'] })
@Index({ name: 'workflow_instances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowInstance {
  [OptionalProps]?: 'retryCount' | 'isDryRun' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'definition_id', type: 'uuid' })
  definitionId!: string

  @Property({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string

  @Property({ name: 'version', type: 'integer' })
  version!: number

  @Property({ name: 'status', type: 'varchar', length: 30 })
  status!: WorkflowInstanceStatus

  /**
   * Terminal VERDICT, written once when the run terminates and null while it is
   * still going (`lib/run-outcome.ts` owns the vocabulary and the decision).
   *
   * Additive and nullable ON PURPOSE: `status` keeps meaning exactly what every
   * existing consumer, filter and subscriber already believes it means, and a
   * null on a pre-existing row means "ran before outcomes existed" — never
   * "success". Nothing is backfilled: a fabricated verdict would be the same
   * dishonesty this column exists to remove, pointed the other way.
   */
  @Property({ name: 'outcome', type: 'varchar', length: 30, nullable: true })
  outcome?: WorkflowRunOutcome | null

  @Property({ name: 'current_step_id', type: 'varchar', length: 100 })
  currentStepId!: string

  @Property({ name: 'context', type: 'jsonb' })
  context!: Record<string, any>

  @Property({ name: 'correlation_key', type: 'varchar', length: 255, nullable: true })
  correlationKey?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: WorkflowInstanceMetadata | null

  @Property({ name: 'started_at', type: Date })
  startedAt!: Date

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'paused_at', type: Date, nullable: true })
  pausedAt?: Date | null

  @Property({ name: 'cancelled_at', type: Date, nullable: true })
  cancelledAt?: Date | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails?: any | null

  @Property({ name: 'pending_transition', type: 'jsonb', nullable: true })
  pendingTransition?: {
    toStepId: string
    activityResults: any[]
    timestamp: Date
  } | null

  // When the instance is FORKED, points at the open PARALLEL_FORK step whose
  // branches are currently executing. Null for single-token instances.
  @Property({ name: 'active_fork_step_id', type: 'varchar', length: 100, nullable: true })
  activeForkStepId?: string | null

  @Property({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number = 0

  /**
   * Marks the run as a side-effect-free simulation (spec section 8.2).
   *
   * It is a COLUMN rather than a metadata key because every isolation decision
   * reads it — the activity dispatcher, the USER_TASK handler, the business-rule
   * bridge and the list/KPI `where` builders — and a jsonb path predicate in a
   * hot filter is both slower and easy to forget. It is written once at start
   * and never mutated, so a run cannot change what it is halfway through.
   */
  @Property({ name: 'is_dry_run', type: 'boolean', default: false })
  isDryRun: boolean = false

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: WorkflowBranchInstance
// ============================================================================

/**
 * WorkflowBranchInstance entity
 *
 * A single parallel branch token created by a PARALLEL_FORK step. Each branch
 * advances independently (interleaved under the instance lock) with its own
 * private context namespace, and converges to the paired PARALLEL_JOIN step.
 * Branches are tenant/org scoped and never cross-tenant.
 */
@Entity({ tableName: 'workflow_branch_instances' })
@Index({ name: 'workflow_branch_instances_instance_status_idx', properties: ['workflowInstanceId', 'status'] })
@Index({ name: 'workflow_branch_instances_instance_fork_idx', properties: ['workflowInstanceId', 'forkStepId'] })
@Index({ name: 'workflow_branch_instances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowBranchInstance {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'fork_step_id', type: 'varchar', length: 100 })
  forkStepId!: string

  @Property({ name: 'join_step_id', type: 'varchar', length: 100 })
  joinStepId!: string

  // The transitionId of the FORK's outgoing transition that created this branch.
  @Property({ name: 'branch_key', type: 'varchar', length: 100 })
  branchKey!: string

  // Reserved for nested-fork support (always null this iteration; validator blocks nesting).
  @Property({ name: 'parent_branch_id', type: 'uuid', nullable: true })
  parentBranchId?: string | null

  @Property({ name: 'current_step_id', type: 'varchar', length: 100 })
  currentStepId!: string

  @Property({ name: 'status', type: 'varchar', length: 30 })
  status!: WorkflowBranchInstanceStatus

  // The branch's private write scope; merged back into instance.context at JOIN.
  @Property({ name: 'context_namespace', type: 'jsonb' })
  contextNamespace!: Record<string, any>

  // Per-branch equivalent of WorkflowInstance.pendingTransition (async activities).
  @Property({ name: 'pending_transition', type: 'jsonb', nullable: true })
  pendingTransition?: {
    toStepId: string
    activityResults: any[]
    timestamp: Date
  } | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'error_details', type: 'jsonb', nullable: true })
  errorDetails?: any | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ============================================================================
// Entity: StepInstance
// ============================================================================

/**
 * StepInstance entity
 *
 * Tracks individual step executions within a workflow instance.
 * Records input/output data, timing, and execution status for each step.
 */
@Entity({ tableName: 'step_instances' })
@Index({ name: 'step_instances_workflow_instance_idx', properties: ['workflowInstanceId', 'status'] })
@Index({ name: 'step_instances_step_id_idx', properties: ['stepId', 'status'] })
@Index({ name: 'step_instances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class StepInstance {
  [OptionalProps]?: 'retryCount' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  // Set when this step executes inside a parallel branch; null for single-token.
  @Property({ name: 'branch_instance_id', type: 'uuid', nullable: true })
  branchInstanceId?: string | null

  @Property({ name: 'step_id', type: 'varchar', length: 100 })
  stepId!: string

  @Property({ name: 'step_name', type: 'varchar', length: 255 })
  stepName!: string

  @Property({ name: 'step_type', type: 'varchar', length: 50 })
  stepType!: string

  @Property({ name: 'status', type: 'varchar', length: 20 })
  status!: StepInstanceStatus

  @Property({ name: 'input_data', type: 'jsonb', nullable: true })
  inputData?: any | null

  @Property({ name: 'output_data', type: 'jsonb', nullable: true })
  outputData?: any | null

  @Property({ name: 'error_data', type: 'jsonb', nullable: true })
  errorData?: any | null

  @Property({ name: 'entered_at', type: Date, nullable: true })
  enteredAt?: Date | null

  @Property({ name: 'exited_at', type: Date, nullable: true })
  exitedAt?: Date | null

  @Property({ name: 'execution_time_ms', type: 'integer', nullable: true })
  executionTimeMs?: number | null

  @Property({ name: 'retry_count', type: 'integer', default: 0 })
  retryCount: number = 0

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ============================================================================
// Entity: UserTask
// ============================================================================

/**
 * UserTask entity
 *
 * Represents user tasks that require human interaction within a workflow.
 * Tracks assignment, SLA, escalation, and completion status.
 */
@Entity({ tableName: 'user_tasks' })
@Index({ name: 'user_tasks_workflow_instance_idx', properties: ['workflowInstanceId'] })
@Index({ name: 'user_tasks_status_assigned_idx', properties: ['status', 'assignedTo'] })
@Index({ name: 'user_tasks_status_due_date_idx', properties: ['status', 'dueDate'] })
@Index({ name: 'user_tasks_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
// The §6.4 entity gate is "no binding whose type is outside my allowed set",
// which is a containment test over `entity_types` — so it must be a SQL WHERE,
// not a JS post-filter. Post-filtering a page makes `pagination.total` a lie and
// returns short pages. GIN is what makes `<@` indexable.
@Index({ name: 'user_tasks_entity_types_gin_idx', properties: ['entityTypes'], type: 'gin' })
export class UserTask {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'assigneeKind'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'step_instance_id', type: 'uuid' })
  stepInstanceId!: string

  // Set when this task belongs to a parallel branch; null for single-token instances.
  @Property({ name: 'branch_instance_id', type: 'uuid', nullable: true })
  branchInstanceId?: string | null

  @Property({ name: 'task_name', type: 'varchar', length: 255 })
  taskName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'varchar', length: 20 })
  status!: UserTaskStatus

  @Property({ name: 'form_schema', type: 'jsonb', nullable: true })
  formSchema?: any | null

  @Property({ name: 'form_data', type: 'jsonb', nullable: true })
  formData?: any | null

  @Property({ name: 'assigned_to', type: 'varchar', length: 255, nullable: true })
  assignedTo?: string | null

  /**
   * Which principal namespace `assignedTo` names.
   *
   * NOT NULL with a default rather than nullable: the column exists precisely to
   * remove ambiguity, and reintroducing a null case defeats it. Existing rows
   * backfill to `'user'`, which is correct — every `assigned_to` written before
   * this column existed is a backoffice user id. Rows with `assigned_to IS NULL`
   * also get `'user'`; harmless, because every branch that reads it first checks
   * that `assignedTo` is set.
   *
   * `assignedToRoles` is never combined with `'customer'`: portal roles are a
   * different namespace (`CustomerRole`) and portal principals cannot claim from
   * a queue.
   */
  @Property({ name: 'assignee_kind', type: 'varchar', length: 20, default: 'user' })
  assigneeKind: UserTaskAssigneeKind = 'user'

  @Property({ name: 'assigned_to_roles', type: 'text[]', nullable: true })
  assignedToRoles?: string[] | null

  @Property({ name: 'claimed_by', type: 'varchar', length: 255, nullable: true })
  claimedBy?: string | null

  @Property({ name: 'claimed_at', type: Date, nullable: true })
  claimedAt?: Date | null

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'escalated_at', type: Date, nullable: true })
  escalatedAt?: Date | null

  @Property({ name: 'escalated_to', type: 'varchar', length: 255, nullable: true })
  escalatedTo?: string | null

  @Property({ name: 'completed_by', type: 'varchar', length: 255, nullable: true })
  completedBy?: string | null

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'comments', type: 'text', nullable: true })
  comments?: string | null

  /**
   * Records this task is about, resolved from the authored
   * `userTaskConfig.entityBindings` when the task was created.
   *
   * A real column rather than a read of the authored `formSchema` blob: the
   * work inbox, the record-page widget and the §6.4 visibility predicate all
   * need to filter on it, and the authored form schema is the wrong shape and
   * the wrong lifetime for that (it describes the FORM, and re-editing the
   * definition must not retro-change what a running task is about).
   */
  @Property({ name: 'entity_bindings', type: 'jsonb', nullable: true })
  entityBindings?: unknown[] | null

  /**
   * The distinct AUTHORED `entityType` values from `entityBindings`, denormalized
   * so the §6.4 entity gate is expressible as `entity_types <@ ARRAY[allowed]`
   * against a GIN index.
   *
   * Authored verbatim, not normalized to generated entity ids, because the
   * visibility predicate keys its per-request access map on exactly the string
   * the binding carries. Storing a second, normalized spelling here would give
   * the SQL filter and the JS predicate two different notions of "the same type"
   * — and the one place they could disagree is the one place a task goes
   * invisible without a trace.
   *
   * NULL means "no bindings", which is §2.4's vacuous pass for a backoffice
   * principal. Every row written before this column existed is therefore correct
   * by construction — no backfill needed.
   */
  @Property({ name: 'entity_types', type: 'text[]', nullable: true })
  entityTypes?: string[] | null

  /** Authored `low|medium|high|extreme`, mirroring the platform's labels. */
  @Property({ name: 'priority', type: 'varchar', length: 20, nullable: true })
  priority?: string | null

  /**
   * Reassignment audit — who moved this task, when, and why.
   *
   * Deliberately audit columns and not a new `UserTaskStatus` value: a status
   * addition is an Ask-First state-machine change, and the reassigned task is
   * still exactly as pending or in-progress as it was. Mirrors how Phase 3a's
   * failure queue reused `PAUSED` plus a marker.
   */
  @Property({ name: 'reassigned_by', type: 'varchar', length: 255, nullable: true })
  reassignedBy?: string | null

  @Property({ name: 'reassigned_at', type: Date, nullable: true })
  reassignedAt?: Date | null

  @Property({ name: 'reassign_reason', type: 'text', nullable: true })
  reassignReason?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// ============================================================================
// Entity: WorkflowEvent
// ============================================================================

/**
 * WorkflowEvent entity
 *
 * Event sourcing log for workflow execution history.
 * Records all events that occur during workflow execution for audit and replay.
 */
@Entity({ tableName: 'workflow_events' })
@Index({ name: 'workflow_events_instance_occurred_idx', properties: ['workflowInstanceId', 'occurredAt'] })
@Index({ name: 'workflow_events_event_type_idx', properties: ['eventType', 'occurredAt'] })
@Index({ name: 'workflow_events_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkflowEvent {
  @PrimaryKey({ type: 'bigint', autoincrement: true })
  id!: string

  @Property({ name: 'workflow_instance_id', type: 'uuid' })
  workflowInstanceId!: string

  @Property({ name: 'step_instance_id', type: 'uuid', nullable: true })
  stepInstanceId?: string | null

  // Set when the event was logged within a parallel branch; null otherwise.
  @Property({ name: 'branch_instance_id', type: 'uuid', nullable: true })
  branchInstanceId?: string | null

  @Property({ name: 'event_type', type: 'varchar', length: 50 })
  eventType!: string

  @Property({ name: 'event_data', type: 'jsonb' })
  eventData!: any

  @Property({ name: 'occurred_at', type: Date, onCreate: () => new Date() })
  occurredAt: Date = new Date()

  @Property({ name: 'user_id', type: 'varchar', length: 255, nullable: true })
  userId?: string | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string
}

// ============================================================================
// Entity: WorkflowEventTrigger
// ============================================================================

/**
 * WorkflowEventTrigger entity
 *
 * Maps event patterns to workflow definitions for automatic triggering.
 * When a matching event is emitted, the corresponding workflow is started
 * with context mapped from the event payload.
 */
@Entity({ tableName: 'workflow_event_triggers' })
@Index({ name: 'workflow_event_triggers_event_pattern_idx', properties: ['eventPattern', 'enabled'] })
@Index({ name: 'workflow_event_triggers_definition_idx', properties: ['workflowDefinitionId'] })
@Index({ name: 'workflow_event_triggers_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'workflow_event_triggers_enabled_priority_idx', properties: ['enabled', 'priority'] })
export class WorkflowEventTrigger {
  [OptionalProps]?: 'enabled' | 'priority' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'name', type: 'varchar', length: 255 })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'workflow_definition_id', type: 'uuid' })
  workflowDefinitionId!: string

  @Property({ name: 'event_pattern', type: 'varchar', length: 255 })
  eventPattern!: string

  @Property({ name: 'config', type: 'jsonb', nullable: true })
  config?: WorkflowEventTriggerConfig | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'priority', type: 'integer', default: 0 })
  priority: number = 0

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_by', type: 'varchar', length: 255, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ============================================================================
// Entity: WorkflowDefinitionMetricRollup
// ============================================================================

/**
 * WorkflowDefinitionMetricRollup entity (spec §8.5)
 *
 * Precomputed per-definition operational KPIs — runs, success rate, run-duration
 * percentiles and task SLA hit-rate — over the sliding windows an operator reads.
 * Deliberately shaped after `agent_orchestrator`'s `AgentMetricRollup`
 * (tenant/org + logical id + window bounds + `computed_at` + a zod-validated
 * `metrics` jsonb) so the two ops surfaces stay legible side by side. The shape
 * is MIRRORED, never imported: `enterprise` is an optional peer and core must
 * not hard-require it.
 *
 * Two deliberate divergences from that model, both fixing a latent flaw in it:
 *
 * - **`window_key` is its own column and part of the unique key.** The mirrored
 *   table identifies a row by `(org, agent, window_start)` alone, so a 7d window
 *   computed in one pass and a 30d window computed 23 days later can land on the
 *   same `window_start` and silently overwrite each other with metrics for a
 *   different span. Naming the span makes that impossible.
 * - **The unique key is enforced by the DATABASE**, and includes `tenant_id`.
 *   The mirrored writer does a read-then-insert with no constraint behind it, so
 *   two concurrent passes both miss and both insert. Here the recompute-and-
 *   upsert is idempotent because the index says so, not because only one worker
 *   happens to run.
 *
 * Not user-editable: rows are written only by the rollup worker and read only by
 * `api/metrics/definitions`. It therefore carries no `updated_at` and takes the
 * background-job / machine-aggregate exemption from the optimistic-lock rule —
 * there is no edit form, no delete endpoint and no concurrent human writer for a
 * version token to protect. `computed_at` is the freshness stamp readers use.
 *
 * Keyed on `workflow_id` (the logical id, like `AgentMetricRollup.agentId`)
 * rather than on a `workflow_definitions` row id: `WorkflowInstance.workflowId`
 * is already denormalized so no join is needed, and an operator asks how a
 * PROCESS is doing, not how version 3 of it is doing.
 */
@Entity({ tableName: 'workflow_definition_metric_rollups' })
@Unique({
  name: 'workflow_definition_metric_rollups_bucket_uq',
  properties: ['tenantId', 'organizationId', 'workflowId', 'windowKey', 'windowStart'],
})
@Index({
  name: 'workflow_definition_metric_rollups_lookup_idx',
  properties: ['tenantId', 'organizationId', 'workflowId', 'windowKey'],
})
export class WorkflowDefinitionMetricRollup {
  [OptionalProps]?: 'computedAt' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  /** Logical workflow id, mirroring `WorkflowInstance.workflowId`. */
  @Property({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string

  /** Window length this row measures: `24h`, `7d` or `30d`. */
  @Property({ name: 'window_key', type: 'varchar', length: 10 })
  windowKey!: string

  @Property({ name: 'window_start', type: Date })
  windowStart!: Date

  @Property({ name: 'window_end', type: Date })
  windowEnd!: Date

  @Property({ name: 'computed_at', type: Date, onCreate: () => new Date() })
  computedAt: Date = new Date()

  /** Validated by `workflowDefinitionMetricsSchema` on every read. */
  @Property({ name: 'metrics', type: 'jsonb' })
  metrics!: Record<string, unknown>

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// Export all entities as default for MikroORM discovery
export default [
  WorkflowDefinition,
  WorkflowDefinitionDraft,
  WorkflowInstance,
  WorkflowBranchInstance,
  StepInstance,
  UserTask,
  WorkflowEvent,
  WorkflowEventTrigger,
  WorkflowDefinitionMetricRollup,
]
