import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Unique,
  OneToOne,
  OneToMany,
  ManyToOne,
  Collection,
  OptionalProps,
} from '@mikro-orm/core'

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

  @OneToMany(() => CustomerDealPersonLink, (link) => link.person)
  dealPersonLinks = new Collection<CustomerDealPersonLink>(this)

  @OneToMany(() => CustomerDealCompanyLink, (link) => link.company)
  dealCompanyLinks = new Collection<CustomerDealCompanyLink>(this)

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
@Index({ name: 'customer_deals_org_status_closed_idx', properties: ['organizationId', 'tenantId', 'status', 'closedAt'] })
@Index({ name: 'customer_deals_org_owner_status_idx', properties: ['organizationId', 'tenantId', 'ownerUserId', 'status'] })
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

  @Property({ name: 'close_reason_id', type: 'uuid', nullable: true })
  closeReasonId?: string | null

  @Property({ name: 'close_reason_notes', type: 'text', nullable: true })
  closeReasonNotes?: string | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'stage_entered_at', type: Date, nullable: true })
  stageEnteredAt?: Date | null

  @Property({ name: 'last_activity_at', type: Date, nullable: true })
  lastActivityAt?: Date | null

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

  @OneToMany(() => CustomerDealLine, (line) => line.deal)
  lines = new Collection<CustomerDealLine>(this)
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

@Entity({ tableName: 'customer_deal_lines' })
@Index({ name: 'customer_deal_lines_deal_idx', properties: ['deal'] })
@Index({ name: 'customer_deal_lines_product_idx', properties: ['productId', 'organizationId'] })
@Index({ name: 'customer_deal_lines_org_idx', properties: ['organizationId', 'tenantId'] })
export class CustomerDealLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'lineNumber' | 'quantity' | 'unitPrice' | 'lineTotal' | 'discountPercent' | 'discountAmount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_variant_id', type: 'uuid', nullable: true })
  productVariantId?: string | null

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'sku', type: 'text', nullable: true })
  sku?: string | null

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'quantity', type: 'numeric', columnType: 'numeric(18,6)', default: 1 })
  quantity: number = 1

  @Property({ name: 'unit', type: 'text', nullable: true })
  unit?: string | null

  @Property({ name: 'unit_price', type: 'numeric', columnType: 'numeric(14,2)', default: 0 })
  unitPrice: number = 0

  @Property({ name: 'discount_percent', type: 'numeric', columnType: 'numeric(5,2)', nullable: true, default: 0 })
  discountPercent?: number | null

  @Property({ name: 'discount_amount', type: 'numeric', columnType: 'numeric(14,2)', nullable: true, default: 0 })
  discountAmount?: number | null

  @Property({ name: 'tax_rate', type: 'numeric', columnType: 'numeric(7,4)', nullable: true })
  taxRate?: number | null

  @Property({ name: 'line_total', type: 'numeric', columnType: 'numeric(14,2)', default: 0 })
  lineTotal: number = 0

  @Property({ name: 'currency', type: 'varchar', length: 3, nullable: true })
  currency?: string | null

  @Property({ name: 'product_snapshot', type: 'jsonb', nullable: true })
  productSnapshot?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id' })
  deal!: CustomerDeal
}

@Entity({ tableName: 'customer_activities' })
@Index({ name: 'customer_activities_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_activities_entity_idx', properties: ['entity'] })
@Index({ name: 'customer_activities_entity_occurred_created_idx', properties: ['entity', 'occurredAt', 'createdAt'] })
export class CustomerActivity {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'reminderSent' | 'isOverdue'

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

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'reminder_at', type: Date, nullable: true })
  reminderAt?: Date | null

  @Property({ name: 'reminder_sent', type: 'boolean', default: false })
  reminderSent: boolean = false

  @Property({ name: 'is_overdue', type: 'boolean', default: false })
  isOverdue: boolean = false

  @Property({ name: 'assigned_to_user_id', type: 'uuid', nullable: true })
  assignedToUserId?: string | null

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

