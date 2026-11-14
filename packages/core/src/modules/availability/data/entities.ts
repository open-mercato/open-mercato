import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

@Entity({ tableName: 'availability_policies' })
@Index({ name: 'availability_policies_scope_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  // Exactly one policy row per (store, product, variant) combination — nullable columns mean
  // "applies to all stores" / "product-level" / "store-level default". Postgres treats NULLs as
  // distinct by default, so the index is declared NULLS NOT DISTINCT (mirrors user_devices).
  name: 'availability_policies_scope_target_unique',
  expression:
    'create unique index "availability_policies_scope_target_unique" on "availability_policies" ("tenant_id", "organization_id", "store_id", "product_id", "variant_id") nulls not distinct where deleted_at is null',
})
export class AvailabilityPolicy {
  [OptionalProps]?:
    | 'storeId'
    | 'productId'
    | 'variantId'
    | 'isStockManaged'
    | 'allowBackorder'
    | 'backorderLeadTimeDays'
    | 'preorderReleaseAt'
    | 'lowStockThreshold'
    | 'minOrderQuantity'
    | 'maxOrderQuantity'
    | 'quantityIncrement'
    | 'hideWhenOutOfStock'
    | 'isActive'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** `catalog.EcommerceStore`-shaped id (not yet a real entity in this repo) — null = all stores. */
  @Property({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string | null

  /** `catalog.CatalogProduct.id`. */
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  /** `catalog.CatalogProductVariant.id`. Non-null requires `productId` non-null (validated). */
  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  /** `null` = inherit from the next less-specific row, then the §5.2 module default. */
  @Property({ name: 'is_stock_managed', type: 'boolean', nullable: true })
  isStockManaged?: boolean | null

  @Property({ name: 'allow_backorder', type: 'boolean', default: false })
  allowBackorder: boolean = false

  @Property({ name: 'backorder_lead_time_days', type: 'integer', nullable: true })
  backorderLeadTimeDays?: number | null

  @Property({ name: 'preorder_release_at', type: Date, nullable: true })
  preorderReleaseAt?: Date | null

  @Property({ name: 'low_stock_threshold', type: 'integer', nullable: true })
  lowStockThreshold?: number | null

  @Property({ name: 'min_order_quantity', type: 'integer', nullable: true })
  minOrderQuantity?: number | null

  @Property({ name: 'max_order_quantity', type: 'integer', nullable: true })
  maxOrderQuantity?: number | null

  @Property({ name: 'quantity_increment', type: 'integer', nullable: true })
  quantityIncrement?: number | null

  @Property({ name: 'hide_when_out_of_stock', type: 'boolean', default: false })
  hideWhenOutOfStock: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// Release 5 Phase 3 (§5.3, A3). The caller's `idempotencyKey` (checkout `stock_reservation_key`)
// has nowhere to live on the `wms` reservation rows — their own idempotency key is derived from
// `sourceType|sourceId|variant|warehouse|quantity` and is unique only while `active`
// (`wms/lib/inventoryIdempotency.ts`). One row per hold; `reserve`/`release`/`commit` (Step 2.2),
// the expiry sweep and reconciliation (Step 2.3) all transition it by a conditional update on the
// expected `status` (the fenced-lease rule, lesson `durable-quota-reservations-need-fenced-leases`).
// Narrowed to the literal `'checkout'` source per the spec's data-model table — the only source
// this release writes; a future source type is an additive union member, same pattern as
// `InventoryReservationSourceType` gaining `'checkout'` itself (A16).
export type AvailabilityReservationSourceType = 'checkout'
export type AvailabilityReservationStatus = 'active' | 'committed' | 'released' | 'expired'
export type AvailabilityReservationLineOutcome = 'held' | 'not_tracked' | 'preorder' | 'backorder' | 'shortfall'

// Snapshot shape stored in `items` (jsonb), exactly the columns §5.3's data-model table names:
// "catalogProductId, catalogVariantId, requested, outcome, heldQuantity, backorderQuantity". The
// richer `AvailabilityReservationLine` type (adding `key`/`available`) used by the Step 2.2
// `reserve`/`release`/`commit` commands is a superset built on top of this persisted snapshot.
export type AvailabilityReservationItemSnapshot = {
  catalogProductId: string
  catalogVariantId: string | null
  requested: number
  outcome: AvailabilityReservationLineOutcome
  heldQuantity: number
  backorderQuantity: number
}

// No `deleted_at`: rows are never soft-deleted — they are the audit trail of the hold (§5.3).
// No optimistic-lock header either: the table is not user-editable (no admin form), so
// `updated_at` exists only to record transition times, not to gate a `CrudForm` submit — see the
// root AGENTS.md optimistic-locking rule's own "every NEW user-editable entity and edit/delete
// form" scoping, and §5.3's explicit "no optimistic-lock header" note.
@Entity({ tableName: 'availability_reservations' })
@Index({ name: 'availability_reservations_scope_idx', properties: ['tenantId', 'organizationId'] })
@Unique({
  // Over ALL statuses, not partial — a key must never be reused for different content even once
  // the hold it named is committed/released/expired (§4.1 A15: a reused key with different items
  // answers 409, never silently creates a second hold).
  name: 'availability_reservations_tenant_org_idempotency_unique',
  properties: ['tenantId', 'organizationId', 'idempotencyKey'],
})
@Index({
  // Supports the expiry sweep's `status = 'active' AND expires_at < now()` scan (§10, A11) without
  // ever touching committed/released/expired rows.
  name: 'availability_reservations_active_expiry_idx',
  expression:
    'create index "availability_reservations_active_expiry_idx" on "availability_reservations" ("expires_at") where "status" = \'active\'',
})
@Index({
  name: 'availability_reservations_source_idx',
  properties: ['tenantId', 'organizationId', 'sourceType', 'sourceId'],
})
export class AvailabilityReservation {
  [OptionalProps]?: 'status' | 'expiresAt' | 'wmsReservationIds' | 'orderId' | 'statusReason' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** The caller's key (checkout `stock_reservation_key`) — never the `wms` derived key. */
  @Property({ name: 'idempotency_key', type: 'text' })
  idempotencyKey!: string

  @Property({ name: 'source_type', type: 'text' })
  sourceType!: AvailabilityReservationSourceType

  /** Checkout session id. */
  @Property({ name: 'source_id', type: 'text' })
  sourceId!: string

  @Property({ type: 'text', default: 'active' })
  status: AvailabilityReservationStatus = 'active'

  /** `now() + ttlSeconds` at reserve; kept on `committed` rows for the record, ignored by the sweep. */
  @Property({ name: 'expires_at', type: Date, nullable: true })
  expiresAt?: Date | null

  @Property({ type: 'jsonb' })
  items!: AvailabilityReservationItemSnapshot[]

  /** `wms_inventory_reservations` ids the hold owns; empty when no line holds stock. */
  @Property({ name: 'wms_reservation_ids', type: 'jsonb', default: [] })
  wmsReservationIds: string[] = []

  /** Set by `commit`. */
  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  /** Reason of the last transition (`release` reason, `'expired'`, `'reconciled'`). */
  @Property({ name: 'status_reason', type: 'text', nullable: true })
  statusReason?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
