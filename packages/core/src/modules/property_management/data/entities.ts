import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type BuildingStatus = 'active' | 'archived'
export type CommonAreaKind = 'corridor' | 'kitchen' | 'toilets' | 'lobby' | 'stairs_lifts' | 'storage' | 'other'
export type ProductUseKind = 'leasable' | 'bookable'
export type BillingUnit = 'month' | 'hour' | 'day'

type ScopedOptionalProps = 'createdAt' | 'updatedAt' | 'deletedAt'

@Entity({ tableName: 'property_management_buildings' })
@Index({ name: 'property_management_buildings_org_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'property_management_buildings_scope_idx', properties: ['organizationId', 'tenantId'] })
export class Building {
  [OptionalProps]?: ScopedOptionalProps | 'status' | 'archivedAt' | 'openingHoursEnabled'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  address!: string

  @Property({ type: 'text', default: 'active' })
  status: BuildingStatus = 'active'

  @Property({ name: 'archived_at', type: Date, nullable: true })
  archivedAt?: Date | null

  @Property({ name: 'opening_hours_enabled', type: 'boolean', default: false })
  openingHoursEnabled: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_building_managers' })
@Unique({ name: 'property_management_building_managers_unique', properties: ['buildingId', 'userId'] })
@Index({ name: 'property_management_building_managers_user_idx', properties: ['organizationId', 'userId'] })
export class BuildingManager {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'user_id', type: 'uuid' })
  userId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'property_management_floors' })
@Index({ name: 'property_management_floors_building_idx', properties: ['organizationId', 'buildingId'] })
@Index({
  name: 'property_management_floors_number_unique',
  expression:
    'create unique index "property_management_floors_number_unique" on "property_management_floors" ("building_id", "number") where "deleted_at" is null',
})
export class Floor {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ type: 'int' })
  number!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'size_x', type: 'numeric', precision: 7, scale: 2 })
  sizeX!: string

  @Property({ name: 'size_y', type: 'numeric', precision: 7, scale: 2 })
  sizeY!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_spaces' })
@Index({ name: 'property_management_spaces_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_spaces_building_idx', properties: ['organizationId', 'buildingId'] })
export class Space {
  [OptionalProps]?: ScopedOptionalProps | 'purpose' | 'isDefault'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  purpose?: string | null

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_units' })
@Index({ name: 'property_management_units_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_units_space_idx', properties: ['organizationId', 'spaceId'] })
@Index({ name: 'property_management_units_product_idx', properties: ['organizationId', 'catalogProductId'] })
@Index({ name: 'property_management_units_building_idx', properties: ['organizationId', 'buildingId'] })
export class Unit {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ name: 'space_id', type: 'uuid' })
  spaceId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'catalog_category_id', type: 'uuid' })
  catalogCategoryId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_unit_product_periods' })
@Index({ name: 'property_management_unit_product_periods_unit_idx', properties: ['organizationId', 'unitId', 'validFrom'] })
@Index({
  name: 'property_management_unit_product_periods_open_unique',
  expression:
    'create unique index "property_management_unit_product_periods_open_unique" on "property_management_unit_product_periods" ("unit_id") where "valid_to" is null',
})
export class UnitProductPeriod {
  [OptionalProps]?: 'createdAt' | 'validTo' | 'priceAmount' | 'currencyCode' | 'priceKindId'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'unit_id', type: 'uuid' })
  unitId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'product_name', type: 'text' })
  productName!: string

  @Property({ type: 'text' })
  use!: ProductUseKind

  @Property({ name: 'billing_unit', type: 'text' })
  billingUnit!: BillingUnit

  @Property({ name: 'price_amount', type: 'numeric', precision: 16, scale: 4, nullable: true })
  priceAmount?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'price_kind_id', type: 'uuid', nullable: true })
  priceKindId?: string | null

  @Property({ name: 'valid_from', type: Date })
  validFrom!: Date

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'property_management_common_areas' })
@Index({ name: 'property_management_common_areas_floor_idx', properties: ['organizationId', 'floorId'] })
@Index({ name: 'property_management_common_areas_building_idx', properties: ['organizationId', 'buildingId'] })
export class CommonArea {
  [OptionalProps]?: ScopedOptionalProps

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'building_id', type: 'uuid' })
  buildingId!: string

  @Property({ name: 'floor_id', type: 'uuid' })
  floorId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  kind!: CommonAreaKind

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  x!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  y!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  width!: string

  @Property({ type: 'numeric', precision: 7, scale: 2 })
  depth!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'property_management_product_uses' })
@Unique({ name: 'property_management_product_uses_product_unique', properties: ['organizationId', 'catalogProductId'] })
export class ProductUse {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ type: 'text' })
  use!: ProductUseKind

  @Property({ name: 'billing_unit', type: 'text' })
  billingUnit!: BillingUnit

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
