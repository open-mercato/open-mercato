import { Collection, OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, OneToMany, OneToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type CustomerEntityKind = 'person' | 'company'
export type CustomerAddressFormat = 'line_first' | 'street_first'

@Entity({ tableName: 'customer_entities' })
@Index({ name: 'customer_entities_org_tenant_kind_idx', properties: ['organizationId', 'tenantId', 'kind'] })
@Index({
  name: 'idx_ce_tenant_org_person_id',
  expression:
    `create index "idx_ce_tenant_org_person_id" on "customer_entities" ("tenant_id", "organization_id", "id") where deleted_at is null and kind = 'person'`,
})
@Index({
  name: 'idx_ce_tenant_org_company_id',
  expression:
    `create index "idx_ce_tenant_org_company_id" on "customer_entities" ("tenant_id", "organization_id", "id") where deleted_at is null and kind = 'company'`,
})
@Index({
  name: 'idx_ce_tenant_company_id',
  expression:
    `create index "idx_ce_tenant_company_id" on "customer_entities" ("tenant_id", "id") where deleted_at is null and kind = 'company'`,
})
@Index({
  name: 'idx_ce_tenant_person_id',
  expression:
    `create index "idx_ce_tenant_person_id" on "customer_entities" ("tenant_id", "id") where deleted_at is null and kind = 'person'`,
})
export class CustomerEntity {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  kind!: CustomerEntityKind

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'primary_email', type: 'text', nullable: true })
  primaryEmail?: string | null

  @Property({ name: 'primary_phone', type: 'text', nullable: true })
  primaryPhone?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'lifecycle_stage', type: 'text', nullable: true })
  lifecycleStage?: string | null

  @Property({ name: 'source', type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'temperature', type: 'text', nullable: true })
  temperature?: string | null

  @Property({ name: 'renewal_quarter', type: 'text', nullable: true })
  renewalQuarter?: string | null

  @Property({ name: 'next_interaction_at', type: Date, nullable: true })
  nextInteractionAt?: Date | null

  @Property({ name: 'next_interaction_name', type: 'text', nullable: true })
  nextInteractionName?: string | null

  @Property({ name: 'next_interaction_ref_id', type: 'text', nullable: true })
  nextInteractionRefId?: string | null

  @Property({ name: 'next_interaction_icon', type: 'text', nullable: true })
  nextInteractionIcon?: string | null

  @Property({ name: 'next_interaction_color', type: 'text', nullable: true })
  nextInteractionColor?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToOne(() => CustomerPersonProfile, (profile) => profile.entity, { nullable: true, mappedBy: 'entity' })
  personProfile?: CustomerPersonProfile | null

  @OneToOne(() => CustomerCompanyProfile, (profile) => profile.entity, { nullable: true, mappedBy: 'entity' })
  companyProfile?: CustomerCompanyProfile | null

  @OneToMany(() => CustomerAddress, (address) => address.entity)
  addresses = new Collection<CustomerAddress>(this)

  @OneToMany(() => CustomerActivity, (activity) => activity.entity)
  activities = new Collection<CustomerActivity>(this)

  @OneToMany(() => CustomerComment, (comment) => comment.entity)
  comments = new Collection<CustomerComment>(this)

  @OneToMany(() => CustomerTagAssignment, (assignment) => assignment.entity)
  tagAssignments = new Collection<CustomerTagAssignment>(this)

  @OneToMany(() => CustomerTodoLink, (link) => link.entity)
  todoLinks = new Collection<CustomerTodoLink>(this)

  @OneToMany(() => CustomerInteraction, (interaction) => interaction.entity)
  interactions = new Collection<CustomerInteraction>(this)

  @OneToMany(() => CustomerDealPersonLink, (link) => link.person)
  dealPersonLinks = new Collection<CustomerDealPersonLink>(this)

  @OneToMany(() => CustomerDealCompanyLink, (link) => link.company)
  dealCompanyLinks = new Collection<CustomerDealCompanyLink>(this)

  @OneToMany(() => CustomerPersonCompanyLink, (link) => link.person)
  personCompanyLinks = new Collection<CustomerPersonCompanyLink>(this)

  @OneToMany(() => CustomerPersonCompanyLink, (link) => link.company)
  linkedPeople = new Collection<CustomerPersonCompanyLink>(this)

  @OneToMany(() => CustomerPersonProfile, (person) => person.company)
  companyMembers = new Collection<CustomerPersonProfile>(this)
}

