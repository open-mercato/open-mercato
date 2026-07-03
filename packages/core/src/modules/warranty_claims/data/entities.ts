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
import type {
  WarrantyClaimChannel,
  WarrantyClaimDisposition,
  WarrantyClaimEventKind,
  WarrantyClaimEventVisibility,
  WarrantyClaimLineStatus,
  WarrantyClaimPriority,
  WarrantyClaimStatus,
  WarrantyClaimType,
  WarrantyClaimWarrantyStatus,
} from './validators'

@Entity({ tableName: 'warranty_claims' })
@Index({ name: 'warranty_claims_customer_idx', properties: ['customerId', 'organizationId', 'tenantId'] })
@Index({ name: 'warranty_claims_order_idx', properties: ['orderId', 'organizationId', 'tenantId'] })
@Index({ name: 'warranty_claims_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Unique({
  name: 'warranty_claims_number_unique',
  properties: ['tenantId', 'organizationId', 'claimNumber'],
})
export class WarrantyClaim {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'claim_number', type: 'text' })
  claimNumber!: string

  @Property({ name: 'claim_type', type: 'text' })
  claimType!: WarrantyClaimType

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: WarrantyClaimStatus = 'draft'

  @Property({ name: 'channel', type: 'text', default: 'staff' })
  channel: WarrantyClaimChannel = 'staff'

  @Property({ name: 'priority', type: 'text', default: 'normal' })
  priority: WarrantyClaimPriority = 'normal'

  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  @Property({ name: 'customer_name', type: 'text', nullable: true })
  customerName?: string | null

  @Property({ name: 'vendor_name', type: 'text', nullable: true })
  vendorName?: string | null

  @Property({ name: 'vendor_ref', type: 'text', nullable: true })
  vendorRef?: string | null

  @Property({ name: 'order_id', type: 'uuid', nullable: true })
  orderId?: string | null

  @Property({ name: 'sales_return_id', type: 'uuid', nullable: true })
  salesReturnId?: string | null

  @Property({ name: 'replacement_order_id', type: 'uuid', nullable: true })
  replacementOrderId?: string | null

  @Property({ name: 'source_claim_id', type: 'uuid', nullable: true })
  sourceClaimId?: string | null

  @Property({ name: 'advance_replacement', type: 'boolean', default: false })
  advanceReplacement: boolean = false

  @Property({ name: 'advance_shipped_at', type: Date, nullable: true })
  advanceShippedAt?: Date | null

  @Property({ name: 'reason_code', type: 'text', nullable: true })
  reasonCode?: string | null

  @Property({ name: 'rejection_reason_code', type: 'text', nullable: true })
  rejectionReasonCode?: string | null

  @Property({ name: 'resolution_summary', type: 'text', nullable: true })
  resolutionSummary?: string | null

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'currency_code', type: 'text', nullable: true })
  currencyCode?: string | null

  @Property({ name: 'total_claimed_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  totalClaimedAmount?: string | null

  @Property({ name: 'total_approved_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  totalApprovedAmount?: string | null

  @Property({ name: 'total_recovered_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  totalRecoveredAmount?: string | null

  @Property({ name: 'sla_due_at', type: Date, nullable: true })
  slaDueAt?: Date | null

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null

  @OneToMany(() => WarrantyClaimLine, (line) => line.claim)
  lines = new Collection<WarrantyClaimLine>(this)

  @OneToMany(() => WarrantyClaimEvent, (event) => event.claim)
  events = new Collection<WarrantyClaimEvent>(this)
}

@Entity({ tableName: 'warranty_claim_lines' })
@Index({ name: 'warranty_claim_lines_claim_idx', properties: ['claim', 'organizationId', 'tenantId'] })
@Index({ name: 'warranty_claim_lines_order_line_idx', properties: ['orderLineId', 'organizationId', 'tenantId'] })
@Index({ name: 'warranty_claim_lines_product_idx', properties: ['productId', 'organizationId', 'tenantId'] })
export class WarrantyClaimLine {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => WarrantyClaim, { fieldName: 'claim_id' })
  claim!: WarrantyClaim

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'line_no', type: 'int' })
  lineNo!: number

  @Property({ name: 'product_id', type: 'uuid', nullable: true })
  productId?: string | null

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'sku', type: 'text', nullable: true })
  sku?: string | null

  @Property({ name: 'product_name', type: 'text', nullable: true })
  productName?: string | null

  @Property({ name: 'order_line_id', type: 'uuid', nullable: true })
  orderLineId?: string | null

  @Property({ name: 'serial_number', type: 'text', nullable: true })
  serialNumber?: string | null

  @Property({ name: 'lot_number', type: 'text', nullable: true })
  lotNumber?: string | null

  @Property({ name: 'purchase_date', type: Date, nullable: true })
  purchaseDate?: Date | null

  @Property({ name: 'warranty_months', type: 'int', nullable: true })
  warrantyMonths?: number | null

  @Property({ name: 'warranty_expires_at', type: Date, nullable: true })
  warrantyExpiresAt?: Date | null

  @Property({ name: 'warranty_status', type: 'text', default: 'unknown' })
  warrantyStatus: WarrantyClaimWarrantyStatus = 'unknown'

  @Property({ name: 'fault_code', type: 'text', nullable: true })
  faultCode?: string | null

  @Property({ name: 'fault_description', type: 'text', nullable: true })
  faultDescription?: string | null

  @Property({ name: 'qty_claimed', type: 'numeric', precision: 18, scale: 4, default: '1' })
  qtyClaimed: string = '1'

  @Property({ name: 'qty_approved', type: 'numeric', precision: 18, scale: 4, nullable: true })
  qtyApproved?: string | null

  @Property({ name: 'qty_received', type: 'numeric', precision: 18, scale: 4, nullable: true })
  qtyReceived?: string | null

  @Property({ name: 'condition_on_receipt', type: 'text', nullable: true })
  conditionOnReceipt?: string | null

  @Property({ name: 'inspection_notes', type: 'text', nullable: true })
  inspectionNotes?: string | null

  @Property({ name: 'disposition', type: 'text', nullable: true })
  disposition?: WarrantyClaimDisposition | null

  @Property({ name: 'line_status', type: 'text', default: 'pending' })
  lineStatus: WarrantyClaimLineStatus = 'pending'

  @Property({ name: 'credit_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  creditAmount?: string | null

  @Property({ name: 'restocking_fee', type: 'numeric', precision: 18, scale: 4, nullable: true })
  restockingFee?: string | null

  @Property({ name: 'core_charge_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  coreChargeAmount?: string | null

  @Property({ name: 'core_credit_amount', type: 'numeric', precision: 18, scale: 4, nullable: true })
  coreCreditAmount?: string | null

  @Property({ name: 'vendor_claim_line_id', type: 'uuid', nullable: true })
  vendorClaimLineId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'warranty_claim_events' })
@Index({ name: 'warranty_claim_events_claim_created_idx', properties: ['claim', 'createdAt'] })
export class WarrantyClaimEvent {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => WarrantyClaim, { fieldName: 'claim_id' })
  claim!: WarrantyClaim

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'kind', type: 'text' })
  kind!: WarrantyClaimEventKind

  @Property({ name: 'visibility', type: 'text', default: 'internal' })
  visibility: WarrantyClaimEventVisibility = 'internal'

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'payload', type: 'jsonb', nullable: true })
  payload?: Record<string, unknown> | null

  @Property({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId?: string | null

  @Property({ name: 'actor_customer_id', type: 'uuid', nullable: true })
  actorCustomerId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

@Entity({ tableName: 'warranty_claim_sequences' })
@Unique({
  name: 'warranty_claim_sequences_type_unique',
  properties: ['tenantId', 'organizationId', 'claimType'],
})
export class WarrantyClaimSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'claim_type', type: 'text' })
  claimType!: WarrantyClaimType

  @Property({ name: 'next_number', type: 'int', default: 1 })
  nextNumber: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
