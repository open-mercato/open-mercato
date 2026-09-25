import { Check, Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

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
@Entity({ tableName: 'fiscal_periods' })
@Index({
  name: 'fiscal_periods_scope_idx',
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
@Entity({ tableName: 'ledger_account_groups' })
@Index({
  name: 'ledger_account_groups_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'ledger_account_groups_scope_code_unique',
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
@Entity({ tableName: 'ledger_account_types' })
@Index({
  name: 'ledger_account_types_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
// PR #6340 review, n4: partial (`where deleted_at is null`) so a
// soft-deleted account type's slug can be reused — see the migration's
// own comment on this index for why a plain `@Unique` (a table
// constraint, no `where` support in Postgres) couldn't express this and
// had to become a partial unique index instead.
@Unique({
  name: 'ledger_account_types_scope_slug_unique',
  properties: ['organizationId', 'tenantId', 'slug'],
  where: `"deleted_at" is null`,
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
@Entity({ tableName: 'ledger_accounts' })
@Index({
  name: 'ledger_accounts_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
// PR #6340 review, n4: partial (`where deleted_at is null`) — same
// reasoning as `ledger_account_types_scope_slug_unique` above.
@Unique({
  name: 'ledger_accounts_scope_slug_unique',
  properties: ['organizationId', 'tenantId', 'slug'],
  where: `"deleted_at" is null`,
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
@Entity({ tableName: 'journal_entries' })
@Index({
  name: 'journal_entries_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'journal_entries_operation_date_idx',
  properties: ['organizationId', 'operationDate'],
})
@Index({
  name: 'journal_entries_posted_at_idx',
  properties: ['organizationId', 'postedAt'],
})
@Index({
  name: 'journal_entries_reference_idx',
  properties: ['organizationId', 'referenceType', 'referenceId'],
})
@Unique({
  name: 'journal_entries_sequence_unique',
  properties: ['tenantId', 'organizationId', 'sequenceNumber'],
})
// PR #6340 review, n1: this partial unique index (the M3 double-reversal
// guard) existed only in the raw migration SQL, not in ORM metadata — a
// schema rebuilt from entity metadata, or a later `yarn db:generate` diff,
// wouldn't know about it. `where` matches the migration's predicate
// exactly.
//
// PR #6340 review, n3: the predicate also requires `type = 'REVERSAL'`
// (tightened from the original `reference_type = 'journal_entry' and
// reference_id is not null`, which any entry type could satisfy). Without
// this, an entry that isn't actually a reversal but happens to carry
// `referenceType: 'journal_entry'`/`referenceId: <id>` (rejected for
// external `postJournalEntry` callers by the schema as of n3, but the DB
// constraint shouldn't rely on that alone) would occupy `<id>`'s slot in
// this index, causing a genuine later reversal of `<id>` to fail with a
// raw unique violation instead of ever being insertable. Requiring
// `type = 'REVERSAL'` means only real reversals participate in the
// uniqueness check, while a concurrent double-reversal of the same entry
// (two real REVERSAL rows both pointing at it) is still caught here, not
// just by the application-layer `existingReversal` check in
// `reverseJournalEntry.ts`'s `loadOriginalEntry`.
@Unique({
  name: 'journal_entries_single_reversal_idx',
  properties: ['referenceType', 'referenceId'],
  where: `"type" = 'REVERSAL' and "reference_type" = 'journal_entry' and "reference_id" is not null`,
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
@Entity({ tableName: 'journal_entry_lines' })
@Index({
  name: 'journal_entry_lines_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Index({
  name: 'journal_entry_lines_entry_idx',
  properties: ['organizationId', 'journalEntryId'],
})
@Index({
  name: 'journal_entry_lines_account_idx',
  properties: ['organizationId', 'accountId'],
})
// PR #6340 review, n1: `assert_journal_entry_balanced()` (the deferred
// balance-check trigger) queries this table by `journal_entry_id` alone,
// with no `organization_id` predicate — the existing
// `journal_entry_lines_entry_idx` above leads with `organization_id` and
// so can't serve that lookup. This single-column index existed only in
// the raw migration SQL, not in ORM metadata.
@Index({
  name: 'journal_entry_lines_journal_entry_idx',
  properties: ['journalEntryId'],
})
@Check({
  name: 'journal_entry_lines_one_sided_chk',
  expression: `("debit" = 0 OR "credit" = 0) AND ("debit" > 0 OR "credit" > 0)`,
})
export class JournalEntryLine {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** FK-id to `JournalEntry`, mapped to the PK value rather than a
   * hydrated relation (`mapToPk: true`) — this keeps `journalEntryId`
   * typed and behaving as a plain `string`, exactly like `accountId`
   * below and every other cross-entity FK-id in this module, so no
   * query/command code that reads or assigns `journalEntryId` needs to
   * change.
   *
   * PR #6340 review, n1: the DB-level FK constraint
   * (`journal_entry_lines_journal_entry_fk`, added for m6) previously
   * existed only in the raw migration SQL, not in ORM metadata, so the
   * snapshot and a schema built from metadata alone didn't know about
   * it. `@ManyToOne` with `mapToPk: true` registers the same FK in
   * metadata (verified against a real Postgres instance: the emitted
   * `alter table ... add constraint ... foreign key` DDL is identical to
   * the migration's, and the property still reads/writes as a plain
   * uuid string, not a `Ref`/entity) without the hydration/query-builder
   * behavior change a normal relation would bring. */
  @ManyToOne(() => JournalEntry, {
    mapToPk: true,
    fieldName: 'journal_entry_id',
    foreignKeyName: 'journal_entry_lines_journal_entry_fk',
  })
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
   * module's own `encryption.ts`. Not populated by anything in this
   * phase. */
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
@Entity({ tableName: 'journal_entry_sequences' })
@Unique({
  name: 'journal_entry_sequences_scope_unique',
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