@Entity({ tableName: 'customer_people' })
@Index({ name: 'customer_people_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'idx_customer_people_entity_id',
  expression:
    `create index "idx_customer_people_entity_id" on "customer_people" ("entity_id")`,
})
export class CustomerPersonProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'first_name', type: 'text', nullable: true })
  firstName?: string | null

  @Property({ name: 'last_name', type: 'text', nullable: true })
  lastName?: string | null

  @Property({ name: 'preferred_name', type: 'text', nullable: true })
  preferredName?: string | null

  @Property({ name: 'job_title', type: 'text', nullable: true })
  jobTitle?: string | null

  @Property({ name: 'department', type: 'text', nullable: true })
  department?: string | null

  @Property({ name: 'seniority', type: 'text', nullable: true })
  seniority?: string | null

  @Property({ name: 'timezone', type: 'text', nullable: true })
  timezone?: string | null

  @Property({ name: 'linked_in_url', type: 'text', nullable: true })
  linkedInUrl?: string | null

  @Property({ name: 'twitter_url', type: 'text', nullable: true })
  twitterUrl?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToOne(() => CustomerEntity, (entity) => entity.personProfile, {
    fieldName: 'entity_id',
    owner: true,
  })
  entity!: CustomerEntity

  @ManyToOne(() => CustomerEntity, {
    fieldName: 'company_entity_id',
    nullable: true,
  })
  company?: CustomerEntity | null
}

@Entity({ tableName: 'customer_person_company_links' })
@Index({ name: 'customer_person_company_links_person_idx', properties: ['person'] })
@Index({ name: 'customer_person_company_links_company_idx', properties: ['company'] })
@Index({ name: 'customer_person_company_links_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'customer_person_company_links_active_unique',
  expression:
    `create unique index "customer_person_company_links_active_unique" on "customer_person_company_links" ("person_entity_id", "company_entity_id") where "deleted_at" is null`,
})
export class CustomerPersonCompanyLink {
  [OptionalProps]?: 'isPrimary' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => CustomerEntity, { fieldName: 'person_entity_id' })
  person!: CustomerEntity

  @ManyToOne(() => CustomerEntity, { fieldName: 'company_entity_id' })
  company!: CustomerEntity
}

@Entity({ tableName: 'customer_companies' })
@Index({ name: 'customer_companies_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'idx_customer_companies_entity_id',
  expression:
    `create index "idx_customer_companies_entity_id" on "customer_companies" ("entity_id")`,
})
export class CustomerCompanyProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'legal_name', type: 'text', nullable: true })
  legalName?: string | null

  @Property({ name: 'brand_name', type: 'text', nullable: true })
  brandName?: string | null

  @Property({ name: 'domain', type: 'text', nullable: true })
  domain?: string | null

  @Property({ name: 'website_url', type: 'text', nullable: true })
  websiteUrl?: string | null

  @Property({ name: 'industry', type: 'text', nullable: true })
  industry?: string | null

  @Property({ name: 'size_bucket', type: 'text', nullable: true })
  sizeBucket?: string | null

  @Property({ name: 'annual_revenue', type: 'numeric', precision: 16, scale: 2, nullable: true })
  annualRevenue?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToOne(() => CustomerEntity, (entity) => entity.companyProfile, {
    fieldName: 'entity_id',
    owner: true,
  })
  entity!: CustomerEntity

}

@Entity({ tableName: 'customer_deals' })
@Index({ name: 'customer_deals_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'customer_deals_closure_stats_idx',
  properties: ['organizationId', 'tenantId', 'closureOutcome', 'updatedAt'],
})
export class CustomerDeal {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status', type: 'text', default: 'open' })
  status: string = 'open'

  @Property({ name: 'pipeline_stage', type: 'text', nullable: true })
  pipelineStage?: string | null

  @Property({ name: 'pipeline_id', type: 'uuid', nullable: true })
  pipelineId?: string | null

  @Property({ name: 'pipeline_stage_id', type: 'uuid', nullable: true })
  pipelineStageId?: string | null

  @Property({ name: 'value_amount', type: 'numeric', precision: 14, scale: 2, nullable: true })
  valueAmount?: string | null

  @Property({ name: 'value_currency', type: 'text', nullable: true })
  valueCurrency?: string | null

  @Property({ name: 'probability', type: 'int', nullable: true })
  probability?: number | null

