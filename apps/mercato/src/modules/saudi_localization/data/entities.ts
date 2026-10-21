import { OptionalProps } from '@mikro-orm/core'
import { Entity, Enum, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'

export const SAUDI_EINVOICE_SUBMISSION_STATUSES = ['pending', 'submitted', 'cleared', 'rejected'] as const
export type SaudiEinvoiceSubmissionStatus = (typeof SAUDI_EINVOICE_SUBMISSION_STATUSES)[number]

/**
 * One persisted ZATCA invoice issuance attempt.
 *
 * The XML, hash, ICV and previous hash are stored exactly as generated because
 * they are the compliance artifact: a reprint or an audit must read the bytes
 * that were produced, not a re-render that may differ. `status` stops at
 * `pending` until a clearance/reporting client exists — nothing in the product
 * may claim ZATCA accepted an invoice that was never sent.
 */
@Entity({ tableName: 'saudi_einvoice_submissions' })
@Index({ name: 'saudi_einvoice_submissions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'saudi_einvoice_submissions_order_idx', properties: ['organizationId', 'orderId'] })
@Index({
  name: 'saudi_einvoice_submissions_order_unique_idx',
  expression:
    'create unique index "saudi_einvoice_submissions_order_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "order_id") where deleted_at is null',
})
@Index({
  name: 'saudi_einvoice_submissions_uuid_unique_idx',
  expression:
    'create unique index "saudi_einvoice_submissions_uuid_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "invoice_uuid") where deleted_at is null',
})
@Index({
  name: 'saudi_einvoice_submissions_icv_unique_idx',
  expression:
    'create unique index "saudi_einvoice_submissions_icv_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "icv") where deleted_at is null',
})
export class SaudiEinvoiceSubmission {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'order_id', type: 'uuid' })
  orderId!: string

  @Property({ name: 'invoice_number', type: 'text' })
  invoiceNumber!: string

  @Property({ name: 'invoice_uuid', type: 'text' })
  invoiceUuid!: string

  @Property({ type: 'integer' })
  icv!: number

  @Property({ name: 'invoice_hash', type: 'text' })
  invoiceHash!: string

  @Property({ name: 'previous_invoice_hash', type: 'text' })
  previousInvoiceHash!: string

  @Property({ name: 'qr_payload', type: 'text' })
  qrPayload!: string

  @Property({ type: 'text' })
  xml!: string

  @Enum({ items: [...SAUDI_EINVOICE_SUBMISSION_STATUSES], type: 'text', name: 'status', default: 'pending' })
  status: SaudiEinvoiceSubmissionStatus = 'pending'

  @Property({ name: 'submitted_at', type: Date, nullable: true })
  submittedAt?: Date | null

  @Property({ name: 'cleared_at', type: Date, nullable: true })
  clearedAt?: Date | null

  @Property({ name: 'response_json', type: 'jsonb', nullable: true })
  responseJson?: Record<string, unknown> | null

  @Property({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
