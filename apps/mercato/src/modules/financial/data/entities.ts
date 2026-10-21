import { Collection, OptionalProps } from '@mikro-orm/core'
import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy'

export const ACCOUNT_CLASSES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const
export type AccountClass = (typeof ACCOUNT_CLASSES)[number]

export const NORMAL_BALANCES = ['debit', 'credit'] as const
export type NormalBalance = (typeof NORMAL_BALANCES)[number]

export const PERIOD_STATUSES = ['open', 'soft_closed', 'hard_closed'] as const
export type PeriodStatus = (typeof PERIOD_STATUSES)[number]

/**
 * `opening` is the entry a set of opening balances is posted as. It is a type of
 * its own rather than a `standard` entry with a note because a ledger has to be
 * able to answer "what was carried in, before anything happened" — the trial
 * balance reports it separately and a later period cannot be asked to explain it.
 */
export const JOURNAL_ENTRY_TYPES = ['standard', 'adjusting', 'closing', 'reversing', 'opening'] as const
export type JournalEntryType = (typeof JOURNAL_ENTRY_TYPES)[number]

/**
 * How money moved. The kind decides what reference a payment must carry (a cheque
 * number, a transfer reference) rather than what account it lands in — that is
 * the payment method's own GL account, so a tenant can route "mada" somewhere
 * different from "cash" without this list changing.
 */
export const PAYMENT_METHOD_KINDS = ['cash', 'bank_transfer', 'card', 'cheque', 'wallet', 'other'] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number]

export const CASH_ACCOUNT_KINDS = ['cash', 'bank'] as const
export type CashAccountKind = (typeof CASH_ACCOUNT_KINDS)[number]

export const JOURNAL_ENTRY_STATUSES = ['draft', 'posted', 'reversed'] as const
export type JournalEntryStatus = (typeof JOURNAL_ENTRY_STATUSES)[number]

@Entity({ tableName: 'gl_accounts' })
@Index({ name: 'gl_accounts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'gl_accounts_class_idx', properties: ['organizationId', 'accountClass'] })
@Index({
  name: 'gl_accounts_code_unique_idx',
  expression:
    'create unique index "gl_accounts_code_unique_idx" on "gl_accounts" ("organization_id", "tenant_id", "code") where deleted_at is null',
})
export class GlAccount {
  [OptionalProps]?: 'accountClass' | 'normalBalance' | 'isActive' | 'isReconciliationRequired' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Enum({ items: [...ACCOUNT_CLASSES], type: 'text', name: 'account_class' })
  accountClass!: AccountClass

  @Property({ name: 'account_type', type: 'text', nullable: true })
  accountType?: string | null

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Enum({ items: [...NORMAL_BALANCES], type: 'text', name: 'normal_balance' })
  normalBalance!: NormalBalance

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'is_reconciliation_required', type: 'boolean', default: false })
  isReconciliationRequired: boolean = false

  @Property({ name: 'country_code', type: 'text', nullable: true })
  countryCode?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'gl_periods' })
@Index({ name: 'gl_periods_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'gl_periods_unique_idx',
  expression:
    'create unique index "gl_periods_unique_idx" on "gl_periods" ("organization_id", "tenant_id", "fiscal_year", "period_number")',
})
export class GlPeriod {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'fiscal_year', type: 'integer' })
  fiscalYear!: number

  @Property({ name: 'period_number', type: 'integer' })
  periodNumber!: number

  @Property({ name: 'period_name', type: 'text' })
  periodName!: string

  @Property({ name: 'start_date', type: 'date' })
  startDate!: Date

  @Property({ name: 'end_date', type: 'date' })
  endDate!: Date

  @Enum({ items: [...PERIOD_STATUSES], type: 'text', name: 'status', default: 'open' })
  status: PeriodStatus = 'open'

  @Property({ name: 'closed_at', type: Date, nullable: true })
  closedAt?: Date | null

  @Property({ name: 'closed_by', type: 'uuid', nullable: true })
  closedBy?: string | null

  @Property({ name: 'balance_snapshot', type: 'json', nullable: true })
  balanceSnapshot?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'gl_journal_entries' })
