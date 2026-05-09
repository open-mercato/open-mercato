import { Collection, OptionalProps } from '@mikro-orm/core'
import {
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy'
import type { JsonValue } from '@open-mercato/shared/lib/json'

export type WarehouseLocationType = 'zone' | 'aisle' | 'rack' | 'bin' | 'slot' | 'dock' | 'staging'
export type InventoryStrategy = 'fifo' | 'lifo' | 'fefo'
export type InventoryLotStatus = 'available' | 'hold' | 'quarantine' | 'expired'
export type InventoryReservationSourceType = 'order' | 'transfer' | 'manual'
export type InventoryReservationStatus = 'active' | 'released' | 'fulfilled'
export type InventoryMovementType =
  | 'receipt'
  | 'putaway'
  | 'pick'
  | 'pack'
  | 'ship'
  | 'adjust'
  | 'transfer'
  | 'cycle_count'
  | 'return_receive'
export type InventoryMovementReferenceType = 'po' | 'so' | 'transfer' | 'manual' | 'qc' | 'rma'
type WmsOptionalProps = 'createdAt' | 'updatedAt' | 'deletedAt' | 'metadata'

abstract class WmsScopedEntity {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'jsonb', nullable: true })
  metadata?: JsonValue | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'wms_warehouses' })
@Index({ name: 'wms_warehouses_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'wms_warehouses_org_code_unique_idx',
  expression:
    'create unique index "wms_warehouses_org_code_unique_idx" on "wms_warehouses" ("organization_id", "code") where deleted_at is null',
})
export class Warehouse extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'isActive' | 'addressLine1' | 'city' | 'postalCode' | 'country' | 'timezone'

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null

  @Property({ type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ type: 'text', nullable: true })
  country?: string | null

  @Property({ type: 'text', nullable: true })
  timezone?: string | null

  @OneToMany(() => WarehouseZone, (zone) => zone.warehouse)
  zones = new Collection<WarehouseZone>(this)

  @OneToMany(() => WarehouseLocation, (location) => location.warehouse)
  locations = new Collection<WarehouseLocation>(this)
}

@Entity({ tableName: 'wms_warehouse_zones' })
@Index({ name: 'wms_warehouse_zones_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'wms_warehouse_zones_warehouse_idx', properties: ['warehouse'] })
@Index({
  name: 'wms_warehouse_zones_warehouse_code_unique_idx',
  expression:
    'create unique index "wms_warehouse_zones_warehouse_code_unique_idx" on "wms_warehouse_zones" ("warehouse_id", "code") where deleted_at is null',
})
export class WarehouseZone extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'priority'

  @ManyToOne(() => Warehouse, { fieldName: 'warehouse_id' })
  warehouse!: Warehouse

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'integer', default: 0 })
  priority: number = 0
}

@Entity({ tableName: 'wms_warehouse_locations' })
@Index({ name: 'wms_warehouse_locations_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'wms_warehouse_locations_warehouse_idx', properties: ['warehouse'] })
@Index({ name: 'wms_warehouse_locations_parent_idx', properties: ['parent'] })
@Index({
  name: 'wms_warehouse_locations_warehouse_code_unique_idx',
  expression:
    'create unique index "wms_warehouse_locations_warehouse_code_unique_idx" on "wms_warehouse_locations" ("warehouse_id", "code") where deleted_at is null',
})
export class WarehouseLocation extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'parent' | 'isActive' | 'capacityUnits' | 'capacityWeight' | 'constraints'

  @ManyToOne(() => Warehouse, { fieldName: 'warehouse_id' })
  warehouse!: Warehouse

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  type!: WarehouseLocationType

  @ManyToOne(() => WarehouseLocation, { fieldName: 'parent_id', nullable: true })
  parent?: WarehouseLocation | null

  @OneToMany(() => WarehouseLocation, (location) => location.parent)
  children = new Collection<WarehouseLocation>(this)

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'capacity_units', type: 'numeric', precision: 16, scale: 4, nullable: true })
  capacityUnits?: string | null

  @Property({ name: 'capacity_weight', type: 'numeric', precision: 16, scale: 4, nullable: true })
  capacityWeight?: string | null

  @Property({ type: 'jsonb', nullable: true })
  constraints?: JsonValue | null
}

