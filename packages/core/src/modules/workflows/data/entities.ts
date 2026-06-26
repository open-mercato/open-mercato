/**
 * Workflows Module - Database Entities
 *
 * MikroORM entities for workflow engine.
 */

import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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

export interface WorkflowDefinitionData {
  steps: any[] // WorkflowStep[] - will define schema in validators.ts
  transitions: any[] // WorkflowTransition[] - will define schema in validators.ts
  triggers?: WorkflowDefinitionTrigger[] // Event triggers for automatic workflow start
  activities?: any[] // ActivityDefinition[] - will define schema in validators.ts
  queries?: any[]
  signals?: any[]
  timers?: any[]
}

export interface WorkflowMetadata {
  tags?: string[]
  category?: string
  icon?: string
}

export interface WorkflowInstanceMetadata {
  entityType?: string
  entityId?: string
  initiatedBy?: string
  labels?: Record<string, string>
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
  [OptionalProps]?: 'retryCount' | 'createdAt' | 'updatedAt' | 'deletedAt'

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
export class UserTask {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

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

// Export all entities as default for MikroORM discovery
export default [
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowBranchInstance,
  StepInstance,
  UserTask,
  WorkflowEvent,
  WorkflowEventTrigger,
]
