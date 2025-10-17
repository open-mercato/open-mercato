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
} from '@mikro-orm/core'

export type CustomerEntityKind = 'person' | 'company'

@Entity({ tableName: 'customer_entities' })
@Index({ name: 'customer_entities_org_tenant_kind_idx', properties: ['organizationId', 'tenantId', 'kind'] })
export class CustomerEntity {
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
export class CustomerPersonProfile {
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
export class CustomerCompanyProfile {
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
export class CustomerDeal {
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
}

@Entity({ tableName: 'customer_deal_people' })
@Index({ name: 'customer_deal_people_deal_idx', properties: ['deal'] })
@Unique({ name: 'customer_deal_people_unique', properties: ['deal', 'person'] })
export class CustomerDealPersonLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'role', type: 'text', nullable: true })
  role?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @ManyToOne(() => CustomerDeal, { fieldName: 'deal_id' })
  deal!: CustomerDeal

  @ManyToOne(() => CustomerEntity, { fieldName: 'person_entity_id' })
  person!: CustomerEntity
}

@Entity({ tableName: 'customer_deal_companies' })
@Index({ name: 'customer_deal_companies_deal_idx', properties: ['deal'] })
@Unique({ name: 'customer_deal_companies_unique', properties: ['deal', 'company'] })
export class CustomerDealCompanyLink {
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
export class CustomerActivity {
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
export class CustomerComment {
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

@Entity({ tableName: 'customer_tags' })
@Index({ name: 'customer_tags_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_tags_org_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class CustomerTag {
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

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_todo_links' })
@Index({ name: 'customer_todo_links_entity_idx', properties: ['entity'] })
@Unique({ name: 'customer_todo_links_unique', properties: ['entity', 'todoId', 'todoSource'] })
export class CustomerTodoLink {
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