@Entity({ tableName: 'wms_product_inventory_profiles' })
@Index({ name: 'wms_inventory_profiles_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'wms_inventory_profiles_variant_unique_idx',
  expression:
    'create unique index "wms_inventory_profiles_variant_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_variant_id") where deleted_at is null and catalog_variant_id is not null',
})
@Index({
  name: 'wms_inventory_profiles_product_unique_idx',
  expression:
    'create unique index "wms_inventory_profiles_product_unique_idx" on "wms_product_inventory_profiles" ("organization_id", "catalog_product_id") where deleted_at is null and catalog_variant_id is null',
})
export class ProductInventoryProfile extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'catalogVariantId' | 'trackLot' | 'trackSerial' | 'trackExpiration' | 'reorderPoint' | 'safetyStock'

  @Property({ name: 'catalog_product_id', type: 'uuid' })
  catalogProductId!: string

  @Property({ name: 'catalog_variant_id', type: 'uuid', nullable: true })
  catalogVariantId?: string | null

  @Property({ name: 'default_uom', type: 'text' })
  defaultUom!: string

  @Property({ name: 'track_lot', type: 'boolean', default: false })
  trackLot: boolean = false

  @Property({ name: 'track_serial', type: 'boolean', default: false })
  trackSerial: boolean = false

  @Property({ name: 'track_expiration', type: 'boolean', default: false })
  trackExpiration: boolean = false

  @Property({ name: 'default_strategy', type: 'text' })
  defaultStrategy!: InventoryStrategy

  @Property({ name: 'reorder_point', type: 'numeric', precision: 16, scale: 4, default: '0' })
  reorderPoint: string = '0'

  @Property({ name: 'safety_stock', type: 'numeric', precision: 16, scale: 4, default: '0' })
  safetyStock: string = '0'
}

@Entity({ tableName: 'wms_inventory_lots' })
@Index({ name: 'wms_inventory_lots_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'wms_inventory_lots_variant_idx', properties: ['catalogVariantId'] })
@Index({
  name: 'wms_inventory_lots_variant_lot_unique_idx',
  expression:
    'create unique index "wms_inventory_lots_variant_lot_unique_idx" on "wms_inventory_lots" ("organization_id", "catalog_variant_id", "lot_number") where deleted_at is null',
})
export class InventoryLot extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'batchNumber' | 'manufacturedAt' | 'bestBeforeAt' | 'expiresAt'

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @Property({ type: 'text' })
  sku!: string

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
  status: InventoryLotStatus = 'available'
}

@Entity({ tableName: 'wms_inventory_balances' })
@Index({ name: 'wms_inventory_balances_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'wms_inventory_balances_org_warehouse_variant_idx', properties: ['organizationId', 'warehouse', 'catalogVariantId'] })
@Index({ name: 'wms_inventory_balances_org_location_variant_idx', properties: ['organizationId', 'location', 'catalogVariantId'] })
@Index({
  name: 'wms_inventory_balances_org_lot_idx',
  expression:
    'create index "wms_inventory_balances_org_lot_idx" on "wms_inventory_balances" ("organization_id", "lot_id") where lot_id is not null and deleted_at is null',
})
@Index({
  name: 'wms_inventory_balances_serial_unique_idx',
  expression:
    'create unique index "wms_inventory_balances_serial_unique_idx" on "wms_inventory_balances" ("organization_id", "warehouse_id", "location_id", "catalog_variant_id", "serial_number") where serial_number is not null and deleted_at is null',
})
export class InventoryBalance extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'lot' | 'serialNumber' | 'quantityAvailable'

  @ManyToOne(() => Warehouse, { fieldName: 'warehouse_id' })
  warehouse!: Warehouse

  @ManyToOne(() => WarehouseLocation, { fieldName: 'location_id' })
  location!: WarehouseLocation

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @ManyToOne(() => InventoryLot, { fieldName: 'lot_id', nullable: true })
  lot?: InventoryLot | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ name: 'quantity_on_hand', type: 'numeric', precision: 16, scale: 4, default: '0' })
  quantityOnHand: string = '0'

  @Property({ name: 'quantity_reserved', type: 'numeric', precision: 16, scale: 4, default: '0' })
  quantityReserved: string = '0'

  @Property({ name: 'quantity_allocated', type: 'numeric', precision: 16, scale: 4, default: '0' })
  quantityAllocated: string = '0'

  get quantityAvailable(): number {
    return Number(this.quantityOnHand) - Number(this.quantityReserved) - Number(this.quantityAllocated)
  }
}

