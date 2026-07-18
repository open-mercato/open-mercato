import { Entity, Enum, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type WorkCenterKind = 'machine' | 'manual' | 'line' | 'subcontractor'
export type TechnologyStatus = 'draft' | 'active' | 'archived'
export type ProcurementType = 'make' | 'buy'
export type StockMovementType = 'receipt' | 'issue' | 'adjustment'
export type StockMovementSourceType = 'order' | 'report' | 'import' | 'manual'
export type MaterialReservationStatus = 'active' | 'released' | 'consumed'

@Entity({ tableName: 'production_work_centers' })
@Index({ name: 'production_work_centers_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class WorkCenter {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  name!: string

  @Enum({ items: ['machine', 'manual', 'line', 'subcontractor'], type: 'text', name: 'kind' })
  kind!: WorkCenterKind

  @Property({ name: 'cost_rate_per_hour', type: 'numeric', precision: 18, scale: 4 })
  costRatePerHour!: string

  @Property({ name: 'parallel_stations', type: 'integer', default: 1 })
  parallelStations: number = 1

  @Property({ name: 'efficiency_factor', type: 'numeric', precision: 8, scale: 4, default: 1 })
  efficiencyFactor: string = '1'

  @Property({ name: 'availability_rule_set_id', type: 'uuid', nullable: true })
  availabilityRuleSetId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_boms' })
@Index({ name: 'production_boms_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'production_boms_scope_version_unique',
  properties: ['tenantId', 'organizationId', 'productId', 'variantId', 'version'],
})
export class ProductionBom {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'integer' })
  version!: number

  @Enum({ items: ['draft', 'active', 'archived'], type: 'text', name: 'status', default: 'draft' })
  status: TechnologyStatus = 'draft'

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_bom_items' })
@Index({ name: 'production_bom_items_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_bom_items_bom_idx', properties: ['bomId'] })
export class ProductionBomItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'bom_id', type: 'uuid' })
  bomId!: string

  @Property({ name: 'component_product_id', type: 'uuid' })
  componentProductId!: string

  @Property({ name: 'component_variant_id', type: 'uuid', nullable: true })
  componentVariantId?: string | null

  @Property({ name: 'qty_per_unit', type: 'numeric', precision: 18, scale: 6 })
  qtyPerUnit!: string

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'scrap_factor', type: 'numeric', precision: 8, scale: 6, default: 0 })
  scrapFactor: string = '0'

  @Property({ name: 'is_phantom', type: 'boolean', default: false })
  isPhantom: boolean = false

  @Property({ name: 'operation_sequence', type: 'integer', nullable: true })
  operationSequence?: number | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_routings' })
@Index({ name: 'production_routings_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'production_routings_scope_version_unique',
  properties: ['tenantId', 'organizationId', 'productId', 'variantId', 'version'],
})
export class Routing {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'integer' })
  version!: number

  @Enum({ items: ['draft', 'active', 'archived'], type: 'text', name: 'status', default: 'draft' })
  status: TechnologyStatus = 'draft'

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_routing_operations' })
@Index({ name: 'production_routing_operations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_routing_operations_routing_idx', properties: ['routingId', 'sequence'] })
export class RoutingOperation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'routing_id', type: 'uuid' })
  routingId!: string

  @Property({ type: 'integer' })
  sequence!: number

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'work_center_id', type: 'uuid' })
  workCenterId!: string

  @Property({ name: 'setup_time_minutes', type: 'numeric', precision: 12, scale: 2, default: 0 })
  setupTimeMinutes: string = '0'

  @Property({ name: 'run_time_per_unit_seconds', type: 'numeric', precision: 12, scale: 4, default: 0 })
  runTimePerUnitSeconds: string = '0'

  @Property({ name: 'is_reporting_point', type: 'boolean', default: false })
  isReportingPoint: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_planning_params' })
