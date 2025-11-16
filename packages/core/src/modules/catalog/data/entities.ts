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
import type {
  CatalogOfferLocalizedContent,
  CatalogPriceDisplayMode,
  CatalogProductOptionSchema,
  CatalogProductRelationType,
  CatalogProductType,
} from './types'

@Entity({ tableName: 'catalog_product_option_schemas' })
@Index({
  name: 'catalog_product_option_schemas_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'catalog_product_option_schemas_code_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class CatalogOptionSchemaTemplate {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'schema', type: 'jsonb' })
  schema!: CatalogProductOptionSchema

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'catalog_products' })
@Index({ name: 'catalog_products_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'catalog_products_sku_scope_unique', properties: ['organizationId', 'tenantId', 'sku'] })
@Unique({ name: 'catalog_products_handle_scope_unique', properties: ['organizationId', 'tenantId', 'handle'] })
export class CatalogProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  subtitle?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ type: 'text', nullable: true })
  handle?: string | null

  @Property({ name: 'product_type', type: 'text', default: 'simple' })
  productType: CatalogProductType = 'simple'

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'primary_currency_code', type: 'text', nullable: true })
  primaryCurrencyCode?: string | null

  @Property({ name: 'default_unit', type: 'text', nullable: true })
  defaultUnit?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_fieldset_code', type: 'text', nullable: true })
  customFieldsetCode?: string | null

  @ManyToOne(() => CatalogOptionSchemaTemplate, {
    fieldName: 'option_schema_id',
    nullable: true,
    deleteRule: 'set null',
  })
  optionSchemaTemplate?: CatalogOptionSchemaTemplate | null

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

  @OneToMany(() => CatalogOffer, (offer) => offer.product)
  offers = new Collection<CatalogOffer>(this)

}

@Entity({ tableName: 'catalog_product_offers' })
@Index({ name: 'catalog_product_offers_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'catalog_product_offers_product_channel_unique',
  properties: ['product', 'organizationId', 'tenantId', 'channelId'],
})
export class CatalogOffer {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProduct, { fieldName: 'product_id', deleteRule: 'cascade' })
  product!: CatalogProduct

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'channel_id', type: 'uuid' })
  channelId!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'localized_content', type: 'jsonb', nullable: true })
  localizedContent?: CatalogOfferLocalizedContent | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => CatalogProductPrice, (price) => price.offer)
  prices = new Collection<CatalogProductPrice>(this)
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

  @Property({ name: 'custom_fieldset_code', type: 'text', nullable: true })
  customFieldsetCode?: string | null

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

  @OneToMany(() => CatalogProductVariantRelation, (relation) => relation.parentVariant)
  componentRelations = new Collection<CatalogProductVariantRelation>(this)

  @OneToMany(() => CatalogProductVariantRelation, (relation) => relation.childVariant)
  parentRelations = new Collection<CatalogProductVariantRelation>(this)
}

@Entity({ tableName: 'catalog_product_variant_relations' })
@Index({
  name: 'catalog_product_variant_relations_parent_idx',
  properties: ['parentVariant', 'organizationId', 'tenantId'],
})
@Index({
  name: 'catalog_product_variant_relations_child_idx',
  properties: ['childVariant', 'organizationId', 'tenantId'],
})
@Unique({
  name: 'catalog_product_variant_relations_unique',
  properties: ['parentVariant', 'childVariant', 'relationType'],
})
export class CatalogProductVariantRelation {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProductVariant, {
    fieldName: 'parent_variant_id',
    deleteRule: 'cascade',
  })
  parentVariant!: CatalogProductVariant

  @ManyToOne(() => CatalogProductVariant, {
    fieldName: 'child_variant_id',
    deleteRule: 'cascade',
  })
  childVariant!: CatalogProductVariant

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'relation_type', type: 'text' })
  relationType: CatalogProductRelationType = 'grouped'

  @Property({ name: 'is_required', type: 'boolean', default: false })
  isRequired: boolean = false

  @Property({ name: 'min_quantity', type: 'integer', nullable: true })
  minQuantity?: number | null

  @Property({ name: 'max_quantity', type: 'integer', nullable: true })
  maxQuantity?: number | null

  @Property({ type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
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

  @Property({ name: 'input_type', type: 'text', default: 'select' })
  inputType: 'select' | 'text' | 'textarea' | 'number' = 'select'

  @Property({ name: 'input_config', type: 'jsonb', nullable: true })
  inputConfig?: Record<string, unknown> | null

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

@Entity({ tableName: 'catalog_price_kinds' })
@Index({
  name: 'catalog_price_kinds_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'catalog_price_kinds_code_scope_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class CatalogPriceKind {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  title!: string

  @Property({ name: 'display_mode', type: 'text', default: 'excluding-tax' })
  displayMode: CatalogPriceDisplayMode = 'excluding-tax'

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'is_promotion', type: 'boolean', default: false })
  isPromotion: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => CatalogProductPrice, (price) => price.priceKind)
  prices = new Collection<CatalogProductPrice>(this)
}

@Entity({ tableName: 'catalog_product_prices' })
@Index({ name: 'catalog_product_prices_variant_scope_idx', properties: ['variant', 'organizationId', 'tenantId'] })
@Index({ name: 'catalog_product_prices_product_scope_idx', properties: ['product', 'organizationId', 'tenantId'] })
export class CatalogProductPrice {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => CatalogProductVariant, { fieldName: 'variant_id', nullable: true })
  variant?: CatalogProductVariant | null

  @ManyToOne(() => CatalogProduct, { fieldName: 'product_id', nullable: true })
  product?: CatalogProduct | null

  @ManyToOne(() => CatalogOffer, { fieldName: 'offer_id', nullable: true })
  offer?: CatalogOffer | null

  @ManyToOne(() => CatalogPriceKind, { fieldName: 'price_kind_id', onDelete: 'restrict' })
  priceKind!: CatalogPriceKind

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'kind', type: 'text', default: 'regular' })
  kind: string = 'regular'

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

  @Property({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null

  @Property({ name: 'user_id', type: 'uuid', nullable: true })
  userId?: string | null

  @Property({ name: 'user_group_id', type: 'uuid', nullable: true })
  userGroupId?: string | null

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'customer_group_id', type: 'uuid', nullable: true })
  customerGroupId?: string | null

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
