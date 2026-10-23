import { Collection, OptionalProps } from '@mikro-orm/core'
import {
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy'
import type { JsonValue } from '@open-mercato/shared/lib/json'

export type PurchaseOrderStatus =
  | 'draft_rfq'
  | 'rfq_sent'
  | 'to_approve'
  | 'purchase_order'
  | 'locked'
  | 'cancelled'

export type PurchaseApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected'

export type PurchaseInvoiceStatus = 'no' | 'to_invoice' | 'invoiced'

export type PurchaseDeliveryStatus = 'pending' | 'partially_received' | 'fully_received'

export type PurchaseControlPolicy = 'on_received' | 'on_ordered'

export type PurchaseDocumentKind = 'rfq' | 'po' | 'pz' | 'bill'

export type PurchasesOptionalProps = 'createdAt' | 'updatedAt' | 'deletedAt' | 'metadata'

export abstract class PurchasesScopedEntity {
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

@Entity({ tableName: 'purchases_orders' })
@Index({ name: 'purchases_orders_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_orders_status_idx', properties: ['status'] })
@Index({ name: 'purchases_orders_vendor_idx', properties: ['vendorId'] })
@Unique({ name: 'purchases_orders_number_scope_idx', properties: ['organizationId', 'tenantId', 'orderNumber'] })
export class PurchaseOrder extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'exchangeRate' | 'approvalStatus' | 'invoiceStatus' | 'deliveryStatus' | 'controlPolicy' | 'subtotalNet' | 'totalTax' | 'totalGross'

  @Property({ name: 'order_number', type: 'text' })
  orderNumber!: string

  @Property({ name: 'status', type: 'text' })
  status: PurchaseOrderStatus = 'draft_rfq'

  @Property({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string

  @Property({ name: 'vendor_name', type: 'text', nullable: true })
  vendorName?: string | null

  @Property({ name: 'buyer_id', type: 'uuid', nullable: true })
  buyerId?: string | null

  @Property({ name: 'order_date', type: Date, onCreate: () => new Date() })
  orderDate: Date = new Date()

  @Property({ name: 'expected_arrival_date', type: Date, nullable: true })
  expectedArrivalDate?: Date | null

  @Property({ name: 'currency_code', type: 'text', default: 'PLN' })
  currencyCode: string = 'PLN'

  @Property({ name: 'exchange_rate', type: 'numeric', precision: 16, scale: 6, default: '1.000000' })
  exchangeRate: string = '1.000000'

  @Property({ name: 'payment_term_id', type: 'uuid', nullable: true })
  paymentTermId?: string | null

  @Property({ name: 'incoterm', type: 'text', nullable: true })
  incoterm?: string | null

  @Property({ name: 'approval_status', type: 'text', default: 'not_required' })
  approvalStatus: PurchaseApprovalStatus = 'not_required'

  @Property({ name: 'invoice_status', type: 'text', default: 'no' })
  invoiceStatus: PurchaseInvoiceStatus = 'no'

  @Property({ name: 'delivery_status', type: 'text', default: 'pending' })
  deliveryStatus: PurchaseDeliveryStatus = 'pending'

  @Property({ name: 'control_policy', type: 'text', default: 'on_received' })
  controlPolicy: PurchaseControlPolicy = 'on_received'

  @Property({ name: 'subtotal_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  subtotalNet: string = '0.0000'

  @Property({ name: 'total_tax', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalTax: string = '0.0000'

  @Property({ name: 'total_gross', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalGross: string = '0.0000'

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @OneToMany(() => PurchaseOrderLine, (line) => line.purchaseOrder)
  lines = new Collection<PurchaseOrderLine>(this)

  @OneToMany(() => PurchaseReceipt, (receipt) => receipt.purchaseOrder)
  receipts = new Collection<PurchaseReceipt>(this)

  @OneToMany(() => PurchaseBill, (bill) => bill.purchaseOrder)
  bills = new Collection<PurchaseBill>(this)
}

@Entity({ tableName: 'purchases_order_lines' })
@Index({ name: 'purchases_order_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_order_lines_order_idx', properties: ['purchaseOrder'] })
@Index({ name: 'purchases_order_lines_product_idx', properties: ['productId'] })
export class PurchaseOrderLine extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'quantityReceived' | 'quantityBilled' | 'sortOrder'

  @ManyToOne(() => PurchaseOrder, { fieldName: 'purchase_order_id' })
  purchaseOrder!: PurchaseOrder

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'vendor_product_code', type: 'text', nullable: true })
  vendorProductCode?: string | null

  @Property({ name: 'product_description', type: 'text' })
  productDescription!: string

  @Property({ name: 'quantity_ordered', type: 'numeric', precision: 16, scale: 4, default: '1.0000' })
  quantityOrdered: string = '1.0000'

  @Property({ name: 'quantity_received', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  quantityReceived: string = '0.0000'

  @Property({ name: 'quantity_billed', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  quantityBilled: string = '0.0000'

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  unitPriceNet: string = '0.0000'

  @Property({ name: 'tax_rate_percent', type: 'numeric', precision: 5, scale: 2, default: '23.00' })
  taxRatePercent: string = '23.00'

  @Property({ name: 'subtotal_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  subtotalNet: string = '0.0000'

  @Property({ name: 'total_tax', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalTax: string = '0.0000'

  @Property({ name: 'total_gross', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalGross: string = '0.0000'

  @Property({ name: 'expected_delivery_date', type: Date, nullable: true })
  expectedDeliveryDate?: Date | null

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0
}

@Entity({ tableName: 'purchases_document_sequences' })
@Index({ name: 'purchases_docseq_scope_idx', properties: ['organizationId', 'tenantId'] })
@Unique({ name: 'purchases_docseq_kind_unique', properties: ['organizationId', 'tenantId', 'documentKind'] })
export class PurchaseDocumentSequence extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'currentValue'

  @Property({ name: 'document_kind', type: 'text' })
  documentKind!: PurchaseDocumentKind

  @Property({ name: 'current_value', type: 'integer', default: 0 })
  currentValue: number = 0
}

@Entity({ tableName: 'purchases_settings' })
@Index({ name: 'purchases_settings_scope_idx', properties: ['organizationId', 'tenantId'] })
export class PurchaseSettings extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'approvalThresholdAmount' | 'approvalThresholdCurrency' | 'doubleValidationEnabled' | 'defaultControlPolicy' | 'autoCreateReceiptOnConfirm'

  @Property({ name: 'approval_threshold_amount', type: 'numeric', precision: 16, scale: 4, default: '10000.0000' })
  approvalThresholdAmount: string = '10000.0000'

  @Property({ name: 'approval_threshold_currency', type: 'text', default: 'PLN' })
  approvalThresholdCurrency: string = 'PLN'

  @Property({ name: 'double_validation_enabled', type: 'boolean', default: true })
  doubleValidationEnabled: boolean = true

  @Property({ name: 'default_control_policy', type: 'text', default: 'on_received' })
  defaultControlPolicy: PurchaseControlPolicy = 'on_received'

  @Property({ name: 'auto_create_receipt_on_confirm', type: 'boolean', default: true })
  autoCreateReceiptOnConfirm: boolean = true
}

export type PurchaseReceiptStatus = 'draft' | 'ready' | 'done' | 'cancelled'

export type PurchaseBillStatus = 'draft' | 'posted' | 'cancelled'

export type PurchaseBillMatchingStatus = 'pending' | 'verified' | 'exception'

@Entity({ tableName: 'purchases_vendor_pricelists' })
@Index({ name: 'purchases_vendor_pricelists_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_vendor_pricelists_vendor_idx', properties: ['vendorId'] })
export class VendorPricelist extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'isActive' | 'currencyCode'

  @Property({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'currency_code', type: 'text', default: 'PLN' })
  currencyCode: string = 'PLN'

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @OneToMany(() => VendorPricelistItem, (item) => item.pricelist)
  items = new Collection<VendorPricelistItem>(this)
}

@Entity({ tableName: 'purchases_vendor_pricelist_items' })
@Index({ name: 'purchases_pricelist_items_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_pricelist_items_product_idx', properties: ['productId'] })
@Index({ name: 'purchases_pricelist_items_pricelist_idx', properties: ['pricelist'] })
export class VendorPricelistItem extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'minQuantity' | 'leadTimeDays'

  @ManyToOne(() => VendorPricelist, { fieldName: 'pricelist_id' })
  pricelist!: VendorPricelist

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'vendor_product_code', type: 'text', nullable: true })
  vendorProductCode?: string | null

  @Property({ name: 'min_quantity', type: 'numeric', precision: 16, scale: 4, default: '1.0000' })
  minQuantity: string = '1.0000'

  @Property({ name: 'price', type: 'numeric', precision: 16, scale: 4 })
  price!: string

  @Property({ name: 'lead_time_days', type: 'integer', default: 0 })
  leadTimeDays: number = 0

  @Property({ name: 'valid_from', type: Date, nullable: true })
  validFrom?: Date | null

  @Property({ name: 'valid_to', type: Date, nullable: true })
  validTo?: Date | null
}

@Entity({ tableName: 'purchases_receipts' })
@Index({ name: 'purchases_receipts_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_receipts_order_idx', properties: ['purchaseOrder'] })
@Index({ name: 'purchases_receipts_status_idx', properties: ['status'] })
@Unique({ name: 'purchases_receipts_number_unique', properties: ['organizationId', 'tenantId', 'receiptNumber'] })
export class PurchaseReceipt extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'status' | 'isBackorder'

  @ManyToOne(() => PurchaseOrder, { fieldName: 'purchase_order_id' })
  purchaseOrder!: PurchaseOrder

  @Property({ name: 'receipt_number', type: 'text' })
  receiptNumber!: string

  @Property({ name: 'status', type: 'text', default: 'ready' })
  status: PurchaseReceiptStatus = 'ready'

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'is_backorder', type: 'boolean', default: false })
  isBackorder: boolean = false

  @Property({ name: 'backorder_of_id', type: 'uuid', nullable: true })
  backorderOfId?: string | null

  @Property({ name: 'received_date', type: Date, nullable: true })
  receivedDate?: Date | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @OneToMany(() => PurchaseReceiptLine, (line) => line.receipt)
  lines = new Collection<PurchaseReceiptLine>(this)
}

@Entity({ tableName: 'purchases_receipt_lines' })
@Index({ name: 'purchases_receipt_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_receipt_lines_receipt_idx', properties: ['receipt'] })
export class PurchaseReceiptLine extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'quantityDone'

  @ManyToOne(() => PurchaseReceipt, { fieldName: 'receipt_id' })
  receipt!: PurchaseReceipt

  @Property({ name: 'order_line_id', type: 'uuid' })
  orderLineId!: string

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_description', type: 'text' })
  productDescription!: string

  @Property({ name: 'quantity_expected', type: 'numeric', precision: 16, scale: 4 })
  quantityExpected!: string

  @Property({ name: 'quantity_done', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  quantityDone: string = '0.0000'
}

@Entity({ tableName: 'purchases_reordering_rules' })
@Index({ name: 'purchases_reordering_rules_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_reordering_rules_product_idx', properties: ['productId'] })
@Index({ name: 'purchases_reordering_rules_wh_idx', properties: ['warehouseId'] })
export class ReorderingRule extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'quantityMultiple' | 'isActive'

  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'warehouse_id', type: 'uuid', nullable: true })
  warehouseId?: string | null

  @Property({ name: 'min_quantity', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  minQuantity: string = '0.0000'

  @Property({ name: 'max_quantity', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  maxQuantity: string = '0.0000'

  @Property({ name: 'quantity_multiple', type: 'numeric', precision: 16, scale: 4, default: '1.0000' })
  quantityMultiple: string = '1.0000'

  @Property({ name: 'preferred_vendor_id', type: 'uuid', nullable: true })
  preferredVendorId?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true
}

@Entity({ tableName: 'purchases_bills' })
@Index({ name: 'purchases_bills_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_bills_order_idx', properties: ['purchaseOrder'] })
@Index({ name: 'purchases_bills_status_idx', properties: ['status'] })
@Index({ name: 'purchases_bills_match_idx', properties: ['matchingStatus'] })
export class PurchaseBill extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'status' | 'matchingStatus' | 'totalNet' | 'totalGross'

  @ManyToOne(() => PurchaseOrder, { fieldName: 'purchase_order_id' })
  purchaseOrder!: PurchaseOrder

  @Property({ name: 'vendor_bill_number', type: 'text' })
  vendorBillNumber!: string

  @Property({ name: 'bill_date', type: Date, onCreate: () => new Date() })
  billDate: Date = new Date()

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: PurchaseBillStatus = 'draft'

  @Property({ name: 'matching_status', type: 'text', default: 'pending' })
  matchingStatus: PurchaseBillMatchingStatus = 'pending'

  @Property({ name: 'exception_notes', type: 'text', nullable: true })
  exceptionNotes?: string | null

  @Property({ name: 'total_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalNet: string = '0.0000'

  @Property({ name: 'total_gross', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  totalGross: string = '0.0000'

  @OneToMany(() => PurchaseBillLine, (line) => line.bill)
  lines = new Collection<PurchaseBillLine>(this)
}

@Entity({ tableName: 'purchases_bill_lines' })
@Index({ name: 'purchases_bill_lines_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_bill_lines_bill_idx', properties: ['bill'] })
export class PurchaseBillLine extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'quantity' | 'unitPriceNet' | 'subtotalNet'

  @ManyToOne(() => PurchaseBill, { fieldName: 'bill_id' })
  bill!: PurchaseBill

  @Property({ name: 'order_line_id', type: 'uuid', nullable: true })
  orderLineId?: string | null

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'product_description', type: 'text' })
  productDescription!: string

  @Property({ name: 'quantity', type: 'numeric', precision: 16, scale: 4, default: '1.0000' })
  quantity: string = '1.0000'

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  unitPriceNet: string = '0.0000'

  @Property({ name: 'subtotal_net', type: 'numeric', precision: 16, scale: 4, default: '0.0000' })
  subtotalNet: string = '0.0000'
}

@Entity({ tableName: 'purchases_vendors' })
@Index({ name: 'purchases_vendors_scope_idx', properties: ['organizationId', 'tenantId'] })
@Index({ name: 'purchases_vendors_code_idx', properties: ['code'] })
export class PurchaseVendor extends PurchasesScopedEntity {
  [OptionalProps]?: PurchasesOptionalProps | 'isActive' | 'currencyCode'

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'code', type: 'text', nullable: true })
  code?: string | null

  @Property({ name: 'email', type: 'text', nullable: true })
  email?: string | null

  @Property({ name: 'phone', type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'currency_code', type: 'text', default: 'PLN' })
  currencyCode: string = 'PLN'

  @Property({ name: 'payment_terms', type: 'text', nullable: true })
  paymentTerms?: string | null

  @Property({ name: 'tax_id', type: 'text', nullable: true })
  taxId?: string | null

  @Property({ name: 'address', type: 'text', nullable: true })
  address?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true
}


