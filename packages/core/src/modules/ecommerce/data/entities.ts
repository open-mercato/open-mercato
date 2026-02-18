import { Entity, PrimaryKey, Property, Index, Unique, OptionalProps } from '@mikro-orm/core'

export type EcommerceStoreStatus = 'draft' | 'active' | 'archived'
export type EcommerceTlsMode = 'platform' | 'external'
export type EcommerceDomainVerificationStatus = 'pending' | 'verified' | 'failed'

@Entity({ tableName: 'ecommerce_stores' })
@Index({ name: 'ecommerce_stores_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'ecommerce_stores_tenant_slug_idx', properties: ['tenantId', 'slug'] })
export class EcommerceStore {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'status' | 'isPrimary' | 'supportedLocales'

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
  slug!: string

  @Property({ type: 'text', default: 'draft' })
  status!: EcommerceStoreStatus

  @Property({ name: 'default_locale', type: 'text' })
  defaultLocale!: string

  @Property({ name: 'supported_locales', type: 'jsonb', default: '[]' })
  supportedLocales!: string[]

  @Property({ name: 'default_currency_code', type: 'text' })
  defaultCurrencyCode!: string

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean

  @Property({ type: 'jsonb', nullable: true })
  settings?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ecommerce_store_domains' })
@Unique({ name: 'ecommerce_store_domains_host_unique', properties: ['host'] })
@Index({ name: 'ecommerce_store_domains_store_idx', properties: ['storeId'] })
export class EcommerceStoreDomain {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isPrimary' | 'tlsMode' | 'verificationStatus'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'store_id', type: 'uuid' })
  storeId!: string

  @Property({ type: 'text' })
  host!: string

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean

  @Property({ name: 'tls_mode', type: 'text', default: 'platform' })
  tlsMode!: EcommerceTlsMode

  @Property({ name: 'verification_status', type: 'text', default: 'pending' })
  verificationStatus!: EcommerceDomainVerificationStatus

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ecommerce_store_channel_bindings' })
@Index({ name: 'ecommerce_store_channel_bindings_store_idx', properties: ['storeId'] })
export class EcommerceStoreChannelBinding {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isDefault'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'store_id', type: 'uuid' })
  storeId!: string

  @Property({ name: 'sales_channel_id', type: 'uuid' })
  salesChannelId!: string

  @Property({ name: 'price_kind_id', type: 'uuid', nullable: true })
  priceKindId?: string | null

  @Property({ name: 'catalog_scope', type: 'jsonb', nullable: true })
  catalogScope?: Record<string, unknown> | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
