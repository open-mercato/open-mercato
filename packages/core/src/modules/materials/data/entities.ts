import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export type MaterialKind = 'raw' | 'semi' | 'final' | 'tool' | 'indirect'
export type MaterialLifecycleState = 'draft' | 'active' | 'phase_out' | 'obsolete'

@Entity({ tableName: 'materials' })
@Index({ name: 'materials_org_tenant_kind_idx', properties: ['organizationId', 'tenantId', 'kind'] })
@Index({ name: 'materials_org_tenant_lifecycle_idx', properties: ['organizationId', 'tenantId', 'lifecycleState'] })
@Index({
  name: 'materials_org_code_unique',
  expression:
    `create unique index "materials_org_code_unique" on "materials" ("organization_id", "code") where deleted_at is null`,
})
export class Material {
  [OptionalProps]?:
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'lifecycleState'
    | 'isPurchasable'
    | 'isSellable'
    | 'isStockable'
    | 'isProducible'

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

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text' })
  kind!: MaterialKind

  @Property({ name: 'lifecycle_state', type: 'text', default: 'draft' })
  lifecycleState: MaterialLifecycleState = 'draft'

  @Property({ name: 'replacement_material_id', type: 'uuid', nullable: true })
  replacementMaterialId?: string | null

  @Property({ name: 'base_unit_id', type: 'uuid', nullable: true })
  baseUnitId?: string | null

  // Capability flags. Phase 1: is_purchasable / is_stockable / is_producible are user-settable
  // (no profile tables yet for those capabilities). is_sellable is materialized from
  // MaterialSalesProfile row existence — direct mutation is rejected by validator on Material
  // update; toggle by creating/deleting the sales profile via /api/materials/[id]/sales-profile.
  // Subscriber subscribers/sync-sales-capability.ts re-syncs the flag on every sales profile event.
  @Property({ name: 'is_purchasable', type: 'boolean', default: true })
  isPurchasable: boolean = true

  @Property({ name: 'is_sellable', type: 'boolean', default: false })
  isSellable: boolean = false

  @Property({ name: 'is_stockable', type: 'boolean', default: true })
  isStockable: boolean = true

  @Property({ name: 'is_producible', type: 'boolean', default: false })
  isProducible: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export type MaterialUnitUsage = 'stock' | 'purchase' | 'sales' | 'production'

@Entity({ tableName: 'material_units' })
@Index({ name: 'material_units_material_usage_idx', properties: ['materialId', 'usage'] })
@Index({
  name: 'material_units_material_code_unique',
  expression:
    `create unique index "material_units_material_code_unique" on "material_units" ("material_id", "code") where deleted_at is null`,
})
@Index({
  name: 'material_units_material_base_unique',
  expression:
    `create unique index "material_units_material_base_unique" on "material_units" ("material_id") where is_base = true and deleted_at is null`,
})
@Index({
  name: 'material_units_material_default_per_usage_unique',
  expression:
    `create unique index "material_units_material_default_per_usage_unique" on "material_units" ("material_id", "usage") where is_default_for_usage = true and deleted_at is null`,
})
export class MaterialUnit {
  [OptionalProps]?:
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'isBase'
    | 'isDefaultForUsage'
    | 'factor'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'material_id', type: 'uuid' })
  materialId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text' })
  usage!: MaterialUnitUsage

  // Numeric stored as text in pg via mikroORM v7 default. Conversion factor from this unit
  // to the material's base unit. 1.0 for the base unit itself.
  @Property({ type: 'decimal', precision: 18, scale: 6 })
  factor: string = '1.000000'

  @Property({ name: 'is_base', type: 'boolean', default: false })
  isBase: boolean = false

  @Property({ name: 'is_default_for_usage', type: 'boolean', default: false })
  isDefaultForUsage: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'material_supplier_links' })
