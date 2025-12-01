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
import { DEFAULT_ORDER_NUMBER_FORMAT, DEFAULT_QUOTE_NUMBER_FORMAT } from '../lib/documentNumberTokens'

export type SalesDocumentKind = 'order' | 'quote' | 'invoice' | 'credit_memo'
export type SalesLineKind = 'product' | 'service' | 'shipping' | 'discount' | 'adjustment'
export const DEFAULT_SALES_ADJUSTMENT_KINDS = ['discount', 'tax', 'shipping', 'surcharge', 'custom'] as const
export type SalesAdjustmentKind = (typeof DEFAULT_SALES_ADJUSTMENT_KINDS)[number] | string

@Entity({ tableName: 'sales_channels' })
@Index({ name: 'sales_channels_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sales_channels_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({ name: 'sales_channels_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class SalesChannel {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'website_url', type: 'text', nullable: true })
  websiteUrl?: string | null

  @Property({ name: 'contact_email', type: 'text', nullable: true })
  contactEmail?: string | null

  @Property({ name: 'contact_phone', type: 'text', nullable: true })
  contactPhone?: string | null

  @Property({ name: 'address_line1', type: 'text', nullable: true })
  addressLine1?: string | null

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'region', type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country', type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'latitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  latitude?: string | null

  @Property({ name: 'longitude', type: 'numeric', precision: 10, scale: 6, nullable: true })
  longitude?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrder, (order) => order.channel)
  orders = new Collection<SalesOrder>(this)
}

@Entity({ tableName: 'sales_shipping_methods' })
@Index({ name: 'sales_shipping_methods_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'sales_shipping_methods_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class SalesShippingMethod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'carrier_code', type: 'text', nullable: true })
  carrierCode?: string | null

  @Property({ name: 'provider_key', type: 'text', nullable: true })
  providerKey?: string | null

  @Property({ name: 'service_level', type: 'text', nullable: true })
  serviceLevel?: string | null

  @Property({ name: 'estimated_transit_days', type: 'integer', nullable: true })
  estimatedTransitDays?: number | null

  @Property({ name: 'base_rate_net', type: 'numeric', precision: 16, scale: 4, default: '0' })
  baseRateNet: string = '0'

  @Property({ name: 'base_rate_gross', type: 'numeric', precision: 16, scale: 4, default: '0' })
  baseRateGross: string = '0'

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrder, (order) => order.shippingMethod)
  orders = new Collection<SalesOrder>(this)
}

@Entity({ tableName: 'sales_delivery_windows' })
@Index({ name: 'sales_delivery_windows_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'sales_delivery_windows_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class SalesDeliveryWindow {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'lead_time_days', type: 'integer', nullable: true })
  leadTimeDays?: number | null

  @Property({ name: 'cutoff_time', type: 'text', nullable: true })
  cutoffTime?: string | null

  @Property({ name: 'timezone', type: 'text', nullable: true })
  timezone?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrder, (order) => order.deliveryWindow)
  orders = new Collection<SalesOrder>(this)
}

@Entity({ tableName: 'sales_payment_methods' })
@Index({ name: 'sales_payment_methods_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'sales_payment_methods_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class SalesPaymentMethod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'provider_key', type: 'text', nullable: true })
  providerKey?: string | null

  @Property({ name: 'terms', type: 'text', nullable: true })
  terms?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrder, (order) => order.paymentMethod)
  orders = new Collection<SalesOrder>(this)

  @OneToMany(() => SalesPayment, (payment) => payment.paymentMethod)
  payments = new Collection<SalesPayment>(this)
}

@Entity({ tableName: 'sales_tax_rates' })
@Index({ name: 'sales_tax_rates_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'sales_tax_rates_code_unique', properties: ['organizationId', 'tenantId', 'code'] })
export class SalesTaxRate {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ name: 'rate', type: 'numeric', precision: 7, scale: 4 })
  rate!: string

  @Property({ name: 'country_code', type: 'text', nullable: true })
  countryCode?: string | null

  @Property({ name: 'region_code', type: 'text', nullable: true })
  regionCode?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'customer_group_id', type: 'uuid', nullable: true })
  customerGroupId?: string | null

  @Property({ name: 'product_category_id', type: 'uuid', nullable: true })
  productCategoryId?: string | null

  @Property({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null

  @Property({ name: 'priority', type: 'integer', default: 0 })
  priority: number = 0

  @Property({ name: 'is_compound', type: 'boolean', default: false })
  isCompound: boolean = false

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'starts_at', type: Date, nullable: true })
  startsAt?: Date | null

  @Property({ name: 'ends_at', type: Date, nullable: true })
  endsAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sales_orders' })
