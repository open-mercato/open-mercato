import { Entity, PrimaryKey, Property, Index, Unique } from '@mikro-orm/core'

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
}

@Entity({ tableName: 'customer_people' })
@Index({ name: 'customer_people_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_people_entity_id_unique', properties: ['entityId'] })
export class CustomerPersonProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

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

  @Property({ name: 'company_entity_id', type: 'uuid', nullable: true })
  companyEntityId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_companies' })
@Index({ name: 'customer_companies_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'customer_companies_entity_id_unique', properties: ['entityId'] })
export class CustomerCompanyProfile {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

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
}

@Entity({ tableName: 'customer_deal_people' })
@Index({ name: 'customer_deal_people_deal_idx', properties: ['dealId'] })
@Unique({ name: 'customer_deal_people_unique', properties: ['dealId', 'personEntityId'] })
export class CustomerDealPersonLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'deal_id', type: 'uuid' })
  dealId!: string

  @Property({ name: 'person_entity_id', type: 'uuid' })
  personEntityId!: string

  @Property({ name: 'role', type: 'text', nullable: true })
  role?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_deal_companies' })
@Index({ name: 'customer_deal_companies_deal_idx', properties: ['dealId'] })
@Unique({ name: 'customer_deal_companies_unique', properties: ['dealId', 'companyEntityId'] })
export class CustomerDealCompanyLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'deal_id', type: 'uuid' })
  dealId!: string

  @Property({ name: 'company_entity_id', type: 'uuid' })
  companyEntityId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_activities' })
@Index({ name: 'customer_activities_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'customer_activities_entity_idx', properties: ['entityId'] })
export class CustomerActivity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'activity_type', type: 'text' })
  activityType!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'occurred_at', type: Date, nullable: true })
  occurredAt?: Date | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'customer_comments' })
@Index({ name: 'customer_comments_entity_idx', properties: ['entityId'] })
export class CustomerComment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

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
}

@Entity({ tableName: 'customer_addresses' })
@Index({ name: 'customer_addresses_entity_idx', properties: ['entityId'] })
export class CustomerAddress {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

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
}

@Entity({ tableName: 'customer_tag_assignments' })
@Index({ name: 'customer_tag_assignments_entity_idx', properties: ['entityId'] })
@Unique({ name: 'customer_tag_assignments_unique', properties: ['tagId', 'entityId'] })
export class CustomerTagAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tag_id', type: 'uuid' })
  tagId!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'customer_todo_links' })
@Index({ name: 'customer_todo_links_entity_idx', properties: ['entityId'] })
@Unique({ name: 'customer_todo_links_unique', properties: ['entityId', 'todoId', 'todoSource'] })
export class CustomerTodoLink {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

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
}