@Index({ name: 'gl_journal_entries_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'gl_journal_entries_source_unique_idx',
  expression:
    `create unique index "gl_journal_entries_source_unique_idx" on "gl_journal_entries" ("organization_id", "tenant_id", "source_entity_type", "source_entity_id", "source_kind") where source_entity_id is not null and status <> 'reversed'`,
})
@Index({ name: 'gl_journal_entries_period_idx', properties: ['period', 'status'] })
@Index({
  name: 'gl_journal_entries_number_unique_idx',
  expression:
    'create unique index "gl_journal_entries_number_unique_idx" on "gl_journal_entries" ("organization_id", "tenant_id", "entry_number")',
})
export class GlJournalEntry {
  [OptionalProps]?: 'entryType' | 'status' | 'exchangeRate' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'entry_number', type: 'text' })
  entryNumber!: string

  @Property({ name: 'entry_date', type: 'date' })
  entryDate!: Date

  @Property({ name: 'posting_date', type: 'date' })
  postingDate!: Date

  @ManyToOne(() => GlPeriod, { fieldName: 'period_id' })
  period!: GlPeriod

  @Enum({ items: [...JOURNAL_ENTRY_TYPES], type: 'text', name: 'entry_type', default: 'standard' })
  entryType: JournalEntryType = 'standard'

  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'source_entity_type', type: 'text', nullable: true })
  sourceEntityType?: string | null

  @Property({ name: 'source_entity_id', type: 'uuid', nullable: true })
  sourceEntityId?: string | null

  @Property({ name: 'source_kind', type: 'text', nullable: true })
  sourceKind?: string | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'exchange_rate', type: 'numeric', precision: 19, scale: 6 })
  exchangeRate: string = '1'

  @Enum({ items: [...JOURNAL_ENTRY_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: JournalEntryStatus = 'draft'

  @ManyToOne(() => GlJournalEntry, { fieldName: 'reverses_entry_id', nullable: true })
  reversesEntry?: GlJournalEntry | null

  @ManyToOne(() => GlJournalEntry, { fieldName: 'reversed_by_entry_id', nullable: true })
  reversedByEntry?: GlJournalEntry | null

  @Property({ name: 'posted_at', type: Date, nullable: true })
  postedAt?: Date | null

  @Property({ name: 'posted_by', type: 'uuid', nullable: true })
  postedBy?: string | null

  @OneToMany(() => GlJournalLine, (line) => line.entry)
  lines = new Collection<GlJournalLine>(this)

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'gl_journal_lines' })
@Index({ name: 'gl_journal_lines_entry_idx', properties: ['entry'] })
@Index({ name: 'gl_journal_lines_account_idx', properties: ['account'] })
export class GlJournalLine {
  [OptionalProps]?: 'debitAmount' | 'creditAmount' | 'baseDebitAmount' | 'baseCreditAmount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => GlJournalEntry, { fieldName: 'entry_id' })
  entry!: GlJournalEntry

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  @ManyToOne(() => GlAccount, { fieldName: 'account_id' })
  account!: GlAccount

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'debit_amount', type: 'numeric', precision: 19, scale: 4 })
  debitAmount: string = '0'

  @Property({ name: 'credit_amount', type: 'numeric', precision: 19, scale: 4 })
  creditAmount: string = '0'

  @Property({ name: 'base_debit_amount', type: 'numeric', precision: 19, scale: 4 })
  baseDebitAmount: string = '0'

  @Property({ name: 'base_credit_amount', type: 'numeric', precision: 19, scale: 4 })
  baseCreditAmount: string = '0'

  @Property({ name: 'tax_code', type: 'text', nullable: true })
  taxCode?: string | null

  @Property({ name: 'cost_center_id', type: 'uuid', nullable: true })
  costCenterId?: string | null

  @Property({ name: 'project_id', type: 'uuid', nullable: true })
  projectId?: string | null
}