@Entity({ tableName: 'customer_deal_emails' })
@Index({ name: 'customer_deal_emails_deal_idx', properties: ['dealId', 'sentAt'] })
@Index({ name: 'customer_deal_emails_thread_idx', properties: ['threadId'] })
@Index({ name: 'customer_deal_emails_org_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_deal_emails_tenant_message_unique', properties: ['tenantId', 'messageId'] })
export class CustomerDealEmail {
  [OptionalProps]?: 'hasAttachments' | 'isRead' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'deal_id', type: 'uuid' })
  dealId!: string

  @Property({ name: 'thread_id', type: 'text', nullable: true })
  threadId?: string | null

  @Property({ name: 'message_id', type: 'text', nullable: true })
  messageId?: string | null

  @Property({ name: 'in_reply_to', type: 'text', nullable: true })
  inReplyTo?: string | null

  @Property({ name: 'direction', type: 'text' })
  direction!: string

  @Property({ name: 'from_address', type: 'text' })
  fromAddress!: string

  @Property({ name: 'from_name', type: 'text', nullable: true })
  fromName?: string | null

  @Property({ name: 'to_addresses', type: 'jsonb', default: '[]' })
  toAddresses: Array<{ email: string; name?: string }> = []

  @Property({ name: 'cc_addresses', type: 'jsonb', nullable: true, default: '[]' })
  ccAddresses?: Array<{ email: string; name?: string }> | null

  @Property({ name: 'bcc_addresses', type: 'jsonb', nullable: true, default: '[]' })
  bccAddresses?: Array<{ email: string; name?: string }> | null

  @Property({ name: 'subject', type: 'text' })
  subject!: string

  @Property({ name: 'body_text', type: 'text', nullable: true })
  bodyText?: string | null

  @Property({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml?: string | null

  @Property({ name: 'sent_at', type: Date })
  sentAt!: Date

  @Property({ name: 'provider', type: 'text', nullable: true })
  provider?: string | null

  @Property({ name: 'provider_message_id', type: 'text', nullable: true })
  providerMessageId?: string | null

  @Property({ name: 'provider_metadata', type: 'jsonb', nullable: true })
  providerMetadata?: Record<string, unknown> | null

  @Property({ name: 'has_attachments', type: 'boolean', default: false })
  hasAttachments: boolean = false

  @Property({ name: 'is_read', type: 'boolean', default: true })
  isRead: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_deal_mentions' })
@Index({ name: 'customer_deal_mentions_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_deal_mentions_user_idx', properties: ['mentionedUserId', 'isRead'] })
@Index({ name: 'customer_deal_mentions_deal_idx', properties: ['dealId'] })
export class CustomerDealMention {
  [OptionalProps]?: 'isRead' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'deal_id', type: 'uuid' })
  dealId!: string

  @Property({ name: 'comment_id', type: 'uuid' })
  commentId!: string

  @Property({ name: 'mentioned_user_id', type: 'uuid' })
  mentionedUserId!: string

  @Property({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

export type CustomerBranchType = 'headquarters' | 'branch' | 'warehouse' | 'office'

@Entity({ tableName: 'customer_branches' })
@Index({ name: 'customer_branches_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_branches_company_idx', properties: ['companyEntityId'] })
export class CustomerBranch {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'company_entity_id', type: 'uuid' })
  companyEntityId!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'branch_type', type: 'text', nullable: true })
  branchType?: CustomerBranchType | null

  @Property({ name: 'specialization', type: 'text', nullable: true })
  specialization?: string | null

  @Property({ name: 'budget', type: 'numeric', columnType: 'numeric(14,2)', nullable: true })
  budget?: string | null

  @Property({ name: 'headcount', type: 'integer', nullable: true })
  headcount?: number | null

  @Property({ name: 'responsible_person_id', type: 'uuid', nullable: true })
  responsiblePersonId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
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

  @Property({ name: 'branch_id', type: 'uuid', nullable: true })
  branchId?: string | null

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
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'address_format', type: 'text', default: 'line_first' })
  addressFormat: CustomerAddressFormat = 'line_first'

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

@Entity({ tableName: 'customer_deal_stage_histories' })
@Index({ name: 'customer_deal_stage_histories_deal_idx', properties: ['dealId', 'createdAt'] })
@Index({ name: 'customer_deal_stage_histories_stage_idx', properties: ['toStageId', 'organizationId'] })
@Index({ name: 'customer_deal_stage_histories_org_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'customer_deal_stage_histories_analytics_idx',
  properties: ['organizationId', 'tenantId', 'createdAt', 'toStageId'],
})
export class CustomerDealStageHistory {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'deal_id', type: 'uuid' })
  dealId!: string

  @Property({ name: 'from_stage_id', type: 'uuid', nullable: true })
  fromStageId?: string | null

  @Property({ name: 'to_stage_id', type: 'uuid' })
  toStageId!: string

  @Property({ name: 'from_stage_label', type: 'text', nullable: true })
  fromStageLabel?: string | null

  @Property({ name: 'to_stage_label', type: 'text' })
  toStageLabel!: string

  @Property({ name: 'from_pipeline_id', type: 'uuid', nullable: true })
  fromPipelineId?: string | null

  @Property({ name: 'to_pipeline_id', type: 'uuid' })
  toPipelineId!: string

  @Property({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId?: string | null

  @Property({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_saved_views' })
@Index({ name: 'customer_saved_views_user_idx', properties: ['userId', 'entityType'] })
@Index({ name: 'customer_saved_views_org_idx', properties: ['organizationId', 'tenantId', 'entityType', 'isShared'] })
export class CustomerSavedView {
  [OptionalProps]?: 'isDefault' | 'isShared' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'jsonb', default: '{}' })
  filters: Record<string, unknown> = {}

  @Property({ name: 'sort_field', type: 'text', nullable: true })
  sortField?: string | null

  @Property({ name: 'sort_dir', type: 'text', nullable: true })
  sortDir?: string | null

  @Property({ type: 'jsonb', nullable: true })
  columns?: string[] | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_shared', type: 'boolean', default: false })
  isShared: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
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

  @Property({ name: 'todo_source', type: 'text', default: 'example:todo' })
  todoSource: string = 'example:todo'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @ManyToOne(() => CustomerEntity, { fieldName: 'entity_id' })
  entity!: CustomerEntity
}
