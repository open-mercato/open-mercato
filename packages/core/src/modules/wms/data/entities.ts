import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  OptionalProps,
} from '@mikro-orm/core'

@Entity({ tableName: 'wms_warehouses' })
@Index({ name: 'wms_warehouses_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_warehouses_org_code_unique', properties: ['organizationId', 'code'], options: { unique: true } })
export class Warehouse {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isActive'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'json', nullable: true })
  address?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  timezone?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_warehouse_locations' })
@Index({ name: 'wms_warehouse_locations_warehouse_idx', properties: ['warehouseId'] })
@Index({ name: 'wms_warehouse_locations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_warehouse_locations_warehouse_code_unique', properties: ['warehouseId', 'code'], options: { unique: true } })
export class WarehouseLocation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'isActive'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  type!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'capacity_units', type: 'float', nullable: true })
  capacityUnits?: number | null

  @Property({ name: 'capacity_weight', type: 'float', nullable: true })
  capacityWeight?: number | null

  @Property({ type: 'json', nullable: true })
  constraints?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_warehouse_zones' })
@Index({ name: 'wms_warehouse_zones_warehouse_idx', properties: ['warehouseId'] })
@Index({ name: 'wms_warehouse_zones_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WarehouseZone {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'int', default: 0 })
  priority: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_product_inventory_profiles' })
@Index({ name: 'wms_product_inventory_profiles_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_product_inventory_profiles_catalog_product_idx', properties: ['catalogProductId'] })
export class ProductInventoryProfile {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid', nullable: true })
  catalogVariantId?: string | null

  @Property({ name: 'default_uom', type: 'text', nullable: true })
  defaultUom?: string | null

  @Property({ name: 'track_lot', type: 'boolean', default: false })
  trackLot: boolean = false

  @Property({ name: 'track_serial', type: 'boolean', default: false })
  trackSerial: boolean = false

  @Property({ name: 'track_expiration', type: 'boolean', default: false })
  trackExpiration: boolean = false

  @Property({ name: 'default_strategy', type: 'text', default: 'fifo' })
  defaultStrategy: string = 'fifo'

  @Property({ name: 'reorder_point', type: 'float', nullable: true })
  reorderPoint?: number | null

  @Property({ name: 'safety_stock', type: 'float', nullable: true })
  safetyStock?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_inventory_lots' })
@Index({ name: 'wms_inventory_lots_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_inventory_lots_catalog_variant_idx', properties: ['catalogVariantId'] })
export class InventoryLot {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text', nullable: true })
  sku?: string | null

  @Property({ name: 'catalog_variant_id', type: 'uuid', nullable: true })
  catalogVariantId?: string | null

  @Property({ name: 'lot_number', type: 'text' })
  lotNumber!: string

  @Property({ name: 'batch_number', type: 'text', nullable: true })
  batchNumber?: string | null

  @Property({ name: 'manufactured_at', type: Date, nullable: true })
  manufacturedAt?: Date | null

  @Property({ name: 'best_before_at', type: Date, nullable: true })
  bestBeforeAt?: Date | null

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ type: 'text', default: 'available' })
  status: string = 'available'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_inventory_balances' })
@Index({ name: 'wms_inventory_balances_warehouse_location_idx', properties: ['warehouseId', 'locationId'] })
@Index({ name: 'wms_inventory_balances_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_inventory_balances_variant_lot_idx', properties: ['catalogVariantId', 'lotId'] })
export class InventoryBalance {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string

  @Property({ name: 'location_id', type: 'uuid' })
  locationId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ name: 'lot_id', type: 'uuid', nullable: true })
  lotId?: string | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ name: 'quantity_on_hand', type: 'float', default: 0 })
  quantityOnHand: number = 0

  @Property({ name: 'quantity_reserved', type: 'float', default: 0 })
  quantityReserved: number = 0

  @Property({ name: 'quantity_allocated', type: 'float', default: 0 })
  quantityAllocated: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_inventory_reservations' })
@Index({ name: 'wms_inventory_reservations_warehouse_idx', properties: ['warehouseId'] })
@Index({ name: 'wms_inventory_reservations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_inventory_reservations_source_idx', properties: ['sourceType', 'sourceId'] })
export class InventoryReservation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ name: 'lot_id', type: 'uuid', nullable: true })
  lotId?: string | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ type: 'float' })
  quantity!: number

  @Property({ name: 'source_type', type: 'text' })
  sourceType!: string

  @Property({ name: 'source_id', type: 'uuid' })
  sourceId!: string

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ type: 'text', default: 'active' })
  status: string = 'active'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_inventory_movements' })
@Index({ name: 'wms_inventory_movements_warehouse_idx', properties: ['warehouseId'] })
@Index({ name: 'wms_inventory_movements_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'wms_inventory_movements_reference_idx', properties: ['referenceType', 'referenceId'] })
export class InventoryMovement {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'warehouse_id', type: 'uuid' })
  warehouseId!: string

  @Property({ name: 'location_from_id', type: 'uuid', nullable: true })
  locationFromId?: string | null

  @Property({ name: 'location_to_id', type: 'uuid', nullable: true })
  locationToId?: string | null

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ name: 'lot_id', type: 'uuid', nullable: true })
  lotId?: string | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ type: 'float' })
  quantity!: number

  @Property({ type: 'text' })
  type!: string

  @Property({ name: 'reference_type', type: 'text', nullable: true })
  referenceType?: string | null

  @Property({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId?: string | null

  @Property({ name: 'performed_by', type: 'uuid', nullable: true })
  performedBy?: string | null

  @Property({ name: 'performed_at', type: Date, onCreate: () => new Date() })
  performedAt: Date = new Date()

  @Property({ type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

export default [
  Warehouse,
  WarehouseLocation,
  WarehouseZone,
  ProductInventoryProfile,
  InventoryLot,
  InventoryBalance,
  InventoryReservation,
  InventoryMovement,
]