@Index({ name: 'sales_orders_org_tenant_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sales_orders_customer_idx', properties: ['customerEntityId', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_orders_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({ name: 'sales_orders_fulfillment_status_idx', properties: ['organizationId', 'tenantId', 'fulfillmentStatus'] })
@Index({ name: 'sales_orders_payment_status_idx', properties: ['organizationId', 'tenantId', 'paymentStatus'] })
@Unique({ name: 'sales_orders_number_unique', properties: ['organizationId', 'tenantId', 'orderNumber'] })
export class SalesOrder {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  @Property({ name: 'external_reference', type: 'text', nullable: true })
  externalReference?: string | null

  @Property({ name: 'customer_reference', type: 'text', nullable: true })
  customerReference?: string | null

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'customer_contact_id', type: 'uuid', nullable: true })
  customerContactId?: string | null

  @Property({ name: 'customer_snapshot', type: 'jsonb', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'billing_address_id', type: 'uuid', nullable: true })
  billingAddressId?: string | null

  @Property({ name: 'shipping_address_id', type: 'uuid', nullable: true })
  shippingAddressId?: string | null

  @Property({ name: 'billing_address_snapshot', type: 'jsonb', nullable: true })
  billingAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'shipping_address_snapshot', type: 'jsonb', nullable: true })
  shippingAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'fulfillment_status_entry_id', type: 'uuid', nullable: true })
  fulfillmentStatusEntryId?: string | null

  @Property({ name: 'fulfillment_status', type: 'text', nullable: true })
  fulfillmentStatus?: string | null

  @Property({ name: 'payment_status_entry_id', type: 'uuid', nullable: true })
  paymentStatusEntryId?: string | null

  @Property({ name: 'payment_status', type: 'text', nullable: true })
  paymentStatus?: string | null

  @Property({ name: 'tax_strategy_key', type: 'text', nullable: true })
  taxStrategyKey?: string | null

  @Property({ name: 'discount_strategy_key', type: 'text', nullable: true })
  discountStrategyKey?: string | null

  @Property({ name: 'tax_info', type: 'jsonb', nullable: true })
  taxInfo?: Record<string, unknown> | null

  @Property({ name: 'shipping_method_snapshot', type: 'jsonb', nullable: true })
  shippingMethodSnapshot?: Record<string, unknown> | null

  @Property({ name: 'delivery_window_snapshot', type: 'jsonb', nullable: true })
  deliveryWindowSnapshot?: Record<string, unknown> | null

  @Property({ name: 'payment_method_snapshot', type: 'jsonb', nullable: true })
  paymentMethodSnapshot?: Record<string, unknown> | null

  @Property({ name: 'placed_at', type: Date, nullable: true })
  placedAt?: Date | null

  @Property({ name: 'expected_delivery_at', type: Date, nullable: true })
  expectedDeliveryAt?: Date | null

  @Property({ name: 'due_at', type: Date, nullable: true })
  dueAt?: Date | null

  @Property({ name: 'comments', type: 'text', nullable: true })
  comments?: string | null

  @Property({ name: 'internal_notes', type: 'text', nullable: true })
  internalNotes?: string | null

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'subtotal_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalGrossAmount: string = '0'

  @Property({ name: 'discount_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountTotalAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'shipping_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  shippingNetAmount: string = '0'

  @Property({ name: 'shipping_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  shippingGrossAmount: string = '0'

  @Property({ name: 'surcharge_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  surchargeTotalAmount: string = '0'

  @Property({ name: 'grand_total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalNetAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'totals_snapshot', type: 'jsonb', nullable: true })
  totalsSnapshot?: Record<string, unknown> | null

  @Property({ name: 'paid_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  paidTotalAmount: string = '0'

  @Property({ name: 'refunded_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  refundedTotalAmount: string = '0'

  @Property({ name: 'outstanding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  outstandingAmount: string = '0'

  @Property({ name: 'line_item_count', type: 'integer', default: 0 })
  lineItemCount: number = 0

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null

  @ManyToOne(() => SalesChannel, { fieldName: 'channel_ref_id', nullable: true })
  channel?: SalesChannel | null

  @Property({ name: 'shipping_method_id', type: 'uuid', nullable: true })
  shippingMethodId?: string | null

  @Property({ name: 'shipping_method_code', type: 'text', nullable: true })
  shippingMethodCode?: string | null

  @ManyToOne(() => SalesShippingMethod, { fieldName: 'shipping_method_ref_id', nullable: true })
  shippingMethod?: SalesShippingMethod | null

  @Property({ name: 'delivery_window_id', type: 'uuid', nullable: true })
  deliveryWindowId?: string | null

  @Property({ name: 'delivery_window_code', type: 'text', nullable: true })
  deliveryWindowCode?: string | null

  @ManyToOne(() => SalesDeliveryWindow, { fieldName: 'delivery_window_ref_id', nullable: true })
  deliveryWindow?: SalesDeliveryWindow | null

  @Property({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId?: string | null

  @Property({ name: 'payment_method_code', type: 'text', nullable: true })
  paymentMethodCode?: string | null

  @ManyToOne(() => SalesPaymentMethod, { fieldName: 'payment_method_ref_id', nullable: true })
  paymentMethod?: SalesPaymentMethod | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrderLine, (line) => line.order)
  lines = new Collection<SalesOrderLine>(this)

  @OneToMany(() => SalesOrderAdjustment, (adjustment) => adjustment.order)
  adjustments = new Collection<SalesOrderAdjustment>(this)

  @OneToMany(() => SalesShipment, (shipment) => shipment.order)
  shipments = new Collection<SalesShipment>(this)

  @OneToMany(() => SalesInvoice, (invoice) => invoice.order)
  invoices = new Collection<SalesInvoice>(this)

  @OneToMany(() => SalesCreditMemo, (creditMemo) => creditMemo.order)
  creditMemos = new Collection<SalesCreditMemo>(this)

  @OneToMany(() => SalesPayment, (payment) => payment.order)
  payments = new Collection<SalesPayment>(this)

  @OneToMany(() => SalesNote, (note) => note.order)
  notes = new Collection<SalesNote>(this)

  @OneToMany(() => SalesDocumentAddress, (entry) => entry.order)
  addresses = new Collection<SalesDocumentAddress>(this)

  @OneToMany(() => SalesDocumentTagAssignment, (assignment) => assignment.order)
  tagAssignments = new Collection<SalesDocumentTagAssignment>(this)
}

@Entity({ tableName: 'sales_order_lines' })
@Index({ name: 'sales_order_lines_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_order_lines_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class SalesOrderLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id' })
  order!: SalesOrder

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'kind', type: 'text', default: 'product' })
  kind: SalesLineKind = 'product'

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_variant_id', type: 'uuid', nullable: true })
  productVariantId?: string | null

  @Property({ name: 'catalog_snapshot', type: 'jsonb', nullable: true })
  catalogSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'comment', type: 'text', nullable: true })
  comment?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  @Property({ name: 'quantity_unit', type: 'text', nullable: true })
  quantityUnit?: string | null

  @Property({ name: 'reserved_quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  reservedQuantity: string = '0'

  @Property({ name: 'fulfilled_quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  fulfilledQuantity: string = '0'

  @Property({ name: 'invoiced_quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  invoicedQuantity: string = '0'

  @Property({ name: 'returned_quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  returnedQuantity: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceGross: string = '0'

  @Property({ name: 'discount_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountAmount: string = '0'

  @Property({ name: 'discount_percent', type: 'numeric', precision: 7, scale: 4, default: '0' })
  discountPercent: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'configuration', type: 'jsonb', nullable: true })
  configuration?: Record<string, unknown> | null

  @Property({ name: 'promotion_code', type: 'text', nullable: true })
  promotionCode?: string | null

  @Property({ name: 'promotion_snapshot', type: 'jsonb', nullable: true })
  promotionSnapshot?: Record<string, unknown> | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesOrderAdjustment, (adjustment) => adjustment.orderLine)
  adjustments = new Collection<SalesOrderAdjustment>(this)

  @OneToMany(() => SalesShipmentItem, (item) => item.orderLine)
  shipmentItems = new Collection<SalesShipmentItem>(this)

  @OneToMany(() => SalesInvoiceLine, (line) => line.orderLine)
  invoiceLines = new Collection<SalesInvoiceLine>(this)

  @OneToMany(() => SalesCreditMemoLine, (line) => line.orderLine)
  creditMemoLines = new Collection<SalesCreditMemoLine>(this)
}

@Entity({ tableName: 'sales_order_adjustments' })
@Index({ name: 'sales_order_adjustments_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
export class SalesOrderAdjustment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id' })
  order!: SalesOrder

  @ManyToOne(() => SalesOrderLine, { fieldName: 'order_line_id', nullable: true })
  orderLine?: SalesOrderLine | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'scope', type: 'text', default: 'order' })
  scope: 'order' | 'line' = 'order'

  @Property({ name: 'kind', type: 'text', default: 'custom' })
  kind: SalesAdjustmentKind = 'custom'

  @Property({ name: 'code', type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'label', type: 'text', nullable: true })
  label?: string | null

  @Property({ name: 'calculator_key', type: 'text', nullable: true })
  calculatorKey?: string | null

  @Property({ name: 'promotion_id', type: 'uuid', nullable: true })
  promotionId?: string | null

  @Property({ name: 'rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  rate: string = '0'

  @Property({ name: 'amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amountNet: string = '0'

  @Property({ name: 'amount_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amountGross: string = '0'

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'position', type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sales_settings' })
@Unique({ name: 'sales_settings_scope_unique', properties: ['organizationId', 'tenantId'] })
export class SalesSettings {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'order_number_format', type: 'text', default: DEFAULT_ORDER_NUMBER_FORMAT })
  orderNumberFormat: string = DEFAULT_ORDER_NUMBER_FORMAT

  @Property({ name: 'quote_number_format', type: 'text', default: DEFAULT_QUOTE_NUMBER_FORMAT })
  quoteNumberFormat: string = DEFAULT_QUOTE_NUMBER_FORMAT

  @Property({ name: 'order_customer_editable_statuses', type: 'jsonb', nullable: true })
  orderCustomerEditableStatuses?: string[] | null

  @Property({ name: 'order_address_editable_statuses', type: 'jsonb', nullable: true })
  orderAddressEditableStatuses?: string[] | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sales_document_sequences' })
@Unique({
  name: 'sales_document_sequences_scope_unique',
  properties: ['organizationId', 'tenantId', 'documentKind'],
})
export class SalesDocumentSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_kind', type: 'text' })
  documentKind!: SalesDocumentKind

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sales_quotes' })
@Index({ name: 'sales_quotes_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'sales_quotes_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({ name: 'sales_quotes_number_unique', properties: ['organizationId', 'tenantId', 'quoteNumber'] })
export class SalesQuote {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'quote_number', type: 'text' })
  quoteNumber!: string

  @Property({ name: 'external_reference', type: 'text', nullable: true })
  externalReference?: string | null

  @Property({ name: 'customer_reference', type: 'text', nullable: true })
  customerReference?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'customer_entity_id', type: 'uuid', nullable: true })
  customerEntityId?: string | null

  @Property({ name: 'customer_contact_id', type: 'uuid', nullable: true })
  customerContactId?: string | null

  @Property({ name: 'customer_snapshot', type: 'jsonb', nullable: true })
  customerSnapshot?: Record<string, unknown> | null

  @Property({ name: 'billing_address_id', type: 'uuid', nullable: true })
  billingAddressId?: string | null

  @Property({ name: 'shipping_address_id', type: 'uuid', nullable: true })
  shippingAddressId?: string | null

  @Property({ name: 'billing_address_snapshot', type: 'jsonb', nullable: true })
  billingAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'shipping_address_snapshot', type: 'jsonb', nullable: true })
  shippingAddressSnapshot?: Record<string, unknown> | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_until', type: Date, nullable: true })
  validUntil?: Date | null

  @Property({ name: 'placed_at', type: Date, nullable: true })
  placedAt?: Date | null

  @Property({ name: 'comments', type: 'text', nullable: true })
  comments?: string | null

  @Property({ name: 'tax_info', type: 'jsonb', nullable: true })
  taxInfo?: Record<string, unknown> | null

  @Property({ name: 'shipping_method_id', type: 'uuid', nullable: true })
  shippingMethodId?: string | null

  @Property({ name: 'shipping_method_code', type: 'text', nullable: true })
  shippingMethodCode?: string | null

  @ManyToOne(() => SalesShippingMethod, { fieldName: 'shipping_method_ref_id', nullable: true })
  shippingMethod?: SalesShippingMethod | null

  @Property({ name: 'delivery_window_id', type: 'uuid', nullable: true })
  deliveryWindowId?: string | null

  @Property({ name: 'delivery_window_code', type: 'text', nullable: true })
  deliveryWindowCode?: string | null

  @ManyToOne(() => SalesDeliveryWindow, { fieldName: 'delivery_window_ref_id', nullable: true })
  deliveryWindow?: SalesDeliveryWindow | null

  @Property({ name: 'payment_method_id', type: 'uuid', nullable: true })
  paymentMethodId?: string | null

  @Property({ name: 'payment_method_code', type: 'text', nullable: true })
  paymentMethodCode?: string | null

  @ManyToOne(() => SalesPaymentMethod, { fieldName: 'payment_method_ref_id', nullable: true })
  paymentMethod?: SalesPaymentMethod | null

  @Property({ name: 'channel_id', type: 'uuid', nullable: true })
  channelId?: string | null

  @ManyToOne(() => SalesChannel, { fieldName: 'channel_ref_id', nullable: true })
  channel?: SalesChannel | null

  @Property({ name: 'shipping_method_snapshot', type: 'jsonb', nullable: true })
  shippingMethodSnapshot?: Record<string, unknown> | null

  @Property({ name: 'delivery_window_snapshot', type: 'jsonb', nullable: true })
  deliveryWindowSnapshot?: Record<string, unknown> | null

  @Property({ name: 'payment_method_snapshot', type: 'jsonb', nullable: true })
  paymentMethodSnapshot?: Record<string, unknown> | null

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'subtotal_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalGrossAmount: string = '0'

  @Property({ name: 'discount_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountTotalAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'grand_total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalNetAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'totals_snapshot', type: 'jsonb', nullable: true })
  totalsSnapshot?: Record<string, unknown> | null

  @Property({ name: 'line_item_count', type: 'integer', default: 0 })
  lineItemCount: number = 0

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @Property({ name: 'converted_order_id', type: 'uuid', nullable: true })
  convertedOrderId?: string | null

  @OneToMany(() => SalesQuoteLine, (line) => line.quote)
  lines = new Collection<SalesQuoteLine>(this)

  @OneToMany(() => SalesQuoteAdjustment, (adjustment) => adjustment.quote)
  adjustments = new Collection<SalesQuoteAdjustment>(this)

  @OneToMany(() => SalesNote, (note) => note.quote)
  notes = new Collection<SalesNote>(this)

  @OneToMany(() => SalesDocumentAddress, (entry) => entry.quote)
  addresses = new Collection<SalesDocumentAddress>(this)

  @OneToMany(() => SalesDocumentTagAssignment, (assignment) => assignment.quote)
  tagAssignments = new Collection<SalesDocumentTagAssignment>(this)
}

@Entity({ tableName: 'sales_quote_lines' })
@Index({ name: 'sales_quote_lines_scope_idx', properties: ['quote', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_quote_lines_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class SalesQuoteLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesQuote, { fieldName: 'quote_id' })
  quote!: SalesQuote

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'kind', type: 'text', default: 'product' })
  kind: SalesLineKind = 'product'

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_variant_id', type: 'uuid', nullable: true })
  productVariantId?: string | null

  @Property({ name: 'catalog_snapshot', type: 'jsonb', nullable: true })
  catalogSnapshot?: Record<string, unknown> | null

  @Property({ type: 'text', nullable: true })
  name?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'comment', type: 'text', nullable: true })
  comment?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  @Property({ name: 'quantity_unit', type: 'text', nullable: true })
  quantityUnit?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceGross: string = '0'

  @Property({ name: 'discount_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountAmount: string = '0'

  @Property({ name: 'discount_percent', type: 'numeric', precision: 7, scale: 4, default: '0' })
  discountPercent: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'configuration', type: 'jsonb', nullable: true })
  configuration?: Record<string, unknown> | null

  @Property({ name: 'promotion_code', type: 'text', nullable: true })
  promotionCode?: string | null

  @Property({ name: 'promotion_snapshot', type: 'jsonb', nullable: true })
  promotionSnapshot?: Record<string, unknown> | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesQuoteAdjustment, (adjustment) => adjustment.quoteLine)
  adjustments = new Collection<SalesQuoteAdjustment>(this)
}

@Entity({ tableName: 'sales_quote_adjustments' })
@Index({ name: 'sales_quote_adjustments_scope_idx', properties: ['quote', 'organizationId', 'tenantId'] })
export class SalesQuoteAdjustment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesQuote, { fieldName: 'quote_id' })
  quote!: SalesQuote

  @ManyToOne(() => SalesQuoteLine, { fieldName: 'quote_line_id', nullable: true })
  quoteLine?: SalesQuoteLine | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'scope', type: 'text', default: 'order' })
  scope: 'order' | 'line' = 'order'

  @Property({ name: 'kind', type: 'text', default: 'custom' })
  kind: SalesAdjustmentKind = 'custom'

  @Property({ name: 'code', type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'label', type: 'text', nullable: true })
  label?: string | null

  @Property({ name: 'calculator_key', type: 'text', nullable: true })
  calculatorKey?: string | null

  @Property({ name: 'promotion_id', type: 'uuid', nullable: true })
  promotionId?: string | null

  @Property({ name: 'rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  rate: string = '0'

  @Property({ name: 'amount_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amountNet: string = '0'

  @Property({ name: 'amount_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amountGross: string = '0'

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'position', type: 'integer', default: 0 })
  position: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sales_shipments' })
@Index({ name: 'sales_shipments_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_shipments_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class SalesShipment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id' })
  order!: SalesOrder

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'shipment_number', type: 'text', nullable: true })
  shipmentNumber?: string | null

  @Property({ name: 'shipping_method_id', type: 'uuid', nullable: true })
  shippingMethodId?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'carrier_name', type: 'text', nullable: true })
  carrierName?: string | null

  @Property({ name: 'tracking_numbers', type: 'jsonb', nullable: true })
  trackingNumbers?: string[] | null

  @Property({ name: 'shipped_at', type: Date, nullable: true })
  shippedAt?: Date | null

  @Property({ name: 'delivered_at', type: Date, nullable: true })
  deliveredAt?: Date | null

  @Property({ name: 'weight_value', type: 'numeric', precision: 16, scale: 4, nullable: true })
  weightValue?: string | null

  @Property({ name: 'weight_unit', type: 'text', nullable: true })
  weightUnit?: string | null

  @Property({ name: 'declared_value_net', type: 'numeric', precision: 18, scale: 4, nullable: true })
  declaredValueNet?: string | null

  @Property({ name: 'declared_value_gross', type: 'numeric', precision: 18, scale: 4, nullable: true })
  declaredValueGross?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notesText?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesShipmentItem, (item) => item.shipment)
  items = new Collection<SalesShipmentItem>(this)
}

@Entity({ tableName: 'sales_shipment_items' })
@Index({ name: 'sales_shipment_items_scope_idx', properties: ['shipment', 'organizationId', 'tenantId'] })
export class SalesShipmentItem {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesShipment, { fieldName: 'shipment_id' })
  shipment!: SalesShipment

  @ManyToOne(() => SalesOrderLine, { fieldName: 'order_line_id' })
  orderLine!: SalesOrderLine

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null
}

@Entity({ tableName: 'sales_invoices' })
@Index({ name: 'sales_invoices_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_invoices_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({ name: 'sales_invoices_number_unique', properties: ['organizationId', 'tenantId', 'invoiceNumber'] })
export class SalesInvoice {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'invoice_number', type: 'text' })
  invoiceNumber!: string

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'issue_date', type: Date, nullable: true })
  issueDate?: Date | null

  @Property({ name: 'due_date', type: Date, nullable: true })
  dueDate?: Date | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'subtotal_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalGrossAmount: string = '0'

  @Property({ name: 'discount_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountTotalAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'grand_total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalNetAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'paid_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  paidTotalAmount: string = '0'

  @Property({ name: 'outstanding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  outstandingAmount: string = '0'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesInvoiceLine, (line) => line.invoice)
  lines = new Collection<SalesInvoiceLine>(this)

  @OneToMany(() => SalesPaymentAllocation, (allocation) => allocation.invoice)
  paymentAllocations = new Collection<SalesPaymentAllocation>(this)
}

@Entity({ tableName: 'sales_invoice_lines' })
@Index({ name: 'sales_invoice_lines_scope_idx', properties: ['invoice', 'organizationId', 'tenantId'] })
export class SalesInvoiceLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesInvoice, { fieldName: 'invoice_id' })
  invoice!: SalesInvoice

  @ManyToOne(() => SalesOrderLine, { fieldName: 'order_line_id', nullable: true })
  orderLine?: SalesOrderLine | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'kind', type: 'text', default: 'product' })
  kind: SalesLineKind = 'product'

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  @Property({ name: 'quantity_unit', type: 'text', nullable: true })
  quantityUnit?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceGross: string = '0'

  @Property({ name: 'discount_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  discountAmount: string = '0'

  @Property({ name: 'discount_percent', type: 'numeric', precision: 7, scale: 4, default: '0' })
  discountPercent: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null
}

@Entity({ tableName: 'sales_credit_memos' })
@Index({ name: 'sales_credit_memos_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_credit_memos_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({
  name: 'sales_credit_memos_number_unique',
  properties: ['organizationId', 'tenantId', 'creditMemoNumber'],
})
export class SalesCreditMemo {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesInvoice, { fieldName: 'invoice_id', nullable: true })
  invoice?: SalesInvoice | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'credit_memo_number', type: 'text' })
  creditMemoNumber!: string

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'issue_date', type: Date, nullable: true })
  issueDate?: Date | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'subtotal_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalGrossAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'grand_total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalNetAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesCreditMemoLine, (line) => line.creditMemo)
  lines = new Collection<SalesCreditMemoLine>(this)
}

@Entity({ tableName: 'sales_credit_memo_lines' })
@Index({
  name: 'sales_credit_memo_lines_scope_idx',
  properties: ['creditMemo', 'organizationId', 'tenantId'],
})
export class SalesCreditMemoLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesCreditMemo, { fieldName: 'credit_memo_id' })
  creditMemo!: SalesCreditMemo

  @ManyToOne(() => SalesOrderLine, { fieldName: 'order_line_id', nullable: true })
  orderLine?: SalesOrderLine | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'quantity', type: 'numeric', precision: 18, scale: 4, default: '0' })
  quantity: string = '0'

  @Property({ name: 'quantity_unit', type: 'text', nullable: true })
  quantityUnit?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceGross: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null
}

