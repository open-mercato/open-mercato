import { Entity, Enum, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type WorkCenterKind = 'machine' | 'manual' | 'line' | 'subcontractor'
export type TechnologyStatus = 'draft' | 'active' | 'archived'
export type ProcurementType = 'make' | 'buy'
export type StockMovementType = 'receipt' | 'issue' | 'adjustment'
export type StockMovementSourceType = 'order' | 'report' | 'import' | 'manual'
export type MaterialReservationStatus = 'active' | 'released' | 'consumed'
export type ProductionOrderStatus =
  | 'draft'
  | 'planned'
  | 'released'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled'
export type ProductionOrderSourceType = 'sales_order' | 'mrp' | 'manual'
export type ProductionOrderOperationStatus = 'pending' | 'in_progress' | 'done'
export type ProductionReportType = 'partial' | 'final'
export type MrpRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type MrpSuggestionType = 'make' | 'buy' | 'reschedule' | 'cancel'
export type MrpSuggestionStatus = 'open' | 'accepted' | 'dismissed' | 'superseded'

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

// ---------------------------------------------------------------------------
// Production orders (spec § Status machine / Data Models, Phase 3).
//
// `ProductionOrderOperation`/`ProductionOrderMaterial` are SNAPSHOT rows
// (decision g): `release` copies the currently-active `RoutingOperation`/
// `ProductionBomItem` rows into these tables as independent copies. A later
// edit to the source BOM/routing (even a whole new active version) never
// touches an already-released order — the order's operations/materials are
// its own persisted history, not a live view over the technology tables.
// `sourceOperationId`/`sourceBomItemId` are traceability-only FK-ids back to
// the row that was copied; they are NOT foreign keys the order re-reads at
// runtime.
//
// Sub-resources (operations, materials) are guarded by the PARENT order's
// `updated_at` (sales-document aggregate pattern, `enforceCommandOptimisticLock`
// — see `commands/shared.ts`), so neither entity below carries its own
// `updatedAt`-based lock surface.
// ---------------------------------------------------------------------------

@Entity({ tableName: 'production_orders' })
@Index({ name: 'production_orders_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  name: 'production_orders_scope_number_unique',
  properties: ['tenantId', 'organizationId', 'number'],
})
export class ProductionOrder {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'integer' })
  number!: number

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'qty_planned', type: 'numeric', precision: 18, scale: 6 })
  qtyPlanned!: string

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ type: 'integer', default: 0 })
  priority: number = 0

  @Enum({
    items: ['draft', 'planned', 'released', 'in_progress', 'completed', 'closed', 'cancelled'],
    type: 'text',
    name: 'status',
    default: 'draft',
  })
  status: ProductionOrderStatus = 'draft'

  @Enum({ items: ['sales_order', 'mrp', 'manual'], type: 'text', name: 'source_type', default: 'manual' })
  sourceType: ProductionOrderSourceType = 'manual'

  @Property({ name: 'source_id', type: 'uuid', nullable: true })
  sourceId?: string | null

  @Property({ name: 'bom_version_id', type: 'uuid', nullable: true })
  bomVersionId?: string | null

  @Property({ name: 'routing_version_id', type: 'uuid', nullable: true })
  routingVersionId?: string | null

  @Property({ name: 'released_at', type: Date, nullable: true })
  releasedAt?: Date | null

  @Property({ name: 'qty_completed', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyCompleted: string = '0'

  @Property({ name: 'qty_scrapped', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyScrapped: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_order_operations' })
@Index({ name: 'production_order_operations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_order_operations_order_idx', properties: ['orderId', 'sequence'] })
export class ProductionOrderOperation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

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

  @Enum({ items: ['pending', 'in_progress', 'done'], type: 'text', name: 'status', default: 'pending' })
  status: ProductionOrderOperationStatus = 'pending'

  @Property({ name: 'qty_good', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyGood: string = '0'

  @Property({ name: 'qty_scrap', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyScrap: string = '0'

  /** Traceability-only FK-id (spec decision g) — see module doc above. */
  @Property({ name: 'source_operation_id', type: 'uuid', nullable: true })
  sourceOperationId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_order_materials' })
@Index({ name: 'production_order_materials_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_order_materials_order_idx', properties: ['orderId'] })
export class ProductionOrderMaterial {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  @Property({ name: 'operation_sequence', type: 'integer', nullable: true })
  operationSequence?: number | null

  @Property({ name: 'component_product_id', type: 'uuid' })
  componentProductId!: string

  @Property({ name: 'component_variant_id', type: 'uuid', nullable: true })
  componentVariantId?: string | null

  @Property({ name: 'qty_required', type: 'numeric', precision: 18, scale: 6 })
  qtyRequired!: string

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'scrap_factor', type: 'numeric', precision: 8, scale: 6, default: 0 })
  scrapFactor: string = '0'

  @Property({ name: 'qty_issued', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyIssued: string = '0'

  /** Traceability-only FK-id (spec decision g) — see module doc above. */
  @Property({ name: 'source_bom_item_id', type: 'uuid', nullable: true })
  sourceBomItemId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// ---------------------------------------------------------------------------
// Shop-floor reports (spec § Data Models / Status machine, Phase 4).
//
// `ProductionReport` is **append-only + storno** (decision h, same exemption
// as `StockMovement`): a correction is a new compensating report row
// referencing `reversesReportId` (UNIQUE — a report can be reversed at most
// once), never a mutation/deletion of the original. This is why this entity
// intentionally has no `updatedAt`/`deletedAt` — see the `StockMovement`
// doc comment above for the identical reasoning.
// ---------------------------------------------------------------------------

@Entity({ tableName: 'production_reports' })
@Index({ name: 'production_reports_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_reports_operation_idx', properties: ['orderOperationId'] })
@Unique({
  name: 'production_reports_reverses_unique',
  properties: ['reversesReportId'],
})
export class ProductionReport {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_operation_id', type: 'uuid' })
  orderOperationId!: string

  @Property({ name: 'reporter_user_id', type: 'uuid' })
  reporterUserId!: string

  @Property({ name: 'qty_good', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyGood: string = '0'

  @Property({ name: 'qty_scrap', type: 'numeric', precision: 18, scale: 6, default: 0 })
  qtyScrap: string = '0'

  @Property({ name: 'scrap_reason_entry_id', type: 'uuid', nullable: true })
  scrapReasonEntryId?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  @Enum({ items: ['partial', 'final'], type: 'text', name: 'report_type' })
  reportType!: ProductionReportType

  @Property({ name: 'reverses_report_id', type: 'uuid', nullable: true })
  reversesReportId?: string | null

  // Append-only (decision h): rows are created once and never updated or
  // soft-deleted, so this entity deliberately omits `updatedAt`/`deletedAt`
  // (matches `StockMovement`).
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'production_mrp_runs' })
@Index({ name: 'production_mrp_runs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class MrpRun {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Enum({ items: ['pending', 'running', 'completed', 'failed'], type: 'text', name: 'status', default: 'pending' })
  status: MrpRunStatus = 'pending'

  @Property({ name: 'params', type: 'jsonb', nullable: true })
  params?: Record<string, unknown> | null

  @Property({ name: 'progress_job_id', type: 'uuid', nullable: true })
  progressJobId?: string | null

  @Property({ name: 'started_at', type: Date, nullable: true })
  startedAt?: Date | null

  @Property({ name: 'finished_at', type: Date, nullable: true })
  finishedAt?: Date | null

  @Property({ name: 'stats', type: 'jsonb', nullable: true })
  stats?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'production_mrp_suggestions' })
@Index({ name: 'production_mrp_suggestions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'production_mrp_suggestions_run_idx', properties: ['runId'] })
@Index({ name: 'production_mrp_suggestions_status_idx', properties: ['tenantId', 'organizationId', 'status'] })
export class MrpSuggestion {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'run_id', type: 'uuid' })
  runId!: string

  @Enum({ items: ['make', 'buy', 'reschedule', 'cancel'], type: 'text', name: 'suggestion_type' })
  suggestionType!: MrpSuggestionType

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'qty', type: 'numeric', precision: 18, scale: 6 })
  qty!: string

  @Property({ type: 'text' })
  uom!: string

  @Property({ name: 'due_date', type: Date })
  dueDate!: Date

  // Pegging refs (spec § Data Models: "demand_source jsonb (pegging)") — an
  // array of `{ productKey, source: { type, id }, qty }` entries copied
  // verbatim from the engine's `MrpSuggestion.pegging` (see `lib/mrp/types.ts`).
  @Property({ name: 'demand_source', type: 'jsonb', nullable: true })
  demandSource?: unknown

  @Enum({
    items: ['open', 'accepted', 'dismissed', 'superseded'],
    type: 'text',
    name: 'status',
    default: 'open',
  })
  status: MrpSuggestionStatus = 'open'

  @Property({ name: 'carried_from_suggestion_id', type: 'uuid', nullable: true })
  carriedFromSuggestionId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
