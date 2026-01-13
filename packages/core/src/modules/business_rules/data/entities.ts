import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OptionalProps,
  ManyToOne,
} from '@mikro-orm/core'

export type RuleType = 'GUARD' | 'VALIDATION' | 'CALCULATION' | 'ACTION' | 'ASSIGNMENT'
export type ExecutionResult = 'SUCCESS' | 'FAILURE' | 'ERROR'

/**
 * BusinessRule entity
 *
 * Represents a business rule definition that can be evaluated against data
 * and trigger actions based on conditions.
 */
@Entity({ tableName: 'business_rules' })
@Unique({ properties: ['ruleId', 'tenantId'] })
@Index({ name: 'business_rules_entity_event_idx', properties: ['entityType', 'eventType', 'enabled'] })
@Index({ name: 'business_rules_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'business_rules_type_enabled_idx', properties: ['ruleType', 'enabled', 'priority'] })
export class BusinessRule {
  [OptionalProps]?: 'enabled' | 'priority' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'rule_id', type: 'varchar', length: 50 })
  ruleId!: string

  @Property({ name: 'rule_name', type: 'varchar', length: 200 })
  ruleName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'rule_type', type: 'varchar', length: 20 })
  ruleType!: RuleType

  @Property({ name: 'rule_category', type: 'varchar', length: 50, nullable: true })
  ruleCategory?: string | null

  @Property({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType!: string

  @Property({ name: 'event_type', type: 'varchar', length: 50, nullable: true })
  eventType?: string | null

  @Property({ name: 'condition_expression', type: 'jsonb' })
  conditionExpression!: any

  @Property({ name: 'success_actions', type: 'jsonb', nullable: true })
  successActions?: any | null

  @Property({ name: 'failure_actions', type: 'jsonb', nullable: true })
  failureActions?: any | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'priority', type: 'integer', default: 100 })
  priority: number = 100

  @Property({ name: 'version', type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_by', type: 'varchar', length: 50, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 50, nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * RuleExecutionLog entity
 *
 * Tracks execution history of business rules for audit trail and debugging.
 * Stores input context, output results, and execution metrics.
 */
@Entity({ tableName: 'rule_execution_logs' })
@Index({ name: 'rule_execution_logs_rule_idx', properties: ['rule'] })
@Index({ name: 'rule_execution_logs_entity_idx', properties: ['entityType', 'entityId'] })
@Index({ name: 'rule_execution_logs_result_idx', properties: ['executionResult', 'executedAt'] })
@Index({ name: 'rule_execution_logs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class RuleExecutionLog {
  [OptionalProps]?: 'executedAt'

  @PrimaryKey({ type: 'bigint', autoincrement: true })
  id!: string

  @ManyToOne(() => BusinessRule, { fieldName: 'rule_id', nullable: false })
  rule!: BusinessRule

  @Property({ name: 'entity_id', type: 'varchar', length: 255 })
  entityId!: string

  @Property({ name: 'entity_type', type: 'varchar', length: 50 })
  entityType!: string

  @Property({ name: 'execution_result', type: 'varchar', length: 20 })
  executionResult!: ExecutionResult

  @Property({ name: 'input_context', type: 'jsonb', nullable: true })
  inputContext?: any | null

  @Property({ name: 'output_context', type: 'jsonb', nullable: true })
  outputContext?: any | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'execution_time_ms', type: 'integer' })
  executionTimeMs!: number

  @Property({ name: 'executed_at', type: Date, onCreate: () => new Date() })
  executedAt: Date = new Date()

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId?: string | null

  @Property({ name: 'executed_by', type: 'varchar', length: 50, nullable: true })
  executedBy?: string | null
}

/**
 * RuleSet entity
 *
 * Groups multiple business rules together for organized management and execution.
 * Rules can belong to multiple sets via the junction table.
 */
@Entity({ tableName: 'rule_sets' })
@Unique({ properties: ['setId', 'tenantId'] })
@Index({ name: 'rule_sets_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'rule_sets_enabled_idx', properties: ['enabled'] })
export class RuleSet {
  [OptionalProps]?: 'enabled' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'set_id', type: 'varchar', length: 50 })
  setId!: string

  @Property({ name: 'set_name', type: 'varchar', length: 200 })
  setName!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_by', type: 'varchar', length: 50, nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'varchar', length: 50, nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * RuleSetMember entity
 *
 * Junction table linking BusinessRules to RuleSets with ordering and activation control.
 * Allows rules to belong to multiple sets with different sequences.
 */
@Entity({ tableName: 'rule_set_members' })
@Unique({ properties: ['ruleSet', 'rule'] })
@Index({ name: 'rule_set_members_set_idx', properties: ['ruleSet', 'sequence'] })
@Index({ name: 'rule_set_members_rule_idx', properties: ['rule'] })
@Index({ name: 'rule_set_members_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class RuleSetMember {
  [OptionalProps]?: 'enabled' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => RuleSet, { fieldName: 'rule_set_id', nullable: false })
  ruleSet!: RuleSet

  @ManyToOne(() => BusinessRule, { fieldName: 'rule_id', nullable: false })
  rule!: BusinessRule

  @Property({ name: 'sequence', type: 'integer', default: 0 })
  sequence: number = 0

  @Property({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean = true

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