@Entity({ tableName: 'sales_payments' })
@Index({ name: 'sales_payments_scope_idx', properties: ['order', 'organizationId', 'tenantId'] })
@Index({ name: 'sales_payments_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
export class SalesPayment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesPaymentMethod, { fieldName: 'payment_method_id', nullable: true })
  paymentMethod?: SalesPaymentMethod | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'payment_reference', type: 'text', nullable: true })
  paymentReference?: string | null

  @Property({ name: 'status_entry_id', type: 'uuid', nullable: true })
  statusEntryId?: string | null

  @Property({ name: 'status', type: 'text', nullable: true })
  status?: string | null

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'captured_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  capturedAmount: string = '0'

  @Property({ name: 'refunded_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  refundedAmount: string = '0'

  @Property({ name: 'received_at', type: Date, nullable: true })
  receivedAt?: Date | null

  @Property({ name: 'captured_at', type: Date, nullable: true })
  capturedAt?: Date | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'custom_field_set_id', type: 'uuid', nullable: true })
  customFieldSetId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => SalesPaymentAllocation, (allocation) => allocation.payment)
  allocations = new Collection<SalesPaymentAllocation>(this)
}

@Entity({ tableName: 'sales_payment_allocations' })
@Index({ name: 'sales_payment_allocations_scope_idx', properties: ['payment', 'organizationId', 'tenantId'] })
export class SalesPaymentAllocation {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => SalesPayment, { fieldName: 'payment_id' })
  payment!: SalesPayment

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesInvoice, { fieldName: 'invoice_id', nullable: true })
  invoice?: SalesInvoice | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null
}

