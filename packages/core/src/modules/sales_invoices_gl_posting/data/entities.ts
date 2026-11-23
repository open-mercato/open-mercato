import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * One row per sales invoice posted to the General Ledger. Append-only: a
 * posting is never edited or removed, a correction is a separate
 * `ledger.reverseJournalEntry` against `journalEntryId`, so the row has no
 * `updated_at` or `deleted_at`. The scoped unique constraint is the
 * double-posting guard the posting command maps to `409 ALREADY_POSTED`.
 * Every id is an FK-id only (no ORM relation across modules).
 */
@Entity({ tableName: 'sales_invoice_gl_postings' })
@Unique({
  name: 'sales_invoice_gl_postings_scope_invoice_unique',
  properties: ['organizationId', 'tenantId', 'salesInvoiceId'],
})
export class SalesInvoiceGlPosting {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'sales_invoice_id', type: 'uuid' })
  salesInvoiceId!: string

  @Property({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId!: string

  @Property({ name: 'contractor_id', type: 'uuid', nullable: true })
  contractorId?: string | null

  @Property({ name: 'posted_at', type: Date })
  postedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * The revenue account assigned to one sales invoice line, written once in
 * the posting transaction alongside `SalesInvoiceGlPosting`. Append-only,
 * one row per invoice line within the scope.
 */
@Entity({ tableName: 'sales_invoice_line_revenue_accounts' })
@Unique({
  name: 'sales_invoice_line_revenue_accounts_scope_line_unique',
  properties: ['organizationId', 'tenantId', 'salesInvoiceLineId'],
})
export class SalesInvoiceLineRevenueAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'sales_invoice_line_id', type: 'uuid' })
  salesInvoiceLineId!: string

  @Property({ name: 'account_id', type: 'uuid' })
  accountId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