  @Property({ name: 'expected_close_at', type: Date, nullable: true })
  expectedCloseAt?: Date | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'source', type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'closure_outcome', type: 'text', nullable: true })
  closureOutcome?: string | null

  @Property({ name: 'loss_reason_id', type: 'uuid', nullable: true })
  lossReasonId?: string | null

  @Property({ name: 'loss_notes', type: 'text', nullable: true })
  lossNotes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => CustomerDealPersonLink, (link) => link.deal)
  people = new Collection<CustomerDealPersonLink>(this)

  @OneToMany(() => CustomerDealCompanyLink, (link) => link.deal)
  companies = new Collection<CustomerDealCompanyLink>(this)

  @OneToMany(() => CustomerActivity, (activity) => activity.deal)
  activities = new Collection<CustomerActivity>(this)

  @OneToMany(() => CustomerComment, (comment) => comment.deal)
  comments = new Collection<CustomerComment>(this)

  @OneToMany(() => CustomerDealStageTransition, (transition) => transition.deal)
  stageTransitions = new Collection<CustomerDealStageTransition>(this)
}

@Entity({ tableName: 'customer_deal_stage_transitions' })
@Index({ name: 'customer_deal_stage_transitions_deal_idx', properties: ['deal'] })
@Index({ name: 'customer_deal_stage_transitions_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_deal_stage_transitions_deal_stage_uq', properties: ['deal', 'stageId'] })
export class CustomerDealStageTransition {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'transitionedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string

  @Property({ name: 'stage_id', type: 'uuid' })
  stageId!: string

  @Property({ name: 'stage_label', type: 'text' })
  stageLabel!: string

  @Property({ name: 'stage_order', type: 'int' })
  stageOrder!: number

  @Property({ name: 'transitioned_at', type: Date, onCreate: () => new Date() })
  transitionedAt: Date = new Date()

  @Property({ name: 'transitioned_by_user_id', type: 'uuid', nullable: true })
  transitionedByUserId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id' })
  deal!: CustomerDeal
}

@Entity({ tableName: 'customer_deal_people' })
@Index({ name: 'customer_deal_people_deal_idx', properties: ['deal'] })
@Index({ name: 'customer_deal_people_person_idx', properties: ['person'] })
@Unique({ name: 'customer_deal_people_unique', properties: ['deal', 'person'] })
export class CustomerDealPersonLink {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'role', type: 'text', nullable: true })
  participantRole?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id' })
  deal!: CustomerDeal

  @ManyToOne(() => CustomerEntity, { fieldName: 'person_entity_id' })
  person!: CustomerEntity
}

@Entity({ tableName: 'customer_deal_companies' })
@Index({ name: 'customer_deal_companies_deal_idx', properties: ['deal'] })
@Index({ name: 'customer_deal_companies_company_idx', properties: ['company'] })
@Unique({ name: 'customer_deal_companies_unique', properties: ['deal', 'company'] })
export class CustomerDealCompanyLink {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id' })
  deal!: CustomerDeal

  @ManyToOne(() => CustomerEntity, { fieldName: 'company_entity_id' })
  company!: CustomerEntity
}

@Entity({ tableName: 'customer_activities' })
@Index({ name: 'customer_activities_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_activities_entity_idx', properties: ['entity'] })
@Index({ name: 'customer_activities_entity_occurred_created_idx', properties: ['entity', 'occurredAt', 'createdAt'] })
export class CustomerActivity {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'activity_type', type: 'text' })
  activityType!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'occurred_at', type: Date, nullable: true })
  occurredAt?: Date | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id', nullable: true })
  deal?: CustomerDeal | null
}

