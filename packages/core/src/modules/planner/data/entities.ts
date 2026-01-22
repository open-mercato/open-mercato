import { Entity, PrimaryKey, Property, Index, Enum } from '@mikro-orm/core'

export type PlannerAvailabilitySubjectType = 'member' | 'resource' | 'ruleset'
export type PlannerAvailabilityKind = 'availability' | 'unavailability'

@Entity({ tableName: 'planner_availability_rule_sets' })
@Index({ name: 'planner_availability_rule_sets_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class PlannerAvailabilityRuleSet {
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

  @Property({ type: 'text' })
  timezone!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'planner_availability_rules' })
@Index({ name: 'planner_availability_rules_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'planner_availability_rules_subject_idx', properties: ['subjectType', 'subjectId', 'tenantId', 'organizationId'] })
export class PlannerAvailabilityRule {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: ['member', 'resource', 'ruleset'], type: 'text', name: 'subject_type' })
  subjectType!: PlannerAvailabilitySubjectType

  @Property({ name: 'subject_id', type: 'uuid' })
  subjectId!: string

  @Property({ type: 'text' })
  timezone!: string

  @Property({ type: 'text' })
  rrule!: string

  @Property({ type: 'jsonb', default: [] })
  exdates: string[] = []

  @Enum({ items: ['availability', 'unavailability'], type: 'text', name: 'kind' })
  kind: PlannerAvailabilityKind = 'availability'

  @Property({ type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'unavailability_reason_entry_id', type: 'uuid', nullable: true })
  unavailabilityReasonEntryId?: string | null

  @Property({ name: 'unavailability_reason_value', type: 'text', nullable: true })
  unavailabilityReasonValue?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
