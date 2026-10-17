import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, ManyToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'

export type CartChannel = 'storefront' | 'pos' | 'pay_link' | 'agent' | 'api'
export type CartKind = 'basket' | 'proposal'
export type CartStatus = 'active' | 'locked' | 'converted' | 'abandoned' | 'expired' | 'merged'
export type CartTaxMode = 'gross' | 'net'

export type CartLineOrigin = 'customer' | 'promotion'
export type CartLineFlagState = 'product_unavailable'
export type CartLineActorType = 'buyer' | 'rep' | 'ai_agent' | 'merge' | 'system'

export type CartPromotionScope = 'order' | 'line'

export type CartMergeStrategy = 'sum' | 'replace' | 'keep_target' | 'manual'
export type CartMergeActorType = 'buyer' | 'rep' | 'ai_agent' | 'system'
export type CartMergeLineDisposition = 'merged' | 'summed' | 'capped' | 'declined' | 'rejected'

// §4.4: shape fixed in rev 7 of the spec — per-line disposition, with the target line it
// became, so a merge is traceable rather than guessable by product identity.
export type CartMergeOutcomeEntry = {
  sourceLineId: string
  targetLineId: string | null
  disposition: CartMergeLineDisposition
  reason?: string
}

// §4.1: `Cart` and `CartLine` (below) self-reference each other within this module only
// (`proposed_to_cart_id`, `merged_into_cart_id` -> Cart; `cart_id` -> Cart from CartLine
// and friends) — never a cross-module relation. Columns that name another module's
// entity (`store_id` -> ecommerce.EcommerceStore, `sales_channel_id` -> sales.SalesChannel,
// `customer_id` -> customers.CustomerEntity, `customer_user_id` ->
// customer_accounts.CustomerUser, `approval_id` -> customer_groups.CustomerPurchaseApproval,
// `product_id`/`variant_id` -> catalog.*, `promotion_id` -> promotions.Promotion) stay
// plain `uuid` properties with no `@ManyToOne`, matching `availability_policies.store_id`'s
// precedent (`availability/data/entities.ts`) — root AGENTS.md "no direct ORM relationships
// between modules; use foreign key IDs and fetch separately".
@Entity({ tableName: 'carts' })
@Unique({ properties: ['tokenHash'] })
@Index({ name: 'carts_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'carts_tenant_customer_status_idx', properties: ['tenantId', 'customerId', 'status'] })
@Index({ name: 'carts_tenant_status_expires_idx', properties: ['tenantId', 'status', 'expiresAt'] })
@Index({ name: 'carts_tenant_status_activity_idx', properties: ['tenantId', 'status', 'lastActivityAt'] })
@Index({ name: 'carts_tenant_status_resolved_idx', properties: ['tenantId', 'status', 'resolvedAt'] })
@Index({
  // Partial index backing "what has been proposed to this buyer and is still live"
  // (§4.1) — only proposal carts carry a non-null proposed_to_cart_id in the first place,
  // so scoping the index to kind = 'proposal' keeps it both correct and small.
  name: 'carts_proposed_to_cart_status_idx',
  expression:
    'create index "carts_proposed_to_cart_status_idx" on "carts" ("tenant_id", "proposed_to_cart_id", "status") where "kind" = \'proposal\'',
})
export class Cart {
  [OptionalProps]?:
    | 'storeId'
    | 'kind'
    | 'proposedToCartId'
    | 'salesChannelId'
    | 'status'
    | 'customerId'
    | 'customerIds'
    | 'customerUserId'
    | 'customerGroupIds'
    | 'priceKindId'
    | 'email'
    | 'assortmentScopeHash'
    | 'promotionEffects'
    | 'requiresApproval'
    | 'approvalId'
    | 'note'
    | 'metadata'
    | 'mergedIntoCartId'
    | 'lastPriceChangeAt'
    | 'lockedAt'
    | 'lockExpiresAt'
    | 'checkoutSessionId'
    | 'resolvedAt'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  // §4.1/§8.3 (rev 9 — C13/D-R4-18): only the hash is ever persisted. The plaintext token
  // is returned once, at creation, in the response body — never stored, logged, or
  // re-derivable from this column.
  @Property({ name: 'token_hash', type: 'text' })
  tokenHash!: string

  /** `ecommerce.EcommerceStore.id`; null for non-storefront channels. */
  @Property({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string | null

  // Immutable after creation (rev 9 — F2/C1/D-R4-2) — enforced at the command layer, not
  // the schema; this column just carries the value.
  @Property({ name: 'channel', type: 'text' })
  channel!: CartChannel

  @Property({ name: 'kind', type: 'text', default: 'basket' })
  kind: CartKind = 'basket'

  // Self-FK within this module. Check constraint (hand-authored in the migration, §4.1:
  // "NOT NULL exactly when kind = 'proposal'") cannot be expressed by a MikroORM decorator.
  // `deleteRule: 'restrict'` is explicit rather than left to MikroORM's own default
  // (`set null`, which Postgres would reject anyway the moment it tried to null this
  // column on a row where kind = 'proposal', since that violates the CHECK constraint —
  // but as a confusing cross-table CHECK failure rather than a direct FK error). Carts
  // are never hard-deleted except by the 90-day purge sweeper (§12), which already
  // excludes carts a live proposal still points at, so this constraint never actually
  // fires in practice.
  @ManyToOne(() => Cart, { fieldName: 'proposed_to_cart_id', nullable: true, mapToPk: true, deleteRule: 'restrict' })
  proposedToCartId?: string | null

  /** `sales.SalesChannel.id`. */
  @Property({ name: 'sales_channel_id', type: 'uuid', nullable: true })
  salesChannelId?: string | null

  @Property({ name: 'status', type: 'text', default: 'active' })
  status: CartStatus = 'active'

  @Property({ name: 'currency_code', type: 'text' })
  currencyCode!: string

  @Property({ name: 'locale', type: 'text' })
  locale!: string

  /** `customers.CustomerEntity.id` — the identity that wins (D3/D3a, D-R4-28). */
  @Property({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId?: string | null

  // (rev 9 — W9/D-R4-28) `BuyerContext.customerIds` snapshot — broader than the single
  // winning `customer_id`, for order-history and per-customer-limit identity.
  @Property({ name: 'customer_ids', type: 'jsonb', nullable: true })
  customerIds?: string[] | null

  /** `customer_accounts.CustomerUser.id`. */
  @Property({ name: 'customer_user_id', type: 'uuid', nullable: true })
  customerUserId?: string | null

  @Property({ name: 'customer_group_ids', type: 'jsonb', default: [], nullable: false })
  customerGroupIds: string[] = []

  @Property({ name: 'price_kind_id', type: 'uuid', nullable: true })
  priceKindId?: string | null

  @Property({ name: 'tax_mode', type: 'text' })
  taxMode!: CartTaxMode

  // Guest identification; encrypted at rest — declared in cart/encryption.ts's
  // defaultEncryptionMaps (entityId: 'cart:cart'). Plain text column here: encryption is
  // transparent at the service/query layer (findWithDecryption), never a column-type wrapper.
  @Property({ name: 'email', type: 'text', nullable: true })
  email?: string | null

  @Property({ name: 'buyer_digest', type: 'text' })
  buyerDigest!: string

  // (rev 9 — W9) Distinct from buyer_digest: pricing can be stable while assortment
  // membership lapses, and vice versa.
  @Property({ name: 'assortment_scope_hash', type: 'text', nullable: true })
  assortmentScopeHash?: string | null

  // Verbatim SalesDocumentCalculationResult.totals — the cart does not round, re-sum or
  // adjust what sales returns (§3.2).
  @Property({ name: 'totals', type: 'jsonb' })
  totals!: Record<string, unknown>

  @Property({ name: 'totals_computed_at', type: Date })
  totalsComputedAt!: Date

  @Property({ name: 'promotion_effects', type: 'jsonb', nullable: true })
  promotionEffects?: unknown

  @Property({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval: boolean = false

  /** `customer_groups.CustomerPurchaseApproval.id` (not yet a real entity in this repo). */
  @Property({ name: 'approval_id', type: 'uuid', nullable: true })
  approvalId?: string | null

  // Buyer-supplied free text; encrypted at rest alongside email.
  @Property({ name: 'note', type: 'text', nullable: true })
  note?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  // Self-FK within this module; set when status = 'merged'. `set null` is safe here (no
  // CHECK constraint depends on it) — a merged cart surviving with this column nulled out
  // is a cosmetic loss, not a correctness one.
  @ManyToOne(() => Cart, { fieldName: 'merged_into_cart_id', nullable: true, mapToPk: true, deleteRule: 'set null' })
  mergedIntoCartId?: string | null

  @Property({ name: 'last_activity_at', type: Date })
  lastActivityAt!: Date

  @Property({ name: 'last_price_change_at', type: Date, nullable: true })
  lastPriceChangeAt?: Date | null

  @Property({ name: 'locked_at', type: Date, nullable: true })
  lockedAt?: Date | null

  @Property({ name: 'lock_expires_at', type: Date, nullable: true })
  lockExpiresAt?: Date | null

  @Property({ name: 'checkout_session_id', type: 'text', nullable: true })
  checkoutSessionId?: string | null

  // (rev 9 — Q6/D-R4-20, C8) Set when a cart leaves `active` for any terminal-for-purge
  // reason; purge-expired-carts counts the 90-day retention window from here, not expires_at.
  @Property({ name: 'resolved_at', type: Date, nullable: true })
  resolvedAt?: Date | null

  @Property({ name: 'expires_at', type: Date })
  expiresAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  // §4.1 (fixed 2026-08-17): no `version` column — this is the sole concurrency token
  // (enforceCommandOptimisticLock compares against it, §8.1).
  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  // No deleted_at: §9/§12 "purge-expired-carts ... Hard-delete carts expired more than 90
  // days ago" is this entity's only deletion path, and nothing in the command list
  // (cart.create/.get/.lines.*/.promotions.*/.merge/.mergeUndo/.approval.request/.reprice/
  // .lock/.unlock/.markConverted/.proposal.*) ever soft-deletes a cart — the lifecycle
  // (§9) is expressed entirely through `status`. A column no code path ever writes is
  // dead schema, not defense in depth.
}

// §4.2. `UNIQUE NULLS NOT DISTINCT (...) WHERE deleted_at IS NULL` (rev 9 — W3) and the
// `configuration_hash` stored generated column both use MikroORM v7's native declarative
// support for the exact feature they need (`@Index({ expression })` for a raw-SQL index,
// `@Property({ generated })` for a stored generated column) rather than a hand-authored
// migration-only statement — see `devices/data/entities.ts` (`UserDevice`) and
// `availability/data/entities.ts` (`AvailabilityPolicy`) for the NULLS NOT DISTINCT
// precedent, and `wms/data/entities.ts` (`InventoryBalance.quantityAvailable`) for the
// generated-column precedent. `yarn db:generate` emits the matching SQL for both from
// these decorators; only the Cart CHECK constraint above has no decorator equivalent and
// is hand-authored directly in the migration.
@Entity({ tableName: 'cart_lines' })
@Index({ name: 'cart_lines_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'cart_lines_cart_idx', properties: ['cartId'] })
@Index({
  name: 'cart_lines_unique_line_key',
  expression:
    'create unique index "cart_lines_unique_line_key" on "cart_lines" ("cart_id", "product_id", "variant_id", "configuration_hash", "promotion_id") nulls not distinct where "deleted_at" is null',
})
export class CartLine {
  [OptionalProps]?:
    | 'variantId'
    | 'sku'
    | 'optionValues'
    | 'quantityUnit'
    | 'uomSnapshot'
    | 'unitPriceNet'
    | 'unitPriceGross'
    | 'taxRate'
    | 'priceKindId'
    | 'priceRowId'
    | 'priceTierMinQuantity'
    | 'discountTotalNet'
    | 'promotionId'
    | 'origin'
    | 'flagState'
    | 'configuration'
    | 'configurationHash'
    | 'addedByActorId'
    | 'metadata'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Cart, { fieldName: 'cart_id', mapToPk: true, deleteRule: 'cascade' })
  cartId!: string

  @Property({ name: 'line_number', type: 'integer' })
  lineNumber!: number

  /** `catalog.CatalogProduct.id`. */
  @Property({ name: 'product_id', type: 'uuid' })
  productId!: string

  @Property({ name: 'variant_id', type: 'uuid', nullable: true })
  variantId?: string | null

  @Property({ name: 'sku', type: 'text', nullable: true })
  sku?: string | null

  // Snapshot — survives the product being renamed or deleted.
  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'option_values', type: 'jsonb', nullable: true })
  optionValues?: Record<string, string> | null

  // Decimal amounts travel as strings end-to-end (matches promotions'
  // decimalStringSchema convention) so precision never rounds through IEEE-754 floats.
  @Property({ name: 'quantity', type: 'numeric', precision: 16, scale: 4 })
  quantity!: string

  @Property({ name: 'quantity_unit', type: 'text', nullable: true })
  quantityUnit?: string | null

  @Property({ name: 'uom_snapshot', type: 'jsonb', nullable: true })
  uomSnapshot?: Record<string, unknown> | null

  @Property({ name: 'unit_price_net', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceNet?: string | null

  @Property({ name: 'unit_price_gross', type: 'numeric', precision: 16, scale: 4, nullable: true })
  unitPriceGross?: string | null

  @Property({ name: 'tax_rate', type: 'numeric', precision: 7, scale: 4, nullable: true })
  taxRate?: string | null

  @Property({ name: 'price_kind_id', type: 'uuid', nullable: true })
  priceKindId?: string | null

  /** `catalog.CatalogProductPrice.id` — explainability: which row won. */
  @Property({ name: 'price_row_id', type: 'uuid', nullable: true })
  priceRowId?: string | null

  @Property({ name: 'price_tier_min_quantity', type: 'integer', nullable: true })
  priceTierMinQuantity?: number | null

  @Property({ name: 'priced_at', type: Date })
  pricedAt!: Date

  // Verbatim SalesLineCalculationResult.
  @Property({ name: 'line_totals', type: 'jsonb' })
  lineTotals!: Record<string, unknown>

  // (rev 9 — F3/C10/D-R4-9) The persisted net line-total discount mapped to
  // SalesLineSnapshot.discountAmount (§3.2 rule 1); null when no promotion applies.
  @Property({ name: 'discount_total_net', type: 'numeric', precision: 16, scale: 4, nullable: true })
  discountTotalNet?: string | null

  // (rev 9 — F4/C3/D-R4-7) `promotions.Promotion.id` that produced a gift line. Soft
  // reference only: `cart` does not `requires: ['promotions']` yet (see index.ts), so no
  // hard ORM relation here — plain uuid, fetched separately when needed.
  @Property({ name: 'promotion_id', type: 'uuid', nullable: true })
  promotionId?: string | null

  @Property({ name: 'origin', type: 'text', default: 'customer' })
  origin: CartLineOrigin = 'customer'

  // (rev 9 — D-R4-5) Set by the §6a.2/§6a.5 re-visibility pass. Distinct from
  // `availability_state`, which is intentionally NOT a column at all (W14/D-R4-19):
  // availability is computed per response, never persisted, because a persisted field
  // written on every read would bump updated_at on every read and 409 the buyer's next write.
  @Property({ name: 'flag_state', type: 'text', nullable: true })
  flagState?: CartLineFlagState | null

  // Plaintext even though `cart:cart`'s email/note are encrypted (cart/encryption.ts):
  // encrypting this would break the stored configuration_hash generated column below.
  @Property({ name: 'configuration', type: 'jsonb', nullable: true })
  configuration?: Record<string, unknown> | null

  // (rev 9 — W3) Stored generated column over `configuration`, computed by Postgres itself
  // — never written by the entity. md5() over the jsonb cast to text is deterministic
  // because jsonb normalizes key order on storage, so two configurations that are
  // semantically equal always hash equal regardless of input key order. Matches
  // `InventoryBalance.quantityAvailable` (`wms/data/entities.ts`) for the declarative
  // generated-column pattern; `hidden: true` keeps this internal plumbing out of API
  // serialization, same as that precedent.
  @Property({
    name: 'configuration_hash',
    type: 'text',
    nullable: true,
    generated: (cols) => `(md5(${cols.configuration}::text)) stored`,
    hidden: true,
  })
  configurationHash?: string | null

  @Property({ name: 'added_by_actor_type', type: 'text' })
  addedByActorType!: CartLineActorType

  /** `auth.User.id` for rep/ai_agent, `customer_accounts.CustomerUser.id` for an identified buyer. */
  @Property({ name: 'added_by_actor_id', type: 'uuid', nullable: true })
  addedByActorId?: string | null

  @Property({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  // cart.lines.remove sets this rather than hard-deleting, so CartMergeLog.outcome and
  // CartContext history can still name a removed line. Every query filters
  // deleted_at IS NULL except the merge-log join (§4.2).
  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

// §4.3.
@Entity({ tableName: 'cart_promotion_applications' })
@Index({ name: 'cart_promotion_applications_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'cart_promotion_applications_cart_idx', properties: ['cartId'] })
export class CartPromotionApplication {
  [OptionalProps]?:
    | 'code'
    | 'codeId'
    | 'codeType'
    | 'codeReservationId'
    | 'cartLineId'
    | 'amountNet'
    | 'amountGross'
    | 'createdAt'
    | 'updatedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Cart, { fieldName: 'cart_id', mapToPk: true, deleteRule: 'cascade' })
  cartId!: string

  // Soft reference — same reasoning as CartLine.promotionId above.
  @Property({ name: 'promotion_id', type: 'uuid' })
  promotionId!: string

  @Property({ name: 'code', type: 'text', nullable: true })
  code?: string | null

  /** `promotions.PromotionCode.id` (X1) — soft reference. */
  @Property({ name: 'code_id', type: 'uuid', nullable: true })
  codeId?: string | null

  // (rev 9 — X1) Mirrors promotions' PromotionCodeType ('static' | 'dynamic') on the wire,
  // but kept as plain text here rather than a narrow TS union: the spec's own prose names
  // a different-looking example ("single_use | shared") than the promotions module's
  // actual Code.type enum, so this module does not assume a closed, authoritative set
  // without a hard dependency on promotions to confirm it against.
  @Property({ name: 'code_type', type: 'text', nullable: true })
  codeType?: string | null

  /** `promotions.CodeReservation.id`, keyed (code_id, cart_id) on the promotions side. */
  @Property({ name: 'code_reservation_id', type: 'uuid', nullable: true })
  codeReservationId?: string | null

  @Property({ name: 'scope', type: 'text' })
  scope!: CartPromotionScope

  // Same-module FK, nullable for order scope. `set null` rather than cascade: removing
  // the line this discount was attributed to should not also delete the application row
  // that records the discount was ever granted.
  @ManyToOne(() => CartLine, { fieldName: 'cart_line_id', nullable: true, mapToPk: true, deleteRule: 'set null' })
  cartLineId?: string | null

  // Resolved effect as returned by promotionsService, carrying both amountNet and
  // amountGross (D-R4-10).
  @Property({ name: 'effect', type: 'jsonb' })
  effect!: Record<string, unknown>

  @Property({ name: 'amount_net', type: 'numeric', precision: 16, scale: 4, nullable: true })
  amountNet?: string | null

  @Property({ name: 'amount_gross', type: 'numeric', precision: 16, scale: 4, nullable: true })
  amountGross?: string | null

  @Property({ name: 'applied_at', type: Date })
  appliedAt!: Date

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}

// §4.1 note under "CartIdempotencyKey" — session/token-like, append-only row (root
// AGENTS.md optimistic-lock exemption list): no updated_at, no deleted_at. Swept by
// expire-carts alongside the cart it belongs to.
@Entity({ tableName: 'cart_idempotency_keys' })
@Unique({ properties: ['cartId', 'key'] })
@Index({ name: 'cart_idempotency_keys_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
export class CartIdempotencyKey {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Cart, { fieldName: 'cart_id', mapToPk: true, deleteRule: 'cascade' })
  cartId!: string

  @Property({ name: 'key', type: 'text' })
  key!: string

  // Hash of the normalized request body — a replayed key with a different body is
  // detectable (§8.2) and returns 422 idempotency_key_mismatch at the command layer.
  @Property({ name: 'request_digest', type: 'text' })
  requestDigest!: string

  @Property({ name: 'response_status', type: 'integer' })
  responseStatus!: number

  // The original response envelope, replayed verbatim on a repeated key.
  @Property({ name: 'response_body', type: 'jsonb' })
  responseBody!: unknown

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}

// §4.4. Append-only — no updated_at, no deleted_at (same shape as PromotionUsage/CodeUsage
// in promotions/data/entities.ts: an audit ledger is immutable once written).
//
// source_cart_id / target_cart_id / proposal_cart_id delete-rule decision: `restrict`,
// not `cascade` and not `set null`. This mirrors PromotionUsage.promotionId's own
// `deleteRule: 'restrict'` in promotions/data/entities.ts, for the identical reason
// ("a ledger row must outlive the [thing] it audited ... cascading the delete here would
// erase the compliance record the table exists to keep"). `set null` was considered and
// rejected: nulling out which carts were involved in a merge destroys exactly the
// traceability this table exists to provide ("a lost basket can be reconstructed", §4.4).
// `restrict` instead makes the FK constraint itself the safeguard — a cart cannot be
// hard-deleted while a merge log still names it — which in practice never fires, because
// §12's purge-expired-carts is the only hard-delete path and already retains the merge log.
@Entity({ tableName: 'cart_merge_logs' })
@Index({ name: 'cart_merge_logs_tenant_org_idx', properties: ['tenantId', 'organizationId'] })
@Index({ name: 'cart_merge_logs_source_idx', properties: ['sourceCartId'] })
@Index({ name: 'cart_merge_logs_target_idx', properties: ['targetCartId'] })
export class CartMergeLog {
  [OptionalProps]?: 'mergedByActorId' | 'proposalCartId' | 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @ManyToOne(() => Cart, { fieldName: 'source_cart_id', mapToPk: true, deleteRule: 'restrict' })
  sourceCartId!: string

  @ManyToOne(() => Cart, { fieldName: 'target_cart_id', mapToPk: true, deleteRule: 'restrict' })
  targetCartId!: string

  @Property({ name: 'strategy', type: 'text' })
  strategy!: CartMergeStrategy

  // Full source lines before the merge.
  @Property({ name: 'source_snapshot', type: 'jsonb' })
  sourceSnapshot!: unknown

  // Per-line disposition with the target line it became (rev 7 shape fix) — see
  // CartMergeOutcomeEntry above.
  @Property({ name: 'outcome', type: 'jsonb' })
  outcome!: CartMergeOutcomeEntry[]

  @Property({ name: 'merged_by_actor_type', type: 'text' })
  mergedByActorType!: CartMergeActorType

  /** CustomerUser.id for buyer, auth.User.id for rep/ai_agent, null for guest/system. */
  @Property({ name: 'merged_by_actor_id', type: 'uuid', nullable: true })
  mergedByActorId?: string | null

  // Set when the merge was a proposal acceptance (§7a); null for a guest->customer merge.
  @ManyToOne(() => Cart, { fieldName: 'proposal_cart_id', nullable: true, mapToPk: true, deleteRule: 'restrict' })
  proposalCartId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
