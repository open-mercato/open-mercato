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

export type EcommerceCartStatus = 'active' | 'converted' | 'abandoned'

@Entity({ tableName: 'ecommerce_carts' })
@Index({ name: 'ecommerce_carts_org_tenant_store_idx', properties: ['tenantId', 'storeId'] })
@Unique({ name: 'ecommerce_carts_token_unique', properties: ['token'] })
export class EcommerceCart {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'store_id', type: 'uuid' })
  storeId!: string

  @Property({ type: 'uuid' })
  token!: string

  @Property({ type: 'text', default: 'active' })
  status!: EcommerceCartStatus

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ type: 'text', nullable: true })
  locale?: string | null

  @Property({ name: 'converted_order_id', type: 'uuid', nullable: true })
  convertedOrderId?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date
}

@Entity({ tableName: 'ecommerce_cart_lines' })
@Index({ name: 'ecommerce_cart_lines_cart_idx', properties: ['cartId'] })
export class EcommerceCartLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'quantity'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'integer', default: 1 })
  quantity!: number

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 19, scale: 4, nullable: true })
  unitPriceNet?: string | null

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 19, scale: 4, nullable: true })
  unitPriceGross?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'title_snapshot', type: 'text', nullable: true })
  titleSnapshot?: string | null

  @Property({ name: 'sku_snapshot', type: 'text', nullable: true })
  skuSnapshot?: string | null

  @Property({ name: 'image_url_snapshot', type: 'text', nullable: true })
  imageUrlSnapshot?: string | null

  @Property({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, defaultRaw: 'now()' })
  createdAt!: Date

  @Property({ name: 'updated_at', type: Date, defaultRaw: 'now()', onUpdate: () => new Date() })
  updatedAt!: Date
}
