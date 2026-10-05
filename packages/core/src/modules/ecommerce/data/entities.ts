import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type { AssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { EcommercePriceSortFallback, EcommerceStoreSettings, EcommerceStoreStatus } from './validators'

@Entity({ tableName: 'ecommerce_stores' })
@Index({ name: 'ecommerce_stores_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'ecommerce_stores_tenant_code_unique',
  expression:
    'create unique index "ecommerce_stores_tenant_code_unique" on "ecommerce_stores" ("tenant_id", "code") where "deleted_at" is null',
})
@Index({
  name: 'ecommerce_stores_tenant_slug_unique',
  expression:
    'create unique index "ecommerce_stores_tenant_slug_unique" on "ecommerce_stores" ("tenant_id", "slug") where "deleted_at" is null',
})
@Index({
  name: 'ecommerce_stores_org_primary_unique',
  expression:
    'create unique index "ecommerce_stores_org_primary_unique" on "ecommerce_stores" ("organization_id") where "is_primary" and "deleted_at" is null',
})
export class EcommerceStore {
  [OptionalProps]?: 'status' | 'isPrimary' | 'createdAt' | 'updatedAt' | 'deletedAt'

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
  status: EcommerceStoreStatus = 'draft'

  @Property({ name: 'default_locale', type: 'text' })
  defaultLocale!: string

  @Property({ name: 'supported_locales', type: 'jsonb' })
  supportedLocales!: string[]

  @Property({ name: 'default_currency_code', type: 'text' })
  defaultCurrencyCode!: string

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ type: 'jsonb' })
  settings!: EcommerceStoreSettings

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ecommerce_store_domain_bindings' })
@Index({ name: 'ecommerce_store_domain_bindings_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ecommerce_store_domain_bindings_store_idx', properties: ['storeId'] })
@Index({
  name: 'ecommerce_store_domain_bindings_mapping_prefix_unique',
  expression:
    'create unique index "ecommerce_store_domain_bindings_mapping_prefix_unique" on "ecommerce_store_domain_bindings" ("domain_mapping_id", coalesce("path_prefix", \'\')) where "deleted_at" is null',
})
@Index({
  name: 'ecommerce_store_domain_bindings_store_primary_unique',
  expression:
    'create unique index "ecommerce_store_domain_bindings_store_primary_unique" on "ecommerce_store_domain_bindings" ("store_id") where "is_primary" and "deleted_at" is null',
})
export class EcommerceStoreDomainBinding {
  [OptionalProps]?: 'isPrimary' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'store_id', type: 'uuid' })
  storeId!: string

  @Property({ name: 'domain_mapping_id', type: 'uuid' })
  domainMappingId!: string

  @Property({ name: 'path_prefix', type: 'text', nullable: true })
  pathPrefix?: string | null

  @Property({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ecommerce_store_channel_bindings' })
@Index({ name: 'ecommerce_store_channel_bindings_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ecommerce_store_channel_bindings_store_idx', properties: ['storeId'] })
@Index({
  name: 'ecommerce_store_channel_bindings_store_default_unique',
  expression:
    'create unique index "ecommerce_store_channel_bindings_store_default_unique" on "ecommerce_store_channel_bindings" ("store_id") where "is_default" and "deleted_at" is null',
})
export class EcommerceStoreChannelBinding {
  [OptionalProps]?: 'priceSortFallback' | 'isDefault' | 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ name: 'assortment_scope', type: 'jsonb', nullable: true })
  assortmentScope?: AssortmentScope | null

  @Property({ name: 'price_sort_fallback', type: 'text', default: 'approximate' })
  priceSortFallback: EcommercePriceSortFallback = 'approximate'

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
