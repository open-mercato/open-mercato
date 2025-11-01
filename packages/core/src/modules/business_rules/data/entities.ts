import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OptionalProps,
} from '@mikro-orm/core'

export type RuleType = 'GUARD' | 'VALIDATION' | 'CALCULATION' | 'ACTION' | 'ASSIGNMENT'

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