/**
 * How a payment was made, and where the money landed.
 *
 * The GL account is on the method rather than on the payment so a tenant
 * configures it once: every cash receipt posts to the till, every mada receipt to
 * the acquirer clearing account, without each payment restating it. `code` is the
 * stable handle a caller passes (`CASH`, `MADA`), so a rename never breaks a
 * stored payment or an integration.
 *
 * `isDefault` marks the method a form preselects. Exactly one method should carry
 * it per organization; the service enforces that by clearing the others in the
 * same transaction rather than by a partial unique index, because the "one" is a
 * product convention and not a data invariant worth failing a write over.
 */
@Entity({ tableName: 'gl_payment_methods' })
@Index({ name: 'gl_payment_methods_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'gl_payment_methods_code_unique_idx',
  expression:
    'create unique index "gl_payment_methods_code_unique_idx" on "gl_payment_methods" ("organization_id", "tenant_id", "code") where deleted_at is null',
})
export class GlPaymentMethod {
  [OptionalProps]?: 'kind' | 'isActive' | 'isDefault' | 'requiresReference' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Enum({ items: [...PAYMENT_METHOD_KINDS], type: 'text', name: 'kind', default: 'other' })
  kind: PaymentMethodKind = 'other'

  /** The GL account a payment made this way posts its cash side to. */
  @Property({ name: 'account_id', type: 'uuid' })
  accountId!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  /** A cheque or a transfer carries a reference; cash does not. */
  @Property({ name: 'requires_reference', type: 'boolean', default: false })
  requiresReference: boolean = false

  @Property({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A till or a bank account: the thing that is counted and reconciled.
 *
 * It is deliberately **not** the GL account. A GL account is a ledger line; a
 * cash account is an operational object with an owner, an IBAN and a statement
 * that has to be matched against it. Keeping them apart is what lets a tenant
 * open a second bank account on the same GL account, or move a till's balance
 * from one GL account to another, without rewriting the ledger.
 *
 * `paymentMethodCode` is a **code, not a relation**: the module's rule is that
 * entities reference each other by id or by a stable code, never by an ORM
 * relation, so deleting a method cannot cascade into a statement.
 */
@Entity({ tableName: 'gl_cash_accounts' })
@Index({ name: 'gl_cash_accounts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'gl_cash_accounts_code_unique_idx',
  expression:
    'create unique index "gl_cash_accounts_code_unique_idx" on "gl_cash_accounts" ("organization_id", "tenant_id", "code") where deleted_at is null',
})
export class GlCashAccount {
  [OptionalProps]?: 'kind' | 'isActive' | 'isDefault' | 'openingBalance' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Enum({ items: [...CASH_ACCOUNT_KINDS], type: 'text', name: 'kind', default: 'cash' })
  kind: CashAccountKind = 'cash'

  @Property({ name: 'account_id', type: 'uuid' })
  accountId!: string

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'bank_name', type: 'text', nullable: true })
  bankName?: string | null

  @Property({ type: 'text', nullable: true })
  iban?: string | null

  @Property({ name: 'account_number', type: 'text', nullable: true })
  accountNumber?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean = false

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}


export const AP_INVOICE_STATUSES = ['draft', 'posted', 'paid', 'void'] as const
export type ApInvoiceStatus = (typeof AP_INVOICE_STATUSES)[number]

export const AP_PAYMENT_STATUSES = ['posted', 'void'] as const
export type ApPaymentStatus = (typeof AP_PAYMENT_STATUSES)[number]

export const AP_PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash'] as const
export type ApPaymentMethod = (typeof AP_PAYMENT_METHODS)[number]

@Entity({ tableName: 'ap_vendors' })
@Index({ name: 'ap_vendors_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'ap_vendors_code_unique_idx',
  expression:
    'create unique index "ap_vendors_code_unique_idx" on "ap_vendors" ("organization_id", "tenant_id", "code") where deleted_at is null',
})
export class ApVendor {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'name_ar', type: 'text', nullable: true })
  nameAr?: string | null

  @Property({ name: 'vat_number', type: 'text', nullable: true })
  vatNumber?: string | null

  @Property({ name: 'cr_number', type: 'text', nullable: true })
  crNumber?: string | null

  @Property({ type: 'text', nullable: true })
  email?: string | null

  @Property({ type: 'text', nullable: true })
  phone?: string | null

  @Property({ name: 'country_code', type: 'text', nullable: true })
  countryCode?: string | null

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ap_vendor_invoices' })
@Index({ name: 'ap_vendor_invoices_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ap_vendor_invoices_vendor_idx', properties: ['organizationId', 'vendorId'] })
@Index({ name: 'ap_vendor_invoices_status_idx', properties: ['organizationId', 'status'] })
@Index({ name: 'ap_vendor_invoices_due_idx', properties: ['organizationId', 'dueDate'] })
@Index({
  name: 'ap_vendor_invoices_number_unique_idx',
  expression:
    'create unique index "ap_vendor_invoices_number_unique_idx" on "ap_vendor_invoices" ("organization_id", "tenant_id", "internal_number") where deleted_at is null',
})
export class ApVendorInvoice {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string

