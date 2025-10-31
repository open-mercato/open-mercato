import {
  Collection,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  OptionalProps,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core'

@Entity({ tableName: 'catalog_products' })
@Index({ name: 'catalog_products_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'catalog_products_code_scope_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class CatalogProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

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

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'primary_currency_code', type: 'text', nullable: true })
  primaryCurrencyCode?: string | null

  @Property({ name: 'default_unit', type: 'text', nullable: true })
  defaultUnit?: string | null

  @Property({ name: 'channel_ids', type: 'jsonb', nullable: true })
  channelIds?: string[] | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_configurable', type: 'boolean', default: false })
  isConfigurable: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => CatalogProductVariant, (variant) => variant.product)
  variants = new Collection<CatalogProductVariant>(this)

  @OneToMany(() => CatalogProductOption, (option) => option.product)
  options = new Collection<CatalogProductOption>(this)
}

@Entity({ tableName: 'catalog_product_variants' })
@Index({ name: 'catalog_product_variants_scope_idx', properties: ['product', 'organizationId', 'tenantId'] })
@Unique({
  name: 'catalog_product_variants_sku_unique',
  properties: ['organizationId', 'tenantId', 'sku'],
})
export class CatalogProductVariant {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProduct, { fieldName: 'product_id' })
  product!: CatalogProduct

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  barcode?: string | null

  @Property({ type: 'text', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'weight_value', type: 'numeric', precision: 16, scale: 4, nullable: true })
  weightValue?: string | null

  @Property({ name: 'weight_unit', type: 'text', nullable: true })
  weightUnit?: string | null

  @Property({ name: 'dimensions', type: 'jsonb', nullable: true })
  dimensions?: {
    width?: number | null
    height?: number | null
    depth?: number | null
    unit?: string | null
  } | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => CatalogProductPrice, (price) => price.variant)
  prices = new Collection<CatalogProductPrice>(this)

  @OneToMany(() => CatalogVariantOptionValue, (optionValue) => optionValue.variant)
  optionValues = new Collection<CatalogVariantOptionValue>(this)
}

@Entity({ tableName: 'catalog_product_options' })
@Index({ name: 'catalog_product_options_scope_idx', properties: ['product', 'organizationId', 'tenantId'] })
export class CatalogProductOption {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProduct, { fieldName: 'product_id' })
  product!: CatalogProduct

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean = false

  @Property({ name: 'is_multiple', type: 'boolean', default: false })
  isMultiple: boolean = false

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => CatalogProductOptionValue, (value) => value.option)
  values = new Collection<CatalogProductOptionValue>(this)
}

@Entity({ tableName: 'catalog_product_option_values' })
@Index({ name: 'catalog_product_option_values_scope_idx', properties: ['option', 'organizationId', 'tenantId'] })
@Unique({
  name: 'catalog_product_option_values_code_unique',
  properties: ['organizationId', 'tenantId', 'option', 'code'],
})
export class CatalogProductOptionValue {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProductOption, { fieldName: 'option_id' })
  option!: CatalogProductOption

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => CatalogVariantOptionValue, (link) => link.optionValue)
  variantLinks = new Collection<CatalogVariantOptionValue>(this)
}

@Entity({ tableName: 'catalog_variant_option_values' })
@Unique({
  name: 'catalog_variant_option_values_unique',
  properties: ['variant', 'optionValue'],
})
export class CatalogVariantOptionValue {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProductVariant, { fieldName: 'variant_id' })
  variant!: CatalogProductVariant

  @ManyToOne(() => CatalogProductOptionValue, { fieldName: 'option_value_id' })
  optionValue!: CatalogProductOptionValue

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'catalog_product_prices' })
@Index({ name: 'catalog_product_prices_scope_idx', properties: ['variant', 'organizationId', 'tenantId'] })
@Unique({
  name: 'catalog_product_prices_unique',
  properties: ['variant', 'organizationId', 'tenantId', 'currencyCode', 'kind', 'minQuantity'],
})
export class CatalogProductPrice {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProductVariant, { fieldName: 'variant_id' })
  variant!: CatalogProductVariant

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ type: 'text', default: 'list' })
  kind: 'list' | 'sale' | 'tier' | 'custom' = 'list'

  @Property({ name: 'min_quantity', type: 'integer', default: 1 })
  minQuantity: number = 1

  @Property({ name: 'max_quantity', type: 'integer', nullable: true })
  maxQuantity?: number | null

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceNet?: string | null

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceGross?: string | null

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, nullable: true })
  taxRate?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'starts_at', type: Date, nullable: true })
  startsAt?: Date | null

  @Property({ name: 'ends_at', type: Date, nullable: true })
  endsAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
