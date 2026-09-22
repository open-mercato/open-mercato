import { Check, Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type LedgerNormalBalance = 'DEBIT' | 'CREDIT'
export type JournalEntryType = 'NORMAL' | 'OPENING' | 'CLOSING' | 'REVERSAL'

/**
 * One row per accounting period. `isLocked` gates `postJournalEntry`: no
 * entry may post with an `operationDate` inside a locked period. User
 * editable (participates in the default-ON optimistic lock), hence
 * `updatedAt`. `deletedAt` exists for column-contract consistency only —
 * no delete route is exposed for `FiscalPeriod` in Phase 1.
 * See `.ai/specs/2026-08-18-general-ledger-core-engine.md` § Data Models
 * → FiscalPeriod.
 */
@Entity({ tableName: 'fiscal_period' })
@Index({
  name: 'fiscal_period_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
export class FiscalPeriod {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'start_date', type: 'date' })
  startDate!: Date

  @Property({ name: 'end_date', type: 'date' })
  endDate!: Date

  @Property({ name: 'is_locked', type: 'boolean', default: false })
  isLocked: boolean = false

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * Jurisdiction-specific chart-of-accounts classification dictionary
 * (Poland's "zespoły" 0-8 in Phase 1). Tenant/org scoped like every other
 * entity in this module — not a global reference table (see Design
 * decisions: "not a global table, not a hardcoded enum"). Seeded only by
 * `setup.ts`'s `seedDefaults`; never created/edited by a tenant through
 * any command, hence no `updatedAt`.
 */
@Entity({ tableName: 'ledger_account_group' })
@Index({
  name: 'ledger_account_group_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'ledger_account_group_scope_code_unique',
  properties: ['organizationId', 'tenantId', 'jurisdiction', 'code'],
})
export class LedgerAccountGroup {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  jurisdiction!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

/**
 * Hierarchical (`parentAccountTypeId`, self-referencing) chart-of-accounts
 * type, e.g. "Fixed Asset" or "Current Liability". `normalBalance` and
 * `accountGroupId` are immutable once any account of this type has posted
 * entries — enforced at the command layer (`updateLedgerAccountType`),
 * not by a DB constraint. All cross-entity references in this module are
 * plain FK-id columns with no ORM relation (see Design decisions:
 * "Currency is reused... plain FK-id... no cross-module ORM relation" —
 * applied here to every reference, including same-module ones, for the
 * same reason).
 */
@Entity({ tableName: 'ledger_account_type' })
@Index({
  name: 'ledger_account_type_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'ledger_account_type_scope_slug_unique',
  properties: ['organizationId', 'tenantId', 'slug'],
})
export class LedgerAccountType {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'normal_balance', type: 'text' })
  normalBalance!: LedgerNormalBalance

  /** Self-reference, FK-id only (no ORM relation). */
  @Property({ name: 'parent_account_type_id', type: 'uuid', nullable: true })
  parentAccountTypeId?: string | null

  /** FK-id to `LedgerAccountGroup`, no ORM relation. Immutable once any
   * account of this type has posted entries. */
  @Property({ name: 'account_group_id', type: 'uuid', nullable: true })
  accountGroupId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * One row per chart-of-accounts account. `parentAccountId` models the
 * static Chart-of-Accounts hierarchy (structural only in Phase 1 — see
 * Design decisions). `accountTypeId` is immutable once the account has
 * posted entries — enforced by `updateLedgerAccount`.
 */
@Entity({ tableName: 'ledger_account' })
@Index({
  name: 'ledger_account_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'ledger_account_scope_slug_unique',
  properties: ['organizationId', 'tenantId', 'slug'],
})
export class LedgerAccount {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  slug!: string

  /** FK-id to `LedgerAccountType`, no ORM relation. Immutable once this
   * account has posted entries. */
  @Property({ name: 'account_type_id', type: 'uuid' })
  accountTypeId!: string

  /** Self-reference, FK-id only. Structural only in Phase 1 — nothing
   * reads it yet (see Design decisions). */
  @Property({ name: 'parent_account_id', type: 'uuid', nullable: true })
  parentAccountId?: string | null

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * A posted double-entry journal entry header. Append-only and immutable
 * once posted — exempt from the default-ON optimistic lock (no
 * `updatedAt`/`deletedAt`; see Design decisions: "Corrections are
 * reversals, not undo"). `sequenceNumber` is allocated atomically from
 * `JournalEntrySequence` inside the same transaction as the insert (art.
 * 14 ust. 2 Ustawy o rachunkowości — consecutively numbered).
 * `operationDate`/`documentType`/`documentNumber`/`documentDate` are the
 * art. 23 ust. 2 statutory entry-content fields. `currencyId` is a plain
 * FK-id to `currencies.Currency.id` — no `Currency` entity ships with
 * this module (see Design decisions).
 */
@Entity({ tableName: 'journal_entry' })
@Index({
  name: 'journal_entry_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'journal_entry_operation_date_idx',
  properties: ['organizationId', 'operationDate'],
})
@Index({
  name: 'journal_entry_posted_at_idx',
  properties: ['organizationId', 'postedAt'],
})
@Index({
  name: 'journal_entry_reference_idx',
  properties: ['organizationId', 'referenceType', 'referenceId'],
})
@Unique({
  name: 'journal_entry_sequence_unique',
  properties: ['tenantId', 'organizationId', 'sequenceNumber'],
})
export class JournalEntry {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** Allocated atomically from `JournalEntrySequence`; never client-supplied. */
  @Property({ name: 'sequence_number', type: 'bigint' })
  sequenceNumber!: number

  /** Server-set to the current timestamp by `postJournalEntry` — the
   * caller never supplies it. Records *when the system recorded this*,
   * distinct from `operationDate` (the business event date). */
  @Property({ name: 'posted_at', type: 'timestamptz' })
  postedAt!: Date

  /** Art. 23 ust. 2 — required on every entry. Not nullable, and used
   * (not `postedAt`) for the fiscal-period lock check and the
   * `journal-entries` list's `periodId` filter. */
  @Property({ name: 'operation_date', type: 'date' })
  operationDate!: Date

  /** Dowód category (art. 20 ust. 2-3). Nullable in Phase 1 — no caller
   * produces a source document yet. */
  @Property({ name: 'document_type', type: 'text', nullable: true })
  documentType?: string | null

  /** Source document's own identifying number, legible business data —
   * not a surrogate key. Nullable in Phase 1. */
  @Property({ name: 'document_number', type: 'text', nullable: true })
  documentNumber?: string | null

  /** Populated only when it differs from `operationDate`, per the Act's
   * own "jeżeli różni się ona od daty dokonania operacji" qualifier. */
  @Property({ name: 'document_date', type: 'date', nullable: true })
  documentDate?: Date | null

  @Property({ type: 'text' })
  description!: string

  @Property({ type: 'text', default: 'NORMAL' })
  type: JournalEntryType = 'NORMAL'

  /** Plain FK-id to `currencies.Currency.id` — no ORM relation. */
  @Property({ name: 'currency_id', type: 'uuid' })
  currencyId!: string

  @Property({ name: 'exchange_rate', type: 'numeric', precision: 18, scale: 8, nullable: true })
  exchangeRate?: string | null

  /** Internal FK pointer ("which record in this system caused this
   * entry") — distinct from `documentType`/`documentNumber` above. Not
   * populated by anything in Phase 1. */
  @Property({ name: 'reference_type', type: 'text', nullable: true })
  referenceType?: string | null

  @Property({ name: 'reference_id', type: 'uuid', nullable: true })
  referenceId?: string | null
}

/**
 * A single debit/credit line of a `JournalEntry`. Carries its own
 * `organizationId`/`tenantId` — not just scope inherited through
 * `journalEntryId` — matching `sales.SalesInvoiceLine`'s precedent (see
 * Design decisions). Same append-only/immutable exemption as
 * `JournalEntry`. The deferred `journal_entry_line_balanced` constraint
 * trigger (added in this module's migration) enforces
 * `SUM(debit) = SUM(credit)` per `journalEntryId` at commit time; the
 * `@Check` below enforces the per-line "exactly one side populated"
 * invariant that a trigger isn't needed for.
 */
@Entity({ tableName: 'journal_entry_line' })
@Index({
  name: 'journal_entry_line_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'journal_entry_line_entry_idx',
  properties: ['organizationId', 'journalEntryId'],
})
@Index({
  name: 'journal_entry_line_account_idx',
  properties: ['organizationId', 'accountId'],
})
@Check({
  name: 'journal_entry_line_one_sided_chk',
  expression: `("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0)`,
})
export class JournalEntryLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** FK-id to `JournalEntry`, no ORM relation. */
  @Property({ name: 'journal_entry_id', type: 'uuid' })
  journalEntryId!: string

  /** FK-id to `LedgerAccount`, no ORM relation. */
  @Property({ name: 'account_id', type: 'uuid' })
  accountId!: string

  @Property({ type: 'numeric', precision: 19, scale: 4, default: '0' })
  debit: string = '0'

  @Property({ type: 'numeric', precision: 19, scale: 4, default: '0' })
  credit: string = '0'

  /** The amount in the entry's original currency (`JournalEntry.currencyId`) —
   * captured from day one even though Phase 1 balance validation runs
   * only in the base-currency `debit`/`credit` columns (see Design
   * decisions: Multi-currency). */
  @Property({ name: 'amount_currency', type: 'numeric', precision: 19, scale: 4, default: '0' })
  amountCurrency: string = '0'

  /** Point-in-time copy of the counterparty's name/NIP/bank
   * account/Biała Lista status at posting time. PII — declared in this
   * module's own `encryption.ts` (added in OM-2). Not populated by
   * anything in this phase. */
  @Property({ name: 'contractor_snapshot', type: 'json', nullable: true })
  contractorSnapshot?: Record<string, unknown> | null
}

/**
 * Per-`(organization_id, tenant_id)` allocation counter backing
 * `JournalEntry.sequenceNumber`. Modeled as an ordinary MikroORM entity
 * and allocated via an atomic `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING`, mirroring `sales.SalesDocumentSequence`'s shape and
 * allocation pattern exactly (see Design decisions, "corrected
 * 2026-09-18") — the same reason this entity keeps a synthetic `id`
 * primary key plus a `(organization_id, tenant_id)` unique constraint
 * (needed for the `ON CONFLICT` target) rather than a composite primary
 * key. A pure counter — never soft-deleted or optimistically locked.
 */
@Entity({ tableName: 'journal_entry_sequence' })
@Unique({
  name: 'journal_entry_sequence_scope_unique',
  properties: ['organizationId', 'tenantId'],
})
export class JournalEntrySequence {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'next_value', type: 'bigint', default: 1 })
  nextValue: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