@Index({ name: 'production_planning_params_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'production_planning_params_scope_unique',
  properties: ['tenantId', 'organizationId', 'productId', 'variantId'],
})
export class ProductPlanningParams {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Enum({ items: ['make', 'buy'], type: 'text', name: 'procurement' })
  procurement!: ProcurementType

  @Property({ name: 'lead_time_days', type: 'integer', default: 0 })
  leadTimeDays: number = 0

  @Property({ name: 'min_lot', type: 'numeric', precision: 18, scale: 6, default: 0 })
  minLot: string = '0'

  @Property({ name: 'lot_multiple', type: 'numeric', precision: 18, scale: 6, default: 0 })
  lotMultiple: string = '0'

  @Property({ name: 'safety_stock', type: 'numeric', precision: 18, scale: 6, default: 0 })
  safetyStock: string = '0'

  @Property({ name: 'backflush', type: 'boolean', default: true })
  backflush: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// Stock ledger (spec § Data Models, decisions h/i/j — Phase 2 mini-ledger).
// `production_stock_items`/`production_stock_batches` track on-hand quantity
// only (no valuation, fence j); `production_stock_movements` is append-only
// (decision h — corrections are compensating movements referencing
// `reversesMovementId`, rows are never updated/deleted after creation, so this
// entity intentionally has no `deletedAt`/mutable `updatedAt` semantics).
// ---------------------------------------------------------------------------

@Entity({ tableName: 'production_stock_items' })
@Index({ name: 'production_stock_items_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'production_stock_items_scope_product_unique',
  properties: ['tenantId', 'organizationId', 'productId', 'variantId'],
})
export class StockItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'on_hand', type: 'numeric', precision: 18, scale: 6, default: 0 })
  onHand: string = '0'

  @Property({ name: 'reserved', type: 'numeric', precision: 18, scale: 6, default: 0 })
  reserved: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_stock_batches' })
@Index({ name: 'production_stock_batches_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_stock_batches_stock_item_idx', properties: ['stockItemId'] })
@Unique({
  name: 'production_stock_batches_item_number_unique',
  properties: ['stockItemId', 'batchNumber'],
})
export class StockBatch {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'stock_item_id', type: 'uuid' })
  stockItemId!: string

  @Property({ name: 'batch_number', type: 'text' })
  batchNumber!: string

  @Property({ name: 'on_hand', type: 'numeric', precision: 18, scale: 6, default: 0 })
  onHand: string = '0'

  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_stock_movements' })
@Index({ name: 'production_stock_movements_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_stock_movements_product_idx', properties: ['productId', 'variantId'] })
@Unique({
  name: 'production_stock_movements_reverses_unique',
  properties: ['reversesMovementId'],
})
export class StockMovement {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: ['receipt', 'issue', 'adjustment'], type: 'text', name: 'movement_type' })
  movementType!: StockMovementType

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 6 })
  qty!: string

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'reason_entry_id', type: 'uuid', nullable: true })
  reasonEntryId?: string | null

  @Enum({ items: ['order', 'report', 'import', 'manual'], type: 'text', name: 'source_type' })
  sourceType!: StockMovementSourceType

  @Property({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string | null

  @Property({ name: 'reverses_movement_id', type: 'uuid', nullable: true })
  reversesMovementId?: string | null

  // Append-only (decision h): rows are created once and never updated or
  // soft-deleted, so this entity deliberately omits `updatedAt`/`deletedAt`.
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'production_material_reservations' })
@Index({ name: 'production_material_reservations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_material_reservations_stock_item_idx', properties: ['stockItemId'] })
export class MaterialReservation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'order_material_id', type: 'uuid', nullable: true })
  orderMaterialId?: string | null

  @Property({ name: 'stock_item_id', type: 'uuid' })
  stockItemId!: string

  @Property({ name: 'batch_id', type: 'uuid', nullable: true })
  batchId?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 6 })
  qty!: string

  @Property({ type: 'text' })
  uom!: string

  @Enum({ items: ['active', 'released', 'consumed'], type: 'text', name: 'status', default: 'active' })
  status: MaterialReservationStatus = 'active'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