@Entity({ tableName: 'sales_notes' })
@Index({ name: 'sales_notes_scope_idx', properties: ['organizationId', 'tenantId'] })
export class SalesNote {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'context_type', type: 'text' })
  contextType!: SalesDocumentKind

  @Property({ name: 'context_id', type: 'uuid' })
  contextId!: string

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesQuote, { fieldName: 'quote_id', nullable: true })
  quote?: SalesQuote | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'appearance_icon', type: 'text', nullable: true })
  appearanceIcon?: string | null

  @Property({ name: 'appearance_color', type: 'text', nullable: true })
  appearanceColor?: string | null

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'sales_document_addresses' })
@Index({ name: 'sales_document_addresses_scope_idx', properties: ['organizationId', 'tenantId'] })
export class SalesDocumentAddress {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'document_kind', type: 'text' })
  documentKind!: SalesDocumentKind

  @Property({ name: 'customer_address_id', type: 'uuid', nullable: true })
  customerAddressId?: string | null

  @Property({ name: 'name', type: 'text', nullable: true })
  name?: string | null

  @Property({ name: 'purpose', type: 'text', nullable: true })
  purpose?: string | null

  @Property({ name: 'company_name', type: 'text', nullable: true })
  companyName?: string | null

  @Property({ name: 'address_line1', type: 'text' })
  addressLine1!: string

  @Property({ name: 'address_line2', type: 'text', nullable: true })
  addressLine2?: string | null

  @Property({ name: 'city', type: 'text', nullable: true })
  city?: string | null

  @Property({ name: 'region', type: 'text', nullable: true })
  region?: string | null

  @Property({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null

  @Property({ name: 'country', type: 'text', nullable: true })
  country?: string | null

  @Property({ name: 'building_number', type: 'text', nullable: true })
  buildingNumber?: string | null

  @Property({ name: 'flat_number', type: 'text', nullable: true })
  flatNumber?: string | null

  @Property({ name: 'latitude', type: 'float', nullable: true })
  latitude?: number | null

  @Property({ name: 'longitude', type: 'float', nullable: true })
  longitude?: number | null

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesQuote, { fieldName: 'quote_id', nullable: true })
  quote?: SalesQuote | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'sales_document_tags' })
@Index({ name: 'sales_document_tags_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'sales_document_tags_slug_unique', properties: ['organizationId', 'tenantId', 'slug'] })
export class SalesDocumentTag {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  label!: string

  @Property({ type: 'text', nullable: true })
  color?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @OneToMany(() => SalesDocumentTagAssignment, (assignment) => assignment.tag)
  assignments = new Collection<SalesDocumentTagAssignment>(this)
}

@Entity({ tableName: 'sales_document_tag_assignments' })
@Index({ name: 'sales_document_tag_assignments_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({
  name: 'sales_document_tag_assignments_unique',
  properties: ['tag', 'documentId', 'documentKind'],
})
export class SalesDocumentTagAssignment {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => SalesDocumentTag, { fieldName: 'tag_id' })
  tag!: SalesDocumentTag

  @Property({ name: 'document_id', type: 'uuid' })
  documentId!: string

  @Property({ name: 'document_kind', type: 'text' })
  documentKind!: SalesDocumentKind

  @ManyToOne(() => SalesOrder, { fieldName: 'order_id', nullable: true })
  order?: SalesOrder | null

  @ManyToOne(() => SalesQuote, { fieldName: 'quote_id', nullable: true })
  quote?: SalesQuote | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
