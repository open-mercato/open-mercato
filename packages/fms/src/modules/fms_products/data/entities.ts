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
import type { ChargeCodeFieldSchema, ChargeUnit, ContractType } from './types'
import { Contractor } from '../../contractors/data/entities'
import { FmsLocation } from '../../fms_locations/data/entities'

/**
 * FmsChargeCode - Dictionary of freight charge types (system-defined and custom)
 * 
 * Examples: GFRT (Freight Container), GBAF (Bunker Adjustment Factor), GBOL (Bill of Lading)
 */
@Entity({ tableName: 'fms_charge_codes' })
@Index({
  name: 'fms_charge_codes_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'fms_charge_codes_code_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class FmsChargeCode {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'charge_unit', type: 'text' })
  chargeUnit!: ChargeUnit

  @Property({ name: 'field_schema', type: 'jsonb', nullable: true })
  fieldSchema?: ChargeCodeFieldSchema | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => FmsProduct, (product) => product.chargeCode)
  products = new Collection<FmsProduct>(this)
}

/**
 * Abstract base class for all FMS products
 * Uses Single Table Inheritance with product_type discriminator
 * 
 * Products are reusable catalog items with time-based pricing
 * Examples: "MSC SHA-GDN Freight", "MSC BAF", "THC Shanghai"
 */
@Entity({
  tableName: 'fms_products',
  discriminatorColumn: 'product_type',
  abstract: true,
})
@Index({
  name: 'fms_products_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'fms_products_charge_code_idx',
  properties: ['chargeCode'],
})
@Index({
  name: 'fms_products_contractor_idx',
  properties: ['serviceProvider'],
})
@Index({
  name: 'fms_products_active_idx',
  properties: ['organizationId', 'tenantId', 'isActive'],
})
export abstract class FmsProduct {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @ManyToOne(() => FmsChargeCode, {
    fieldName: 'charge_code_id',
    deleteRule: 'restrict',
  })
  chargeCode!: FmsChargeCode

  @ManyToOne(() => Contractor, {
    fieldName: 'service_provider_id',
    deleteRule: 'restrict',
  })
  serviceProvider!: Contractor

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => FmsProductVariant, (variant) => variant.product)
  variants = new Collection<FmsProductVariant>(this)
}

/**
 * GFRT - Freight Container Product
 * Ocean freight for containerized cargo with specific routes
 */
@Entity({ discriminatorValue: 'GFRT' })
export class FreightProduct extends FmsProduct {
  @Property({ type: 'text' })
  loop!: string

  @ManyToOne(() => FmsLocation)
  source!: FmsLocation

  @ManyToOne(() => FmsLocation)
  destination!: FmsLocation

  @Property({ name: 'transit_time', type: 'int', nullable: true })
  transitTime?: number | null
}

/**
 * GTHC - Terminal Handling Charge Product
 * Terminal handling and container handling charges
 */
@Entity({ discriminatorValue: 'GTHC' })
export class THCProduct extends FmsProduct {
  @ManyToOne(() => FmsLocation)
  location!: FmsLocation
}

/**
 * GCUS - Customs Clearance Product
 * Customs clearance and documentation services
 */
@Entity({ discriminatorValue: 'GCUS' })
export class CustomsProduct extends FmsProduct {
  // No additional fields beyond base
}

/**
 * GBAF - Bunker Adjustment Factor (Container)
 * Fuel surcharge per container
 */
@Entity({ discriminatorValue: 'GBAF' })
export class BAFProduct extends FmsProduct {
  // No additional fields beyond base
}

/**
 * GBAF_PIECE - Bunker Adjustment Factor (Piece)
 * Fuel surcharge per piece/unit
 */
@Entity({ discriminatorValue: 'GBAF_PIECE' })
export class BAFPieceProduct extends FmsProduct {
  // No additional fields beyond base
}

/**
 * GBOL - Bill of Lading
 * Bill of Lading documentation fee
 */
@Entity({ discriminatorValue: 'GBOL' })
export class BOLProduct extends FmsProduct {
  // No additional fields beyond base
}

/**
 * CUSTOM - User-defined Custom Products
 * For user-created charge codes beyond the system defaults
 */
@Entity({ discriminatorValue: 'CUSTOM' })
export class CustomProduct extends FmsProduct {
  // No additional fields beyond base
}

/**
 * Abstract base class for all FMS product variants
 * Uses Single Table Inheritance with variant_type discriminator
 * 
 * Provider-specific variants (container sizes, rate sources)
 * Examples: "40HC container from APEX Logis", "20GP container from MSC Poland"
 * Auto-created as "Default" for simple products (BAF, B/L, Customs)
 */
@Entity({
  tableName: 'fms_product_variants',
  discriminatorColumn: 'variant_type',
  abstract: true,
})
@Index({
  name: 'fms_product_variants_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'fms_product_variants_product_idx',
  properties: ['product'],
})
export abstract class FmsProductVariant {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => FmsProduct, { deleteRule: 'cascade' })
  product!: FmsProduct

  @ManyToOne(() => Contractor, { deleteRule: 'restrict' })
  provider?: Contractor | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => FmsProductPrice, (price) => price.variant)
  prices = new Collection<FmsProductPrice>(this)
}

/**
 * Container Variant - For freight and THC products
 * Specific container sizes and specifications
 */
@Entity({ discriminatorValue: 'container' })
export class ContainerVariant extends FmsProductVariant {
  @Property({ name: 'container_size', type: 'text' })
  containerSize!: string // '20GP', '40GP', '40HC', '45HC'

  @Property({ name: 'container_type', type: 'text', nullable: true })
  containerType?: string | null

  @Property({ name: 'weight_limit', type: 'numeric', nullable: true })
  weightLimit?: number | null

  @Property({ name: 'weight_unit', type: 'text', nullable: true })
  weightUnit?: string | null
}

/**
 * Simple Variant - For products without specific variant data
 * Used for BAF, B/L, Customs, and other non-container products
 */
@Entity({ discriminatorValue: 'simple' })
export class SimpleVariant extends FmsProductVariant {
  // No additional fields beyond base
}

/**
 * FmsProductPrice - Time-bound, contract-based pricing
 * 
 * Supports multiple concurrent prices for different contract types (SPOT, NAC, BASKET)
 * Price selection is manual via UI, sorted by contract type and validity date
 */
@Entity({ tableName: 'fms_product_prices' })
@Index({
  name: 'fms_product_prices_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'fms_product_prices_variant_idx',
  properties: ['variant'],
})
@Index({
  name: 'fms_product_prices_validity_idx',
  properties: ['variant', 'validityStart', 'validityEnd'],
})
@Index({
  name: 'fms_product_prices_contract_idx',
  properties: ['contractType', 'contractNumber'],
})
@Index({
  name: 'fms_product_prices_active_idx',
  properties: ['variant', 'isActive', 'validityStart', 'validityEnd'],
})
export class FmsProductPrice {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => FmsProductVariant, {
    fieldName: 'variant_id',
    nullable: false,
    deleteRule: 'cascade',
  })
  variant!: FmsProductVariant

  @Property({ name: 'validity_start', type: 'date' })
  validityStart!: Date

  @Property({ name: 'validity_end', type: 'date', nullable: true })
  validityEnd?: Date | null

  @Property({ name: 'contract_type', type: 'text' })
  contractType!: ContractType

  @Property({ name: 'contract_number', type: 'text', nullable: true })
  contractNumber?: string | null

  @Property({ type: 'numeric', precision: 18, scale: 2 })
  price!: string

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
