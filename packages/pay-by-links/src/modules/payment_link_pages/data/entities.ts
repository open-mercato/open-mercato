import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  OptionalProps,
} from '@mikro-orm/core'

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