@Entity({ tableName: 'customer_interactions' })
@Index({
  name: 'customer_interactions_entity_status_scheduled_idx',
  properties: ['entity', 'status', 'scheduledAt', 'createdAt'],
})
@Index({
  name: 'customer_interactions_org_tenant_status_idx',
  properties: ['organizationId', 'tenantId', 'status', 'scheduledAt'],
})
@Index({
  name: 'customer_interactions_type_idx',
  properties: ['tenantId', 'organizationId', 'interactionType'],
})
export class CustomerInteraction {
  [OptionalProps]?: 'status' | 'pinned' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'durationMinutes' | 'location' | 'allDay' | 'recurrenceRule' | 'recurrenceEnd' | 'participants' | 'reminderMinutes' | 'visibility' | 'linkedEntities' | 'guestPermissions'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'interaction_type', type: 'text' })
  interactionType!: string

  @Property({ name: 'title', type: 'text', nullable: true })
  title?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'status', type: 'text', default: 'planned' })
  status: string = 'planned'

  @Property({ name: 'scheduled_at', type: Date, nullable: true })
  scheduledAt?: Date | null

  @Property({ name: 'occurred_at', type: Date, nullable: true })
  occurredAt?: Date | null

  @Property({ name: 'priority', type: 'int', nullable: true })
  priority?: number | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'source', type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'duration_minutes', type: 'int', nullable: true })
  durationMinutes?: number | null

  @Property({ name: 'location', type: 'text', nullable: true })
  location?: string | null

  @Property({ name: 'all_day', type: 'boolean', nullable: true })
  allDay?: boolean | null

  @Property({ name: 'recurrence_rule', type: 'text', nullable: true })
  recurrenceRule?: string | null

  @Property({ name: 'recurrence_end', type: Date, nullable: true })
  recurrenceEnd?: Date | null

  @Property({ name: 'participants', type: 'jsonb', nullable: true })
  participants?: Array<{ userId: string; name?: string; email?: string; status?: string }> | null

  @Property({ name: 'reminder_minutes', type: 'int', nullable: true })
  reminderMinutes?: number | null

  @Property({ name: 'visibility', type: 'text', nullable: true })
  visibility?: string | null

  @Property({ name: 'linked_entities', type: 'jsonb', nullable: true })
  linkedEntities?: Array<{ id: string; type: string; label: string }> | null

  @Property({ name: 'guest_permissions', type: 'jsonb', nullable: true })
  guestPermissions?: { canInviteOthers?: boolean; canModify?: boolean; canSeeList?: boolean } | null

  @Property({ name: 'pinned', type: 'boolean', default: false })
  pinned: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity
}

@Entity({ tableName: 'customer_comments' })
@Index({ name: 'customer_comments_entity_idx', properties: ['entity'] })
@Index({ name: 'customer_comments_entity_created_idx', properties: ['entity', 'createdAt'] })
export class CustomerComment {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id', nullable: true })
  deal?: CustomerDeal | null
}

@Entity({ tableName: 'customer_addresses' })
@Index({ name: 'customer_addresses_entity_idx', properties: ['entity'] })
export class CustomerAddress {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'name', type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'purpose', type: 'text', nullable: true })
  purpose?: string | null

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ name: 'address_line1', type: 'text' })
  addressLine1!: string

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'region', type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country', type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'building_number', type: 'text', nullable: true })
  buildingNumber?: string | null

  @Property({ name: 'flat_number', type: 'text', nullable: true })
  flatNumber?: string | null

  @Property({ name: 'latitude', type: 'float', nullable: true })
  latitude?: number | null

  @Property({ name: 'longitude', type: 'float', nullable: true })
  longitude?: number | null

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity
}

@Entity({ tableName: 'customer_settings' })
@Unique({ name: 'customer_settings_scope_unique', properties: ['organizationId', 'tenantId'] })
export class CustomerSettings {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'addressFormat' | 'stuckThresholdDays'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'address_format', type: 'text', default: 'line_first' })
  addressFormat: CustomerAddressFormat = 'line_first'

  @Property({ name: 'stuck_threshold_days', type: 'int', default: 14 })
  stuckThresholdDays: number = 14

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_tags' })
@Index({ name: 'customer_tags_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_tags_org_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class CustomerTag {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ name: 'color', type: 'text', nullable: true })
  color?: string | null

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => CustomerTagAssignment, (assignment) => assignment.tag)
  assignments = new Collection<CustomerTagAssignment>(this)
}

@Entity({ tableName: 'customer_tag_assignments' })
@Index({ name: 'customer_tag_assignments_entity_idx', properties: ['entity'] })
@Unique({ name: 'customer_tag_assignments_unique', properties: ['tag', 'entity'] })
export class CustomerTagAssignment {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @ManyToOne(() => CustomerTag, { fieldName: 'tag_id' })
  tag!: CustomerTag

@ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity
}

@Entity({ tableName: 'customer_dictionary_entries' })
@Index({ name: 'customer_dictionary_entries_scope_idx', properties: ['organizationId', 'tenantId', 'kind'] })
@Unique({ name: 'customer_dictionary_entries_unique', properties: ['organizationId', 'tenantId', 'kind', 'normalizedValue'] })
export class CustomerDictionaryEntry {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  kind!: string

