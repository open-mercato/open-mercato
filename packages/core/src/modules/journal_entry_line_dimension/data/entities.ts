import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * The closed set of dimension types this table currently tags a journal
 * entry line with. Kept as a plain TS union here so this file has no
 * dependency on the validator module — the canonical, single source of
 * truth for validation is `DIMENSION_TYPES` in `data/validators.ts`. The
 * `dimension_type` column itself stays `text`, not a Postgres enum, so
 * adding a fifth type is a validator-layer change, not a migration (see
 * the spec's Data Models section).
 */
export type JournalEntryLineDimensionType = 'CostCenter' | 'BankAccount' | 'FixedAsset' | 'Currency'

/**
 * One independent analytical dimension tag on a single `ledger.JournalEntryLine`
 * row. A line can carry several of these at once (e.g. a `CostCenter` row and a
 * `FixedAsset` row), which is the whole reason this is a separate table rather
 * than a pair of columns on the line itself (see the spec's Design Decisions,
 * "A dedicated table, not a field on `JournalEntryLine`").
 *
 * `journalEntryLineId` is a plain FK-id to `ledger.JournalEntryLine` — no
 * `@ManyToOne` relation and no DB-level `FOREIGN KEY` constraint, matching
 * root `AGENTS.md`'s "no direct ORM relationships between modules" rule
 * (precedent: `JournalEntryLine.accountId`, itself a plain FK-id to
 * `LedgerAccount` with no relation).
 *
 * No `updatedAt`/`deletedAt`: rows for a given `(journalEntryLineId,
 * dimensionType)` pair are never individually edited or soft-deleted — they
 * are replaced atomically (old rows hard-deleted, new rows inserted, in the
 * same transaction) by `setJournalEntryLineDimension`. This matches the same
 * `createdAt`-only exemption already used by real, shipped sub-resource rows
 * (`CustomerTagAssignment`, `auth.UserRole`).
 *
 * Exported from this module so hard-dependency consumers (`posting_rules`,
 * later `fixed_assets`) can import and query it directly with their own
 * `entityManager`, scoped by `tenantId`/`organizationId` — the same real,
 * shipped precedent `sales` already uses to read `catalog`'s `CatalogProduct`
 * (see the spec's Design Decisions, "Cross-module access").
 */
@Entity({ tableName: 'journal_entry_line_dimensions' })
@Index({
  name: 'journal_entry_line_dimensions_line_type_idx',
  properties: ['journalEntryLineId', 'dimensionType'],
})
@Unique({
  name: 'journal_entry_line_dimensions_unique',
  properties: ['journalEntryLineId', 'dimensionType', 'dimensionId', 'tenantId', 'organizationId'],
})
export class JournalEntryLineDimension {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  /** FK-id to `ledger.JournalEntryLine`, no ORM relation (see class docstring). */
  @Property({ name: 'journal_entry_line_id', type: 'uuid' })
  journalEntryLineId!: string

  /**
   * `'CostCenter' | 'BankAccount' | 'FixedAsset' | 'Currency'` — an open
   * string, not a DB enum, validated against the closed `DIMENSION_TYPES`
   * list at the command boundary (`data/validators.ts`).
   */
  @Property({ name: 'dimension_type', type: 'text' })
  dimensionType!: string

  /**
   * References an entity in another module by id; which module depends on
   * `dimensionType` and is resolved by the caller, not by this table.
   * `text`, not `uuid`: the `'Currency'` dimension type's real target
   * (`currencies`/`sales` currency rows) is identified by ISO code, not a
   * uuid.
   */
  @Property({ name: 'dimension_id', type: 'text' })
  dimensionId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