@Entity({ tableName: 'wms_inventory_reservations' })
@Index({ name: 'wms_inventory_reservations_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'wms_inventory_reservations_source_idx', properties: ['organizationId', 'sourceType', 'sourceId'] })
@Index({ name: 'wms_inventory_reservations_status_idx', properties: ['organizationId', 'warehouse', 'catalogVariantId', 'status'] })
export class InventoryReservation extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'lot' | 'serialNumber' | 'expiresAt'

  @ManyToOne(() => Warehouse, { fieldName: 'warehouse_id' })
  warehouse!: Warehouse

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @ManyToOne(() => InventoryLot, { fieldName: 'lot_id', nullable: true })
  lot?: InventoryLot | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ type: 'numeric', precision: 16, scale: 4 })
  quantity!: string

  @Property({ name: 'source_type', type: 'text' })
  sourceType!: InventoryReservationSourceType

  @Property({ name: 'source_id', type: 'uuid' })
  sourceId!: string

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ type: 'text', default: 'active' })
  status: InventoryReservationStatus = 'active'
}

@Entity({ tableName: 'wms_inventory_movements' })
@Index({ name: 'wms_inventory_movements_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({
  name: 'wms_inventory_movements_variant_received_at_idx',
  expression:
    'create index "wms_inventory_movements_variant_received_at_idx" on "wms_inventory_movements" ("organization_id", "catalog_variant_id", "received_at" desc) where deleted_at is null',
})
@Index({ name: 'wms_inventory_movements_reference_idx', properties: ['organizationId', 'referenceType', 'referenceId'] })
@Index({
  name: 'wms_inventory_movements_warehouse_performed_at_idx',
  expression:
    'create index "wms_inventory_movements_warehouse_performed_at_idx" on "wms_inventory_movements" ("organization_id", "warehouse_id", "performed_at" desc) where deleted_at is null',
})
export class InventoryMovement extends WmsScopedEntity {
  [OptionalProps]?: WmsOptionalProps | 'locationFrom' | 'locationTo' | 'lot' | 'serialNumber' | 'reason'

  @ManyToOne(() => Warehouse, { fieldName: 'warehouse_id' })
  warehouse!: Warehouse

  @ManyToOne(() => WarehouseLocation, { fieldName: 'location_from_id', nullable: true })
  locationFrom?: WarehouseLocation | null

  @ManyToOne(() => WarehouseLocation, { fieldName: 'location_to_id', nullable: true })
  locationTo?: WarehouseLocation | null

  @Property({ name: 'catalog_variant_id', type: 'uuid' })
  catalogVariantId!: string

  @ManyToOne(() => InventoryLot, { fieldName: 'lot_id', nullable: true })
  lot?: InventoryLot | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ type: 'numeric', precision: 16, scale: 4 })
  quantity!: string

  @Property({ type: 'text' })
  type!: InventoryMovementType

  @Property({ name: 'reference_type', type: 'text' })
  referenceType!: InventoryMovementReferenceType

  @Property({ name: 'reference_id', type: 'uuid' })
  referenceId!: string

  @Property({ name: 'performed_by', type: 'uuid' })
  performedBy!: string

  @Property({ name: 'performed_at', type: Date })
  performedAt!: Date

  @Property({ name: 'received_at', type: Date })
  receivedAt!: Date

  @Property({ type: 'text', nullable: true })
  reason?: string | null
}
