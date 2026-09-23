import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

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

  @Property({ name: 'is_stock_managed', type: 'boolean', default: false })
  isStockManaged: boolean = false

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
