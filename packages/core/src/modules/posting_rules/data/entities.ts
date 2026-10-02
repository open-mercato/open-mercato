import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

/**
 * A tenant-editable cost centre (MPK) — the tag `journal_entry_line_dimension`
 * attaches to a reclassified zespół 5 line. Deliberately flatter than Hay's
 * polymorphic Cost Center Assignment model (§7.19) — see the spec's
 * Literature & Prior Art / Alternatives Considered for why: nothing in this
 * project's Phase 1 needs a cost centre to attach to anything other than a
 * journal entry line, and a free-standing string with no entity at all was
 * already rejected (no place to rename/deactivate a department consistently).
 *
 * `code: 'UNALLOCATED'` is the seeded, non-deletable sentinel row the MPK
 * priority hybrid's third path always falls back to (see lib/seedDefaults.ts)
 * — a normal row like any other, distinguished only by its well-known code,
 * not a separate "system row" flag.
 */
@Entity({ tableName: 'posting_rules_cost_centers' })
@Index({
  name: 'posting_rules_cost_centers_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'posting_rules_cost_centers_scope_code_unique',
  properties: ['organizationId', 'tenantId', 'code'],
})
export class CostCenter {
  [OptionalProps]?: 'isActive' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

/**
 * The 4→5 account mapping and the default cost centre, in one row — see
 * the spec's Design Decisions, "`DefaultAccountPostingRule` does double
 * duty": splitting these into two tables would mean two lookups for what
 * is, in practice, one fact per source account. Ships user-editable from
 * Phase 1 (not deferred to Phase 2 — no universal 4→5 template can be
 * assumed once account numbering isn't standardized across tenants), so
 * this carries `updatedAt` from its own first migration, matching
 * `LedgerAccountType`'s user-editable shape, not `LedgerAccountGroup`'s
 * immutable-seed-row one.
 */
@Entity({ tableName: 'posting_rules_default_account_posting_rules' })
@Index({
  name: 'posting_rules_default_account_posting_rules_scope_idx',
  properties: ['organizationId', 'tenantId'],
})
@Unique({
  name: 'posting_rules_default_account_posting_rules_source_unique',
  properties: ['organizationId', 'tenantId', 'sourceAccountId'],
})
export class DefaultAccountPostingRule {
  [OptionalProps]?: 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** FK-id to `ledger.LedgerAccount` (a zespół 4 account) — plain FK-id,
   * no ORM relation, per this project's cross-module reference convention. */
  @Property({ name: 'source_account_id', type: 'uuid' })
  sourceAccountId!: string

  /** FK-id to `ledger.LedgerAccount` (a zespół 5 account). */
  @Property({ name: 'target_account_id', type: 'uuid' })
  targetAccountId!: string

  /** FK-id to this module's own `CostCenter`. Nullable — some accounts
   * may have no sensible default and always fall through to the seeded
   * sentinel `CostCenter` (see the MPK priority hybrid). */
  @Property({ name: 'default_cost_center_id', type: 'uuid', nullable: true })
  defaultCostCenterId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

/**
 * One row per organization. `clearingAccountId` (the account-490
 * equivalent) and `unallocatedCostAccountId` (the suspense-account
 * equivalent) both start `null` — no default, since there is no
 * tax-law- or convention-derived starting figure once account numbering
 * is entirely the tenant's own choice (see the spec's Design Decisions,
 * "New settings: `PostingRulesSettings`"). Not user-creatable directly —
 * upserted via `updatePostingRulesSettings`, seeded empty on organization
 * creation (see lib/seedDefaults.ts).
 */
@Entity({ tableName: 'posting_rules_settings' })
@Unique({
  name: 'posting_rules_settings_scope_unique',
  properties: ['organizationId', 'tenantId'],
})
export class PostingRulesSettings {
  [OptionalProps]?: 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  /** FK-id to `ledger.LedgerAccount` — the technical clearing account
   * (account 490 equivalent). Nullable, no default. */
  @Property({ name: 'clearing_account_id', type: 'uuid', nullable: true })
  clearingAccountId?: string | null

  /** FK-id to `ledger.LedgerAccount` — the unallocated-cost fallback
   * account. Nullable, no default. */
  @Property({ name: 'unallocated_cost_account_id', type: 'uuid', nullable: true })
  unallocatedCostAccountId?: string | null

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
