import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type PromotionRuleGroupOperator = 'and' | 'or'
export type PromotionBenefitAppliesTo = 'order' | 'line' | 'unit'
export type PromotionCodeType = 'static' | 'dynamic'
export type PromotionCodeUsageMode = 'single' | 'multiple' | 'unlimited'
export type PromotionUsageOrderType = 'order' | 'quote' | 'pos_cart'

// §Data Models (rev — W5a): `Promotion.ruleGroupId` and `RuleGroup.promotionId` form a
// two-table creation cycle. This module breaks it by making `Promotion.ruleGroupId` the
// NULLABLE side: a promotion is created first (no tree yet), then its root `RuleGroup`
// is created with `promotionId` already set (that FK is NOT NULL, below), then
// `Promotion.ruleGroupId` is set to the new root group's id inside the same creating
// transaction (`commands/promotions.ts`, Step 1.3). The root group is identified by
// `parentRuleGroupId IS NULL`, never by this pointer, per the spec's rev note.
@Entity({ tableName: 'promotions' })
@Index({ name: 'promotions_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'promotions_active_order_idx', properties: ['tenantId', 'organizationId', 'active', 'order'] })
export class Promotion {
  [OptionalProps]?:
    | 'active'
    | 'cumulative'
    | 'tags'
    | 'excludedTags'
    | 'excludeFlags'
    | 'eligibleCurrencies'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text', nullable: true })
  description?: string | null

  @Property({ type: 'int' })
  order!: number

  @Property({ type: 'boolean', default: false })
  active: boolean = false

  @Property({ name: 'starts_at', type: Date, nullable: true })
  startsAt?: Date | null

  @Property({ name: 'ends_at', type: Date, nullable: true })
  endsAt?: Date | null

  @Property({ type: 'boolean', default: true })
  cumulative: boolean = true

  @Property({ type: 'text[]' })
  tags: string[] = []

  @Property({ name: 'excluded_tags', type: 'text[]' })
  excludedTags: string[] = []

  @Property({ name: 'exclude_flags', type: 'jsonb' })
  excludeFlags: Record<string, boolean> = {}

  // Empty array = all currencies (§Data Models).
  @Property({ name: 'eligible_currencies', type: 'text[]' })
  eligibleCurrencies: string[] = []

  @Property({ name: 'max_budget', type: 'numeric', precision: 16, scale: 2, nullable: true })
  maxBudget?: string | null

  @Property({ name: 'budget_currency', type: 'text', nullable: true })
  budgetCurrency?: string | null

  // See class comment above (rev — W5a): nullable side of the Promotion<->RuleGroup
  // creation cycle. `mapToPk: true` keeps this a plain uuid column (no entity
  // population) matching this codebase's convention for FK-id columns — see
  // `PhoneCallParticipant.phoneCallId` in `phone_calls/data/entities.ts`.
  @ManyToOne(() => RuleGroup, { fieldName: 'rule_group_id', nullable: true, mapToPk: true })
  ruleGroupId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// §Data Models rev note (W5a): this is the NOT NULL side of the creation cycle — every
// `RuleGroup` row, root or nested, always belongs to exactly one promotion from the
// moment it is inserted. `Promotion.ruleGroupId` (above) is the nullable side that gets
// set afterwards. The root group of a tree is identified by `parentRuleGroupId IS NULL`.
@Entity({ tableName: 'promotion_rule_groups' })
@Index({ name: 'promotion_rule_groups_promotion_idx', properties: ['promotionId'] })
@Index({ name: 'promotion_rule_groups_parent_idx', properties: ['parentRuleGroupId'] })
@Index({ name: 'promotion_rule_groups_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class RuleGroup {
  [OptionalProps]?: 'sortOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // Deleting a Promotion cascades through this FK to every RuleGroup row for it
  // (root and nested alike, since every row denormalises `promotionId` — see §Data
  // Models "Denormalised for efficient tenant scoping"), satisfying the API contract's
  // "cascades to rule groups, rules, benefits via DB constraints".
  @ManyToOne(() => Promotion, { fieldName: 'promotion_id', deleteRule: 'cascade', mapToPk: true })
  promotionId!: string

  @ManyToOne(() => RuleGroup, {
    fieldName: 'parent_rule_group_id',
    nullable: true,
    deleteRule: 'cascade',
    mapToPk: true,
  })
  parentRuleGroupId?: string | null

  @Property({ type: 'text' })
  operator!: PromotionRuleGroupOperator

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// `ruleType`/`config` are a flat polymorphic row (§Data Models) — no TypeScript union at
// the entity level; `data/validators.ts` owns the per-`ruleType` Zod discriminated union.
// `organizationId`/`tenantId` are added here even though the spec's per-table column list
// omits them, per the Data Models section's blanket statement: "All entities include
// organization_id (uuid) and tenant_id (uuid) for tenant isolation."
@Entity({ tableName: 'promotion_rules' })
@Index({ name: 'promotion_rules_rule_group_idx', properties: ['ruleGroupId'] })
@Index({ name: 'promotion_rules_promotion_idx', properties: ['promotionId'] })
@Index({ name: 'promotion_rules_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class Rule {
  [OptionalProps]?: 'sortOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => RuleGroup, { fieldName: 'rule_group_id', deleteRule: 'cascade', mapToPk: true })
  ruleGroupId!: string

  @ManyToOne(() => Promotion, { fieldName: 'promotion_id', deleteRule: 'cascade', mapToPk: true })
  promotionId!: string

  @Property({ name: 'rule_type', type: 'text' })
  ruleType!: string

  @Property({ type: 'jsonb' })
  config!: Record<string, unknown>

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// Same `organizationId`/`tenantId` note as `Rule` above. `appliesTo` is a column, not a
// config field (§Data Models "Application target (applies_to)") — it decides the shape
// of the resolved effect and must be readable for extension benefit types core does not
// own the config schema for.
@Entity({ tableName: 'promotion_benefits' })
@Index({ name: 'promotion_benefits_rule_group_idx', properties: ['ruleGroupId'] })
@Index({ name: 'promotion_benefits_promotion_idx', properties: ['promotionId'] })
@Index({ name: 'promotion_benefits_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class Benefit {
  [OptionalProps]?: 'sortOrder' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => RuleGroup, { fieldName: 'rule_group_id', deleteRule: 'cascade', mapToPk: true })
  ruleGroupId!: string

  @ManyToOne(() => Promotion, { fieldName: 'promotion_id', deleteRule: 'cascade', mapToPk: true })
  promotionId!: string

  @Property({ name: 'benefit_type', type: 'text' })
  benefitType!: string

  @Property({ name: 'applies_to', type: 'text' })
  appliesTo!: PromotionBenefitAppliesTo

  @Property({ type: 'jsonb' })
  config!: Record<string, unknown>

  @Property({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number = 0

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// §Data Models rev W5d: `Code.code` and `GeneratedCode.code` share one normalised code
// namespace per `(tenant_id, organization_id)` — a lookup checks both tables. The spec's
// own column list for this table does not mark `code` unique, but the namespace note
// requires it; the partial unique index below (scoped to non-deleted, non-null `code`
// rows) enforces it for this table, mirroring `GeneratedCode`'s explicit "UNIQUE (per
// tenant)" below. A deleted static code's string is not kept permanently reserved.
@Entity({ tableName: 'promotion_codes' })
@Index({ name: 'promotion_codes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({
  name: 'promotion_codes_tenant_org_code_unique',
  expression:
    'create unique index "promotion_codes_tenant_org_code_unique" on "promotion_codes" ("tenant_id", "organization_id", "code") where "code" is not null and "deleted_at" is null',
})
export class Code {
  [OptionalProps]?: 'generated' | 'used' | 'active' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  name!: string

  @Property({ type: 'text' })
  type!: PromotionCodeType

  @Property({ type: 'text', nullable: true })
  code?: string | null

  @Property({ type: 'text', nullable: true })
  prefix?: string | null

  @Property({ type: 'text', nullable: true })
  suffix?: string | null

  @Property({ type: 'int', nullable: true })
  length?: number | null

  @Property({ type: 'int', nullable: true })
  amount?: number | null

  @Property({ type: 'int', default: 0 })
  generated: number = 0

  @Property({ type: 'int', default: 0 })
  used: number = 0

  @Property({ type: 'text' })
  usage!: PromotionCodeUsageMode

  @Property({ name: 'usage_amount', type: 'int', nullable: true })
  usageAmount?: number | null

  @Property({ name: 'usage_per_customer', type: 'int', nullable: true })
  usagePerCustomer?: number | null

  @Property({ type: 'boolean', default: true })
  active: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// §Data Models lists only `id`/`code_id`/`organization_id`/`tenant_id`/`code` for this
// table, but the Code Lifecycle section (`codes/use → deactivate GeneratedCode OR
// increment Code.used`) requires a flag to deactivate a generated code without deleting
// it (deleting would break the uniqueness-namespace audit trail). `active`/`createdAt`/
// `updatedAt` are added to close that gap — a resolved spec gap, flagged in the Step 1.2
// report. No soft delete here: deactivation uses `active`, not `deletedAt`.
@Entity({ tableName: 'promotion_generated_codes' })
@Index({ name: 'promotion_generated_codes_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Unique({ properties: ['tenantId', 'organizationId', 'code'] })
export class GeneratedCode {
  [OptionalProps]?: 'active' | 'createdAt' | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Code, { fieldName: 'code_id', deleteRule: 'cascade', mapToPk: true })
  codeId!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ type: 'text' })
  code!: string

  @Property({ type: 'boolean', default: true })
  active: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// §Data Models rev C4/C7/D-R4-8: `cart_id` is part of the unique key — a reservation
// holds real cart-level capacity, not customer-level. No `updatedAt`/`deletedAt`: this is
// a session/token-like row (root AGENTS.md optimistic-lock exemption list), hard-deleted
// outright by `codes/use`, `codes/release` or the sweeper, never soft-deleted.
@Entity({ tableName: 'promotion_code_reservations' })
@Unique({ properties: ['codeId', 'cartId'] })
@Index({ name: 'promotion_code_reservations_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'promotion_code_reservations_expires_idx', properties: ['expiresAt'] })
// Closes the reserve-time race the spec names for `usage_per_customer`-limited codes: two
// concurrent carts for the SAME customer could otherwise both obtain a reservation before
// either calls `use`. A plain `@Unique` can't express "unique only when customer_id is not
// null" (a guest's reservations are rightly scoped by cart only, never by identity) — same
// partial-index pattern as `configs.ModuleConfig`'s `module_configs_scoped_unique`.
@Index({
  name: 'promotion_code_reservations_code_customer_unique',
  expression:
    'create unique index "promotion_code_reservations_code_customer_unique" on "promotion_code_reservations" ("code_id", "customer_id") where "customer_id" is not null',
})
export class CodeReservation {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Code, { fieldName: 'code_id', deleteRule: 'cascade', mapToPk: true })
  codeId!: string

  @Property({ name: 'code_string', type: 'text' })
  codeString!: string

  @Property({ name: 'cart_id', type: 'uuid' })
  cartId!: string

  // Customer session identifier; null for a guest cart (§Data Models).
  @Property({ name: 'customer_id', type: 'text', nullable: true })
  customerId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date
}

// Append-only usage log — no `updatedAt`/`deletedAt` (optimistic-lock exemption list:
// append-only logs). `customerId` nullable: a guest's usage never needs per-customer
// limit tracking (§Data Models). `cartId`/`orderId`/`generatedCodeId`/`revertedAt` are
// additive (Release 5 C5/SPEC-055 amendment): `useCode` had nothing identifying WHICH
// cart or order a use belonged to, so `revertCodeUse` had nothing to key a reversal on
// — these columns close that gap. `revertedAt` is the one post-write mutation this
// append-only log allows, same non-destructive-revert precedent as
// `PromotionUsage.revertedAt` below: a reversal marks the row, it never deletes it.
@Entity({ tableName: 'promotion_code_usages' })
@Index({ name: 'promotion_code_usages_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'promotion_code_usages_code_idx', properties: ['codeId'] })
@Index({ name: 'promotion_code_usages_cart_idx', properties: ['cartId'] })
@Index({ name: 'promotion_code_usages_order_idx', properties: ['orderId'] })
export class CodeUsage {
  [OptionalProps]?: 'usedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @ManyToOne(() => Code, { fieldName: 'code_id', deleteRule: 'cascade', mapToPk: true })
  codeId!: string

  @Property({ name: 'cart_id', type: 'uuid', nullable: true })
  cartId?: string | null

  // A plain FK-id, never a `ManyToOne` into `sales` — `sales` is a downstream caller,
  // not an ORM-linked peer (AGENTS.md: no cross-module ORM relationships). Same
  // precedent as `PromotionUsage.orderId` below.
  @Property({ name: 'order_id', type: 'text', nullable: true })
  orderId?: string | null

  // Which specific dynamic voucher this use deactivated, so `revertCodeUse` reactivates
  // THAT row, never every `GeneratedCode` under the parent `Code`. `null` for a
  // static-code use. `deleteRule: 'set null'` (not cascade, unlike `codeId` above): a
  // deleted voucher must not take this audit row's history with it.
  @ManyToOne(() => GeneratedCode, { fieldName: 'generated_code_id', nullable: true, mapToPk: true, deleteRule: 'set null' })
  generatedCodeId?: string | null

  @Property({ name: 'customer_id', type: 'text', nullable: true })
  customerId?: string | null

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'used_at', type: Date, onCreate: () => new Date() })
  usedAt: Date = new Date()

  @Property({ name: 'reverted_at', type: Date, nullable: true })
  revertedAt?: Date | null
}

// Compliance audit ledger + global usage counter (§Data Models). `deleteRule: 'restrict'`
// (rev — W5b, NOT cascade): a ledger row must outlive the promotion it audited, so a
// `Promotion` with usage history can only be soft-deleted — cascading the delete here
// would erase the compliance record the table exists to keep. No `updatedAt`: rows are
// immutable once written; `revertedAt` is the only post-write mutation (never a delete).
@Entity({ tableName: 'promotion_usages' })
@Unique({ properties: ['promotionId', 'orderId', 'organizationId', 'tenantId'] })
@Index({
  name: 'promotion_usages_budget_idx',
  properties: ['promotionId', 'organizationId', 'tenantId', 'currency', 'revertedAt'],
})
export class PromotionUsage {
  [OptionalProps]?: 'registeredAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Promotion, { fieldName: 'promotion_id', deleteRule: 'restrict', mapToPk: true })
  promotionId!: string

  @Property({ name: 'order_id', type: 'text' })
  orderId!: string

  @Property({ name: 'order_type', type: 'text' })
  orderType!: PromotionUsageOrderType

  @Property({ name: 'customer_id', type: 'text', nullable: true })
  customerId?: string | null

  @Property({ type: 'text' })
  currency!: string

  @Property({ name: 'total_discount_amount', type: 'numeric', precision: 16, scale: 2 })
  totalDiscountAmount!: string

  @Property({ name: 'effects_snapshot', type: 'jsonb' })
  effectsSnapshot!: unknown

  @Property({ name: 'registered_at', type: Date, onCreate: () => new Date() })
  registeredAt: Date = new Date()

  @Property({ name: 'reverted_at', type: Date, nullable: true })
  revertedAt?: Date | null
}
