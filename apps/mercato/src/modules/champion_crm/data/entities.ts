import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core'

export type ChampionLeadTechStatus = 'new' | 'created_contact' | 'matched_contact' | 'manual_review' | 'rejected' | 'error'
export type ChampionLeadQualificationStatus = 'do_kwalifikacji' | 'zakwalifikowany' | 'niezakwalifikowany' | 'spam' | 'pomylka'
export type ChampionContactLifecycle = 'lead' | 'prospect' | 'customer' | 'lost' | 'archived'
export type ChampionDealStatus = 'open' | 'reserved' | 'won' | 'lost' | 'cancelled'
export type ChampionInvestmentStatus = 'planned' | 'selling' | 'sold_out' | 'archived'
export type ChampionApartmentStatus = 'available' | 'reserved' | 'sold' | 'blocked'
export type ChampionActivityType = 'form_submit' | 'call_attempt' | 'call' | 'meeting' | 'note' | 'email' | 'task' | 'system'
export type ChampionConsentScope = 'contact_request' | 'marketing_email' | 'marketing_phone' | 'privacy_policy'

@Entity({ tableName: 'champion_crm_leads' })
@Index({ name: 'champion_crm_leads_scope_status_idx', properties: ['organizationId', 'tenantId', 'techStatus'] })
@Index({ name: 'champion_crm_leads_email_idx', properties: ['organizationId', 'tenantId', 'emailNormalized'] })
@Index({ name: 'champion_crm_leads_phone_idx', properties: ['organizationId', 'tenantId', 'phoneE164'] })
@Index({ name: 'champion_crm_leads_contact_idx', properties: ['contactId'] })
export class ChampionLead {
  [OptionalProps]?: 'sourcePayload' | 'techStatus' | 'qualificationStatus' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'source_external_id', type: 'text', nullable: true })
  sourceExternalId?: string | null

  @Property({ name: 'source_payload', type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  sourcePayload: Record<string, unknown> = {}

  @Property({ name: 'utm_source', type: 'text', nullable: true })
  utmSource?: string | null

  @Property({ name: 'utm_medium', type: 'text', nullable: true })
  utmMedium?: string | null

  @Property({ name: 'utm_campaign', type: 'text', nullable: true })
  utmCampaign?: string | null

  @Property({ name: 'utm_term', type: 'text', nullable: true })
  utmTerm?: string | null

  @Property({ name: 'utm_content', type: 'text', nullable: true })
  utmContent?: string | null

  @Property({ name: 'email_normalized', type: 'text', nullable: true })
  emailNormalized?: string | null

  @Property({ name: 'phone_e164', type: 'text', nullable: true })
  phoneE164?: string | null

  @Property({ name: 'name_raw', type: 'text', nullable: true })
  nameRaw?: string | null

  @Property({ name: 'tech_status', type: 'text', default: 'new' })
  techStatus: ChampionLeadTechStatus = 'new'

  @Property({ name: 'qualification_status', type: 'text', default: 'do_kwalifikacji' })
  qualificationStatus: ChampionLeadQualificationStatus = 'do_kwalifikacji'

  @Property({ name: 'disqualification_reason', type: 'text', nullable: true })
  disqualificationReason?: string | null

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'qualified_at', type: Date, nullable: true })
  qualifiedAt?: Date | null

  @Property({ name: 'disqualified_at', type: Date, nullable: true })
  disqualifiedAt?: Date | null

  @Property({ name: 'last_attempt_at', type: Date, nullable: true })
  lastAttemptAt?: Date | null

  @Property({ name: 'next_followup_at', type: Date, nullable: true })
  nextFollowupAt?: Date | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_contacts' })
