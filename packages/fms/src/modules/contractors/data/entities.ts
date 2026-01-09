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

export type ContractorAddressPurpose = 'office' | 'warehouse' | 'billing' | 'shipping' | 'other'
export type ContractorRoleCategory = 'trading' | 'carrier' | 'intermediary' | 'facility'
export type PaymentMethod = 'bank_transfer' | 'card' | 'cash'

@Entity({ tableName: 'contractors' })
@Index({ name: 'contractors_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'idx_contractors_tenant_org_id',
  expression: `create index "idx_contractors_tenant_org_id" on "contractors" ("tenant_id", "organization_id", "id") where deleted_at is null`,
})
@Index({ name: 'contractors_parent_idx', properties: ['parentId'] })
@Unique({
  name: 'contractors_code_unique',
  expression: `create unique index "contractors_code_unique" on "contractors" ("tenant_id", "organization_id", "code") where deleted_at is null and code is not null`,
})
export class Contractor {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'short_name', type: 'text', nullable: true })
  shortName?: string | null

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  @Property({ name: 'legal_name', type: 'text', nullable: true })
  legalName?: string | null

  @Property({ name: 'registration_number', type: 'text', nullable: true })
  registrationNumber?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => ContractorAddress, (address) => address.contractor)
  addresses = new Collection<ContractorAddress>(this)

  @OneToMany(() => ContractorContact, (contact) => contact.contractor)
  contacts = new Collection<ContractorContact>(this)

  @OneToMany(() => ContractorRole, (role) => role.contractor)
  roles = new Collection<ContractorRole>(this)

  @OneToOne(() => ContractorPaymentTerms, (pt) => pt.contractor, { nullable: true, mappedBy: 'contractor' })
  paymentTerms?: ContractorPaymentTerms | null

  @OneToOne(() => ContractorCreditLimit, (cl) => cl.contractor, { nullable: true, mappedBy: 'contractor' })
  creditLimit?: ContractorCreditLimit | null
}

@Entity({ tableName: 'contractor_addresses' })
@Index({ name: 'contractor_addresses_contractor_idx', properties: ['contractor'] })
export class ContractorAddress {
  [OptionalProps]?: 'isActive' | 'isPrimary' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  purpose!: ContractorAddressPurpose

  @Property({ type: 'text', nullable: true })
  label?: string | null

  @Property({ name: 'address_line1', type: 'text' })
  addressLine1!: string

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ type: 'text' })
  city!: string

  @Property({ type: 'text', nullable: true })
  state?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country_code', type: 'text' })
  countryCode!: string

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => Contractor, { fieldName: 'contractor_id' })
  contractor!: Contractor
}

@Entity({ tableName: 'contractor_contacts' })
@Index({ name: 'contractor_contacts_contractor_idx', properties: ['contractor'] })
export class ContractorContact {
  [OptionalProps]?: 'isActive' | 'isPrimary' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'first_name', type: 'text' })
  firstName!: string

  @Property({ name: 'last_name', type: 'text' })
  lastName!: string

  @Property({ name: 'job_title', type: 'text', nullable: true })
  jobTitle?: string | null

  @Property({ type: 'text', nullable: true })
  department?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ type: 'text', nullable: true })
  mobile?: string | null

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => Contractor, { fieldName: 'contractor_id' })
  contractor!: Contractor
}

@Entity({ tableName: 'contractor_role_types' })
@Index({ name: 'contractor_role_types_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'idx_contractor_role_types_category',
  expression: `create index "idx_contractor_role_types_category" on "contractor_role_types" ("tenant_id", "organization_id", "category") where is_active = true`,
})
@Unique({ name: 'contractor_role_types_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class ContractorRoleType {
  [OptionalProps]?: 'isActive' | 'isSystem' | 'hasCustomFields' | 'sortOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  category!: ContractorRoleCategory

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  icon?: string | null

  @Property({ name: 'has_custom_fields', type: 'boolean', default: false })
  hasCustomFields: boolean = false

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => ContractorRole, (role) => role.roleType)
  roles = new Collection<ContractorRole>(this)
}

@Entity({ tableName: 'contractor_roles' })
@Index({ name: 'contractor_roles_contractor_idx', properties: ['contractor'] })
@Index({
  name: 'idx_contractor_roles_role_type',
  expression: `create index "idx_contractor_roles_role_type" on "contractor_roles" ("tenant_id", "organization_id", "role_type_id") where is_active = true`,
})
@Unique({ name: 'contractor_roles_unique', properties: ['contractor', 'roleType'] })
export class ContractorRole {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'json', nullable: true })
  settings?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'effective_from', type: Date, nullable: true })
  effectiveFrom?: Date | null

  @Property({ name: 'effective_to', type: Date, nullable: true })
  effectiveTo?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @ManyToOne(() => Contractor, { fieldName: 'contractor_id' })
  contractor!: Contractor

  @ManyToOne(() => ContractorRoleType, { fieldName: 'role_type_id' })
  roleType!: ContractorRoleType
}

@Entity({ tableName: 'contractor_payment_terms' })
@Index({ name: 'contractor_payment_terms_contractor_idx', properties: ['contractor'] })
@Unique({ name: 'contractor_payment_terms_contractor_unique', properties: ['contractor'] })
export class ContractorPaymentTerms {
  [OptionalProps]?: 'paymentDays' | 'currencyCode' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'payment_days', type: 'int', default: 30 })
  paymentDays: number = 30

  @Property({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod?: PaymentMethod | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'bank_name', type: 'text', nullable: true })
  bankName?: string | null

  @Property({ name: 'bank_account_number', type: 'text', nullable: true })
  bankAccountNumber?: string | null

  @Property({ name: 'bank_routing_number', type: 'text', nullable: true })
  bankRoutingNumber?: string | null

  @Property({ type: 'text', nullable: true })
  iban?: string | null

  @Property({ name: 'swift_bic', type: 'text', nullable: true })
  swiftBic?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToOne(() => Contractor, (c) => c.paymentTerms, {
    fieldName: 'contractor_id',
    owner: true,
  })
  contractor!: Contractor
}

@Entity({ tableName: 'contractor_credit_limits' })
@Index({ name: 'contractor_credit_limits_contractor_idx', properties: ['contractor'] })
@Unique({ name: 'contractor_credit_limits_contractor_unique', properties: ['contractor'] })
export class ContractorCreditLimit {
  [OptionalProps]?: 'isUnlimited' | 'currentExposure' | 'currencyCode' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'credit_limit', type: 'numeric', precision: 18, scale: 2 })
  creditLimit!: string

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'is_unlimited', type: 'boolean', default: false })
  isUnlimited: boolean = false

  @Property({ name: 'current_exposure', type: 'numeric', precision: 18, scale: 2, default: '0' })
  currentExposure: string = '0'

  @Property({ name: 'last_calculated_at', type: Date, nullable: true })
  lastCalculatedAt?: Date | null

  @Property({ name: 'requires_approval_above', type: 'numeric', precision: 18, scale: 2, nullable: true })
  requiresApprovalAbove?: string | null

  @Property({ name: 'approved_by_id', type: 'uuid', nullable: true })
  approvedById?: string | null

  @Property({ name: 'approved_at', type: Date, nullable: true })
  approvedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToOne(() => Contractor, (c) => c.creditLimit, {
    fieldName: 'contractor_id',
    owner: true,
  })
  contractor!: Contractor
}
