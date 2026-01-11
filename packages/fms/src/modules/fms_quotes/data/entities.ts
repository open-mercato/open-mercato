import {
  Collection,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core'
import type {
  FmsQuoteStatus,
  FmsOfferStatus,
  FmsDirection,
  FmsIncoterm,
  FmsContractType,
  FmsChargeCategory,
  FmsChargeUnit,
  FmsContainerType,
  FmsCargoType,
} from './types'

@Entity({ tableName: 'fms_quotes' })
@Index({ name: 'fms_quotes_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'fms_quotes_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class FmsQuote {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'quote_number', type: 'text', nullable: true })
  quoteNumber?: string | null

  @Property({ name: 'client_name', type: 'text', nullable: true })
  clientName?: string | null

  @Property({ name: 'container_count', type: 'integer', nullable: true })
  containerCount?: number | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: FmsQuoteStatus = 'draft'

  @Property({ name: 'direction', type: 'text', nullable: true })
  direction?: FmsDirection | null

  @Property({ name: 'incoterm', type: 'text', nullable: true })
  incoterm?: FmsIncoterm | null

  @Property({ name: 'cargo_type', type: 'text', nullable: true })
  cargoType?: FmsCargoType | null

  @Property({ name: 'origin_port_code', type: 'text', nullable: true })
  originPortCode?: string | null

  @Property({ name: 'destination_port_code', type: 'text', nullable: true })
  destinationPortCode?: string | null

  @Property({ name: 'valid_until', type: Date, nullable: true })
  validUntil?: Date | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => FmsOffer, (offer) => offer.quote)
  offers = new Collection<FmsOffer>(this)

  @OneToMany(() => FmsQuoteLine, (line) => line.quote)
  lines = new Collection<FmsQuoteLine>(this)
}

@Entity({ tableName: 'fms_offers' })
@Index({ name: 'fms_offers_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'fms_offers_quote_idx', properties: ['quote', 'organizationId', 'tenantId'] })
@Index({ name: 'fms_offers_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({ name: 'fms_offers_number_unique', properties: ['organizationId', 'tenantId', 'offerNumber'] })
export class FmsOffer {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => FmsQuote, { fieldName: 'quote_id' })
  quote!: FmsQuote

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'offer_number', type: 'text' })
  offerNumber!: string

  @Property({ name: 'version', type: 'integer', default: 1 })
  version: number = 1

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: FmsOfferStatus = 'draft'

  @Property({ name: 'contract_type', type: 'text', default: 'spot' })
  contractType: FmsContractType = 'spot'

  @Property({ name: 'carrier_name', type: 'text', nullable: true })
  carrierName?: string | null

  @Property({ name: 'valid_until', type: Date, nullable: true })
  validUntil?: Date | null

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalAmount: string = '0'

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  @Property({ name: 'special_terms', type: 'text', nullable: true })
  specialTerms?: string | null

  @Property({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'superseded_by_id', type: 'uuid', nullable: true })
  supersededById?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => FmsOfferLine, (line) => line.offer)
  lines = new Collection<FmsOfferLine>(this)
}

@Entity({ tableName: 'fms_offer_lines' })
@Index({ name: 'fms_offer_lines_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'fms_offer_lines_offer_idx', properties: ['offer', 'organizationId', 'tenantId'] })
export class FmsOfferLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => FmsOffer, { fieldName: 'offer_id' })
  offer!: FmsOffer

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  // Snapshot fields from quote line
  @Property({ name: 'product_name', type: 'text', nullable: true })
  productName?: string | null

  @Property({ name: 'charge_code', type: 'text', nullable: true })
  chargeCode?: string | null

  @Property({ name: 'container_size', type: 'text', nullable: true })
  containerSize?: string | null

  // Legacy charge fields (for backward compatibility)
  @Property({ name: 'charge_name', type: 'text', nullable: true })
  chargeName?: string | null

  @Property({ name: 'charge_category', type: 'text', nullable: true })
  chargeCategory?: FmsChargeCategory | null

  @Property({ name: 'charge_unit', type: 'text', nullable: true })
  chargeUnit?: FmsChargeUnit | null

  @Property({ name: 'container_type', type: 'text', nullable: true })
  containerType?: FmsContainerType | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'unit_price', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPrice: string = '0'

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'fms_quote_lines' })
@Index({ name: 'fms_quote_lines_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'fms_quote_lines_quote_idx', properties: ['quote', 'organizationId', 'tenantId'] })
export class FmsQuoteLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => FmsQuote, { fieldName: 'quote_id' })
  quote!: FmsQuote

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  // Product references (module-isomorphic UUIDs, no @ManyToOne)
  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'price_id', type: 'uuid', nullable: true })
  priceId?: string | null

  // Snapshot fields (copied from product at time of adding)
  @Property({ name: 'product_name', type: 'text' })
  productName!: string

  @Property({ name: 'charge_code', type: 'text', nullable: true })
  chargeCode?: string | null

  @Property({ name: 'product_type', type: 'text', nullable: true })
  productType?: string | null

  @Property({ name: 'provider_name', type: 'text', nullable: true })
  providerName?: string | null

  @Property({ name: 'container_size', type: 'text', nullable: true })
  containerSize?: string | null

  @Property({ name: 'contract_type', type: 'text', nullable: true })
  contractType?: string | null

  // Pricing
  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'currency_code', type: 'text', default: 'USD' })
  currencyCode: string = 'USD'

  @Property({ name: 'unit_cost', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitCost: string = '0'

  @Property({ name: 'margin_percent', type: 'numeric', precision: 8, scale: 4, default: '0' })
  marginPercent: string = '0'

  @Property({ name: 'unit_sales', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitSales: string = '0'

  // Timestamps
  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