@Index({ name: 'material_supplier_links_material_idx', properties: ['materialId'] })
@Index({ name: 'material_supplier_links_supplier_idx', properties: ['supplierCompanyId'] })
@Index({
  name: 'material_supplier_links_preferred_unique',
  expression:
    `create unique index "material_supplier_links_preferred_unique" on "material_supplier_links" ("material_id") where preferred = true and deleted_at is null`,
})
@Index({
  name: 'material_supplier_links_material_supplier_unique',
  expression:
    `create unique index "material_supplier_links_material_supplier_unique" on "material_supplier_links" ("material_id", "supplier_company_id") where deleted_at is null`,
})
export class MaterialSupplierLink {
  [OptionalProps]?:
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'preferred'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'material_id', type: 'uuid' })
  materialId!: string

  // FK ID only — no MikroORM relation (cross-module rule per AGENTS.md). Validator checks
  // existence in CustomerCompanyProfile within the same org/tenant scope.
  @Property({ name: 'supplier_company_id', type: 'uuid' })
  supplierCompanyId!: string

  @Property({ name: 'supplier_sku', type: 'text', nullable: true })
  supplierSku?: string | null

  @Property({ name: 'min_order_qty', type: 'decimal', precision: 18, scale: 6, nullable: true })
  minOrderQty?: string | null

  @Property({ name: 'lead_time_days', type: 'integer', nullable: true })
  leadTimeDays?: number | null

  @Property({ type: 'boolean', default: false })
  preferred: boolean = false

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'material_prices' })
@Index({ name: 'material_prices_supplier_link_valid_from_idx', properties: ['materialSupplierLinkId', 'validFrom'] })
@Index({ name: 'material_prices_currency_idx', properties: ['currencyId'] })
export class MaterialPrice {
  [OptionalProps]?:
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'
    | 'baseCurrencyAmount'
    | 'baseCurrencyAt'
    | 'validFrom'
    | 'validTo'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'material_supplier_link_id', type: 'uuid' })
  materialSupplierLinkId!: string

  // Original supplier price in their currency. Stored as numeric string by mikroORM v7.
  @Property({ name: 'price_amount', type: 'decimal', precision: 18, scale: 6 })
  priceAmount!: string

  // FK ID into currencies.currencies — validator checks existence in scope.
  @Property({ name: 'currency_id', type: 'uuid' })
  currencyId!: string

  // Cached conversion to tenant base currency. Null until FX subscriber populates it (Step 9).
  @Property({ name: 'base_currency_amount', type: 'decimal', precision: 18, scale: 6, nullable: true })
  baseCurrencyAmount?: string | null

  @Property({ name: 'base_currency_at', type: Date, nullable: true })
  baseCurrencyAt?: Date | null

  // Optional validity window. valid_to defaults open (NULL = "current").
  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'material_lifecycle_events' })
@Index({
  name: 'material_lifecycle_events_material_changed_idx',
  expression:
    `create index "material_lifecycle_events_material_changed_idx" on "material_lifecycle_events" ("material_id", "changed_at" desc)`,
})
export class MaterialLifecycleEvent {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'material_id', type: 'uuid' })
  materialId!: string

  @Property({ name: 'from_state', type: 'text' })
  fromState!: MaterialLifecycleState

  @Property({ name: 'to_state', type: 'text' })
  toState!: MaterialLifecycleState

  @Property({ name: 'changed_by_user_id', type: 'uuid', nullable: true })
  changedByUserId?: string | null

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'replacement_material_id', type: 'uuid', nullable: true })
  replacementMaterialId?: string | null

  @Property({ name: 'changed_at', type: Date })
  changedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'material_sales_profiles' })
@Index({
  name: 'material_sales_profiles_material_unique',
  expression:
    `create unique index "material_sales_profiles_material_unique" on "material_sales_profiles" ("material_id") where deleted_at is null`,
})
@Index({
  name: 'material_sales_profiles_org_gtin_unique',
  expression:
    `create unique index "material_sales_profiles_org_gtin_unique" on "material_sales_profiles" ("organization_id", "gtin") where gtin is not null and deleted_at is null`,
})
export class MaterialSalesProfile {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // 1:1 owning side. FK ID only — no MikroORM relation across module-internal aggregate (kept as
  // bare uuid for symmetry with other intra-module references and to keep load patterns explicit).
  @Property({ name: 'material_id', type: 'uuid' })
  materialId!: string

  @Property({ type: 'text', nullable: true })
  gtin?: string | null

  @Property({ name: 'commodity_code', type: 'text', nullable: true })
  commodityCode?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