  @Property({ type: 'text' })
  value!: string

  @Property({ name: 'normalized_value', type: 'text' })
  normalizedValue!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  icon?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_pipelines' })
@Index({ name: 'customer_pipelines_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
export class CustomerPipeline {
  [OptionalProps]?: 'isDefault' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_pipeline_stages' })
@Index({ name: 'customer_pipeline_stages_pipeline_position_idx', properties: ['pipelineId', 'order'] })
@Index({ name: 'customer_pipeline_stages_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
export class CustomerPipelineStage {
  [OptionalProps]?: 'order' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'pipeline_id', type: 'uuid' })
  pipelineId!: string

  @Property({ name: 'name', type: 'text' })
  label!: string

  @Property({ name: 'position', type: 'int', default: 0 })
  order: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_todo_links' })
@Index({ name: 'customer_todo_links_entity_idx', properties: ['entity'] })
@Index({ name: 'customer_todo_links_entity_created_idx', properties: ['entity', 'createdAt'] })
@Unique({ name: 'customer_todo_links_unique', properties: ['entity', 'todoId', 'todoSource'] })
export class CustomerTodoLink {
  [OptionalProps]?: 'createdAt' | 'createdByUserId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'todo_id', type: 'uuid' })
  todoId!: string

  @Property({ name: 'todo_source', type: 'text', default: 'customers:interaction' })
  todoSource: string = 'customers:interaction'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity
}

@Entity({ tableName: 'customer_entity_roles' })
@Index({ name: 'customer_entity_roles_entity_idx', properties: ['entityType', 'entityId'] })
@Index({ name: 'customer_entity_roles_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'customer_entity_roles_active_unique',
  expression:
    'create unique index "customer_entity_roles_active_unique" on "customer_entity_roles" ("entity_type", "entity_id", "role_type") where "deleted_at" is null',
})
export class CustomerEntityRole {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'role_type', type: 'text' })
  roleType!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'customer_dictionary_kind_settings' })
@Index({ name: 'customer_dict_kind_settings_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_dict_kind_settings_unique', properties: ['organizationId', 'tenantId', 'kind'] })
export class CustomerDictionaryKindSetting {
  [OptionalProps]?: 'selectionMode' | 'visibleInTags' | 'sortOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  kind!: string

  @Property({ name: 'selection_mode', type: 'text', default: 'single' })
  selectionMode: string = 'single'

  @Property({ name: 'visible_in_tags', type: 'boolean', default: true })
  visibleInTags: boolean = true

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_labels' })
@Index({ name: 'customer_labels_scope_idx', properties: ['organizationId', 'tenantId', 'userId'] })
@Unique({ name: 'customer_labels_unique', properties: ['userId', 'tenantId', 'organizationId', 'slug'] })
export class CustomerLabel {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_label_assignments' })
@Index({ name: 'customer_label_assignments_entity_idx', properties: ['entity'] })
@Unique({ name: 'customer_label_assignments_unique', properties: ['label', 'entity'] })
export class CustomerLabelAssignment {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @ManyToOne(() => CustomerLabel, { fieldName: 'label_id' })
  label!: CustomerLabel

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_company_billing' })
@Index({ name: 'customer_company_billing_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_company_billing_entity_unique', properties: ['entity'] })
export class CustomerCompanyBilling {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity

  @Property({ name: 'bank_name', type: 'text', nullable: true })
  bankName?: string | null

  @Property({ name: 'bank_account_masked', type: 'text', nullable: true })
  bankAccountMasked?: string | null

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  @Property({ name: 'preferred_currency', type: 'text', nullable: true })
  preferredCurrency?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_person_company_roles' })
@Index({ name: 'customer_pcr_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_pcr_person_company_idx', properties: ['personEntity', 'companyEntity'] })
@Unique({ name: 'customer_pcr_unique', properties: ['personEntity', 'companyEntity', 'roleValue'] })
export class CustomerPersonCompanyRole {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => CustomerEntity, { fieldName: 'person_entity_id' })
  personEntity!: CustomerEntity

  @ManyToOne(() => CustomerEntity, { fieldName: 'company_entity_id' })
  companyEntity!: CustomerEntity

  @Property({ name: 'role_value', type: 'text' })
  roleValue!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
