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
export class Contractor {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'roleTypeIds'

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

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'role_type_ids', type: 'json', nullable: true })
  roleTypeIds?: string[] | null

  @OneToMany(() => ContractorAddress, (address) => address.contractor)
  addresses = new Collection<ContractorAddress>(this)

  @OneToMany(() => ContractorContact, (contact) => contact.contractor)
  contacts = new Collection<ContractorContact>(this)

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

  @Property({ name: 'address_line', type: 'text' })
  addressLine!: string

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

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

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
  [OptionalProps]?: 'isUnlimited' | 'currencyCode' | 'createdAt' | 'updatedAt'

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
