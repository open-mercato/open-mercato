import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  OptionalProps,
} from '@mikro-orm/core'

@Entity({ tableName: 'gateway_payment_links' })
@Index({ properties: ['token'], options: { unique: true } })
@Index({ properties: ['transactionId', 'organizationId', 'tenantId'] })
@Index({ properties: ['organizationId', 'tenantId', 'status'] })
@Index({ properties: ['organizationId', 'tenantId', 'linkMode'] })
export class GatewayPaymentLink {
  [OptionalProps]?: 'description' | 'passwordHash' | 'status' | 'completedAt' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'metadata' | 'linkMode' | 'transactionId' | 'templateId' | 'useCount' | 'maxUses'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId?: string | null

  @Property({ type: 'text' })
  token!: string

  @Property({ type: 'text' })
  providerKey!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'password_hash', type: 'text', nullable: true })
  passwordHash?: string | null

  @Property({ type: 'text', default: 'active' })
  status: 'active' | 'completed' | 'cancelled' = 'active'

  @Property({ name: 'completed_at', type: Date, nullable: true })
  completedAt?: Date | null

  @Property({ name: 'link_mode', type: 'text', default: 'single' })
  linkMode: 'single' | 'multi' = 'single'

  @Property({ name: 'template_id', type: 'uuid', nullable: true })
  templateId?: string | null

  @Property({ name: 'use_count', type: 'integer', default: 0 })
  useCount: number = 0

  @Property({ name: 'max_uses', type: 'integer', nullable: true })
  maxUses?: number | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'gateway_payment_link_transactions' })
@Index({ properties: ['paymentLinkId'] })
@Index({ properties: ['transactionId'] })
export class GatewayPaymentLinkTransaction {
  [OptionalProps]?: 'customerData' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'payment_link_id', type: 'uuid' })
  paymentLinkId!: string

  @Property({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string

  @Property({ name: 'customer_email', type: 'text' })
  customerEmail!: string

  @Property({ name: 'customer_data', type: 'jsonb', nullable: true })
  customerData?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'payment_link_templates' })
@Index({ name: 'idx_payment_link_templates_org_tenant', properties: ['organizationId', 'tenantId'] })
export class PaymentLinkTemplate {
  [OptionalProps]?: 'isDefault' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ type: 'json', nullable: true })
  branding?: Record<string, unknown> | null

  @Property({ name: 'default_title', type: 'text', nullable: true })
  defaultTitle?: string | null

  @Property({ name: 'default_description', type: 'text', nullable: true })
  defaultDescription?: string | null

  @Property({ name: 'custom_fields', type: 'json', nullable: true })
  customFields?: Record<string, unknown> | null

  @Property({ name: 'custom_fieldset_code', type: 'text', nullable: true })
  customFieldsetCode?: string | null

  @Property({ name: 'customer_capture', type: 'json', nullable: true })
  customerCapture?: Record<string, unknown> | null

  @Property({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: 'timestamptz', defaultRaw: 'now()' })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: 'timestamptz', defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt?: Date | null
}