  @Property({ name: 'internal_number', type: 'text' })
  internalNumber!: string

  @Property({ name: 'vendor_invoice_number', type: 'text', nullable: true })
  vendorInvoiceNumber?: string | null

  @Property({ name: 'issue_date', type: 'date' })
  issueDate!: Date

  @Property({ name: 'due_date', type: 'date', nullable: true })
  dueDate?: Date | null

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'subtotal_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  subtotalNetAmount: string = '0'

  @Property({ name: 'tax_total_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxTotalAmount: string = '0'

  @Property({ name: 'grand_total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grandTotalGrossAmount: string = '0'

  @Property({ name: 'withholding_code', type: 'text', nullable: true })
  withholdingCode?: string | null

  @Property({ name: 'withholding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  withholdingAmount: string = '0'

  @Enum({ items: [...AP_INVOICE_STATUSES], type: 'text', name: 'status', default: 'draft' })
  status: ApInvoiceStatus = 'draft'

  @Property({ name: 'posted_entry_id', type: 'uuid', nullable: true })
  postedEntryId?: string | null

  @Property({ name: 'posted_at', type: Date, nullable: true })
  postedAt?: Date | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ap_vendor_invoice_lines' })
@Index({ name: 'ap_vendor_invoice_lines_invoice_idx', properties: ['invoiceId'] })
export class ApVendorInvoiceLine {
  [OptionalProps]?: 'lineNumber' | 'taxRate' | 'taxAmount' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ type: 'text' })
  description!: string

  @Property({ name: 'expense_account_id', type: 'uuid' })
  expenseAccountId!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '1' })
  quantity: string = '1'

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 18, scale: 4, default: '0' })
  unitPriceNet: string = '0'

  @Property({ name: 'total_net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalNetAmount: string = '0'

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, default: '0' })
  taxRate: string = '0'

  @Property({ name: 'tax_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  taxAmount: string = '0'

  @Property({ name: 'total_gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  totalGrossAmount: string = '0'

  @Property({ name: 'tax_code', type: 'text', nullable: true })
  taxCode?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'ap_payments' })
@Index({ name: 'ap_payments_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'ap_payments_vendor_idx', properties: ['organizationId', 'vendorId'] })
@Index({
  name: 'ap_payments_number_unique_idx',
  expression:
    'create unique index "ap_payments_number_unique_idx" on "ap_payments" ("organization_id", "tenant_id", "payment_number") where deleted_at is null',
})
export class ApPayment {
  [OptionalProps]?: 'status' | 'withholdingAmount' | 'netAmount' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'vendor_id', type: 'uuid' })
  vendorId!: string

  @Property({ name: 'payment_number', type: 'text' })
  paymentNumber!: string

  @Property({ name: 'payment_date', type: 'date' })
  paymentDate!: Date

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'gross_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  grossAmount: string = '0'

  @Property({ name: 'withholding_code', type: 'text', nullable: true })
  withholdingCode?: string | null

  @Property({ name: 'withholding_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  withholdingAmount: string = '0'

  @Property({ name: 'net_amount', type: 'numeric', precision: 18, scale: 4, default: '0' })
  netAmount: string = '0'

  @Enum({ items: [...AP_PAYMENT_METHODS], type: 'text', name: 'method', default: 'bank_transfer' })
  method: ApPaymentMethod = 'bank_transfer'

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Enum({ items: [...AP_PAYMENT_STATUSES], type: 'text', name: 'status', default: 'posted' })
  status: ApPaymentStatus = 'posted'

  @Property({ name: 'posted_entry_id', type: 'uuid', nullable: true })
  postedEntryId?: string | null

  @Property({ type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy?: string | null

  @Property({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ap_payment_allocations' })
@Index({ name: 'ap_payment_allocations_payment_idx', properties: ['paymentId'] })
@Index({ name: 'ap_payment_allocations_invoice_idx', properties: ['invoiceId'] })
export class ApPaymentAllocation {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'payment_id', type: 'uuid' })
  paymentId!: string

  @Property({ name: 'invoice_id', type: 'uuid' })
  invoiceId!: string

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

export const BANK_STATEMENT_STATUSES = ['imported', 'reconciled'] as const
export const BANK_STATEMENT_LINE_STATUSES = ['unmatched', 'matched', 'ignored'] as const

@Entity({ tableName: 'gl_bank_statements' })
@Index({ name: 'gl_bank_statements_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'gl_bank_statements_account_idx', properties: ['organizationId', 'cashAccountId'] })
export class GlBankStatement {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'cash_account_id', type: 'uuid' })
  cashAccountId!: string

  @Property({ name: 'file_name', type: 'text', nullable: true })
  fileName?: string | null

  @Property({ name: 'period_start', type: 'date', nullable: true })
  periodStart?: Date | null

  @Property({ name: 'period_end', type: 'date', nullable: true })
  periodEnd?: Date | null

  @Enum({ items: [...BANK_STATEMENT_STATUSES], type: 'text', name: 'status', default: 'imported' })
  status: (typeof BANK_STATEMENT_STATUSES)[number] = 'imported'

  @Property({ name: 'imported_by', type: 'uuid', nullable: true })
  importedBy?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

@Entity({ tableName: 'gl_bank_statement_lines' })
@Index({ name: 'gl_bank_statement_lines_statement_idx', properties: ['statementId'] })
@Index({ name: 'gl_bank_statement_lines_status_idx', properties: ['organizationId', 'status'] })
export class GlBankStatementLine {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'statement_id', type: 'uuid' })
  statementId!: string

  @Property({ name: 'line_number', type: 'integer', default: 0 })
  lineNumber: number = 0

  @Property({ name: 'transaction_date', type: 'date' })
  transactionDate!: Date

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'text', nullable: true })
  reference?: string | null

  @Property({ name: 'direction', type: 'text' })
  direction!: 'in' | 'out'

  @Property({ type: 'numeric', precision: 18, scale: 4, default: '0' })
  amount: string = '0'

  @Enum({ items: [...BANK_STATEMENT_LINE_STATUSES], type: 'text', name: 'status', default: 'unmatched' })
  status: (typeof BANK_STATEMENT_LINE_STATUSES)[number] = 'unmatched'

  @Property({ name: 'matched_entry_line_id', type: 'uuid', nullable: true })
  matchedEntryLineId?: string | null

  @Property({ name: 'matched_at', type: Date, nullable: true })
  matchedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