@Index({ name: 'champion_crm_contacts_scope_lifecycle_idx', properties: ['organizationId', 'tenantId', 'lifecycle'] })
@Index({ name: 'champion_crm_contacts_email_idx', properties: ['organizationId', 'tenantId', 'primaryEmail'] })
@Index({ name: 'champion_crm_contacts_phone_idx', properties: ['organizationId', 'tenantId', 'primaryPhoneE164'] })
export class ChampionContact {
  [OptionalProps]?: 'emails' | 'phones' | 'lifecycle' | 'consentSummary' | 'score' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'display_name', type: 'text' })
  displayName!: string

  @Property({ name: 'primary_email', type: 'text', nullable: true })
  primaryEmail?: string | null

  @Property({ name: 'primary_phone_e164', type: 'text', nullable: true })
  primaryPhoneE164?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'[]'::jsonb" })
  emails: string[] = []

  @Property({ type: 'jsonb', defaultRaw: "'[]'::jsonb" })
  phones: string[] = []

  @Property({ type: 'text', default: 'lead' })
  lifecycle: ChampionContactLifecycle = 'lead'

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ name: 'first_lead_id', type: 'uuid', nullable: true })
  firstLeadId?: string | null

  @Property({ name: 'last_lead_id', type: 'uuid', nullable: true })
  lastLeadId?: string | null

  @Property({ name: 'last_lead_at', type: Date, nullable: true })
  lastLeadAt?: Date | null

  @Property({ name: 'last_lead_source', type: 'text', nullable: true })
  lastLeadSource?: string | null

  @Property({ name: 'consent_summary', type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  consentSummary: Record<string, unknown> = {}

  @Property({ type: 'integer', default: 0 })
  score: number = 0

  @Property({ name: 'internal_alert', type: 'text', nullable: true })
  internalAlert?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_deals' })
@Index({ name: 'champion_crm_deals_scope_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'champion_crm_deals_contact_idx', properties: ['contactId'] })
@Index({ name: 'champion_crm_deals_investment_idx', properties: ['investmentId'] })
export class ChampionDeal {
  [OptionalProps]?: 'status' | 'probability' | 'metadata' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'contact_id', type: 'uuid' })
  contactId!: string

  @Property({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId?: string | null

  @Property({ name: 'investment_id', type: 'uuid', nullable: true })
  investmentId?: string | null

  @Property({ name: 'apartment_id', type: 'uuid', nullable: true })
  apartmentId?: string | null

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', default: 'open' })
  status: ChampionDealStatus = 'open'

  @Property({ name: 'stage', type: 'text', nullable: true })
  stage?: string | null

  @Property({ name: 'budget_amount', type: 'numeric', precision: 16, scale: 2, nullable: true })
  budgetAmount?: string | null

  @Property({ name: 'budget_currency', type: 'text', nullable: true })
  budgetCurrency?: string | null

  @Property({ name: 'expected_close_at', type: Date, nullable: true })
  expectedCloseAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ type: 'integer', default: 0 })
  probability: number = 0

  @Property({ name: 'loss_reason', type: 'text', nullable: true })
  lossReason?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  metadata: Record<string, unknown> = {}

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_investments' })
@Index({ name: 'champion_crm_investments_scope_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class ChampionInvestment {
  [OptionalProps]?: 'status' | 'metadata' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', default: 'planned' })
  status: ChampionInvestmentStatus = 'planned'

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  city?: string | null

  @Property({ type: 'text', nullable: true })
  address?: string | null

  @Property({ name: 'sales_start_at', type: Date, nullable: true })
  salesStartAt?: Date | null

  @Property({ name: 'sales_end_at', type: Date, nullable: true })
  salesEndAt?: Date | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  metadata: Record<string, unknown> = {}

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_apartments' })
@Index({ name: 'champion_crm_apartments_scope_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'champion_crm_apartments_investment_idx', properties: ['investmentId'] })
export class ChampionApartment {
  [OptionalProps]?: 'status' | 'metadata' | 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'investment_id', type: 'uuid' })
  investmentId!: string

  @Property({ name: 'unit_number', type: 'text' })
  unitNumber!: string

  @Property({ type: 'text', nullable: true })
  building?: string | null

  @Property({ type: 'text', nullable: true })
  floor?: string | null

  @Property({ type: 'integer', nullable: true })
  rooms?: number | null

  @Property({ name: 'area_sqm', type: 'numeric', precision: 10, scale: 2, nullable: true })
  areaSqm?: string | null

  @Property({ name: 'price_amount', type: 'numeric', precision: 16, scale: 2, nullable: true })
  priceAmount?: string | null

  @Property({ name: 'price_currency', type: 'text', nullable: true })
  priceCurrency?: string | null

  @Property({ type: 'text', default: 'available' })
  status: ChampionApartmentStatus = 'available'

  @Property({ name: 'reserved_by_deal_id', type: 'uuid', nullable: true })
  reservedByDealId?: string | null

  @Property({ name: 'reserved_at', type: Date, nullable: true })
  reservedAt?: Date | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  metadata: Record<string, unknown> = {}

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_activities' })
@Index({ name: 'champion_crm_activities_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'champion_crm_activities_entity_idx', properties: ['entityType', 'entityId'] })
@Index({ name: 'champion_crm_activities_lead_idx', properties: ['leadId'] })
@Index({ name: 'champion_crm_activities_contact_idx', properties: ['contactId'] })
export class ChampionActivity {
  [OptionalProps]?: 'metadata' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId?: string | null

  @Property({ name: 'deal_id', type: 'uuid', nullable: true })
  dealId?: string | null

  @Property({ type: 'text' })
  type!: ChampionActivityType

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'occurred_at', type: Date })
  occurredAt!: Date

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  metadata: Record<string, unknown> = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'champion_crm_consent_events' })
@Index({ name: 'champion_crm_consent_events_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'champion_crm_consent_events_contact_idx', properties: ['contactId'] })
@Index({ name: 'champion_crm_consent_events_lead_idx', properties: ['leadId'] })
export class ChampionConsentEvent {
  [OptionalProps]?: 'evidence' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId?: string | null

  @Property({ name: 'lead_id', type: 'uuid', nullable: true })
  leadId?: string | null

  @Property({ type: 'text' })
  scope!: ChampionConsentScope

  @Property({ type: 'boolean' })
  granted!: boolean

  @Property({ name: 'text_version', type: 'text', nullable: true })
  textVersion?: string | null

  @Property({ type: 'text', nullable: true })
  source?: string | null

  @Property({ name: 'captured_at', type: Date })
  capturedAt!: Date

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  evidence: Record<string, unknown> = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'champion_crm_audit_events' })
@Index({ name: 'champion_crm_audit_events_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'champion_crm_audit_events_entity_idx', properties: ['entityType', 'entityId'] })
export class ChampionAuditEvent {
  [OptionalProps]?: 'metadata' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'entity_type', type: 'text' })
  entityType!: string

  @Property({ name: 'entity_id', type: 'uuid' })
  entityId!: string

  @Property({ type: 'text' })
  action!: string

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ type: 'text', nullable: true })
  message?: string | null

  @Property({ type: 'jsonb', defaultRaw: "'{}'::jsonb" })
  metadata: Record<string, unknown> = {}

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

