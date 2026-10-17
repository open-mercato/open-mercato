import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { ensureSameScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError, badRequest, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'

import { CatalogProduct } from '@open-mercato/core/modules/catalog/data/entities'
import { deriveQuantityRules } from '@open-mercato/core/modules/availability/lib/quantityRules'
import type { QuantityRulePolicy } from '@open-mercato/core/modules/availability/lib/quantityRules'
import type { PolicyResolutionService } from '@open-mercato/core/modules/availability/lib/policyResolution'

import { Cart, CartLine, CartMergeLog } from '../data/entities'
import type { CartMergeActorType, CartMergeLineDisposition, CartMergeOutcomeEntry, CartMergeStrategy } from '../data/entities'
import { generateCartToken, hashCartToken } from '../lib/token'
import { shouldEnforceAssortmentScope } from '../lib/routeContext'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { cartVisibilityKey, evaluateCartVisibility, isVisible } from '../lib/visibility'
import type { CartVisibilityResult } from '../lib/visibility'
import { assertCartNotLocked } from '../lib/lockGuard'
import { emitCartEvent } from '../events'
import { repriceCartCommand } from './cart'
import type { CartRepriceInput, CartRepriceResult } from './cart'
import { emitVisibilityRejectedEvent, toCartLineSnapshot } from './lines'
import type { CartLineSnapshot } from './lines'

// Step 7.3 — §7.1's merge policy (five login situations, rows 1-5; the sixth row,
// "Proposal accepted -> manual", is §7a's seam and explicitly out of Release 4 scope per
// PLAN.md's own Phase 4 note). `CartMergeLog` (§4.4) and ONE shared restore function,
// reached from two entry points: `cart.merge`'s own generic `undo` (the platform's
// command-undo-log mechanism, keyed to a specific `logEntry`) and the standalone,
// buyer-facing `cart.mergeUndo` command (keyed to "whatever this cart's most recent
// still-in-window merge was" — a buyer calling `POST /current/undo-merge` has no
// `logEntry` to hand over). That single shared function is `restoreCartMerge` below — the
// PLAN.md row's own title ("merge policy, merge log and single restore function") names
// exactly this.
//
// Step 7.4 — §6a.5's merge-time re-visibility pass, built in `buildMergeOutcome` below: every
// INCOMING source line (rows 3-5's union/sum/conflict pass only — rows 1/2, adopt/keep_target,
// never call `buildMergeOutcome` at all, since no line is newly admitted into a DIFFERENT cart
// by either of those rows) is re-checked against the survivor cart's freshly-resolved
// assortment scope BEFORE it is persisted or summed into a match. A failing line is REJECTED
// (`disposition: 'rejected'`, `targetLineId: null`, `reason: 'product_unavailable'`) — never
// admitted, never silently dropped (§6a.5). `CartMergeLineDisposition`/`CartMergeOutcomeEntry`
// already admitted `'rejected'` since Step 7.3 (deliberately left unreachable until this step).

const CART_LINE_ENTITY_ID = E.cart.cart_line
const CART_ENTITY_ID = E.cart.cart

const cartCrudIndexer: CrudIndexerConfig<Cart> = { entityType: CART_ENTITY_ID }
const cartCrudEvents: CrudEventsConfig<Cart> = {
  module: 'cart',
  entity: 'cart',
  persistent: true,
  buildPayload: (ctx) => ({
    id: ctx.identifiers.id,
    organizationId: ctx.identifiers.organizationId,
    tenantId: ctx.identifiers.tenantId,
  }),
}
const cartLineCrudIndexer: CrudIndexerConfig<CartLine> = { entityType: CART_LINE_ENTITY_ID }

type CartMergeScope = { tenantId: string; organizationId: string }

function getCartIdentifiers(cart: Cart) {
  return { id: cart.id, organizationId: cart.organizationId, tenantId: cart.tenantId }
}

function getCartLineIdentifiers(line: CartLine) {
  return { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId }
}

// ---------------------------------------------------------------------------
// Shared: `(product_id, variant_id, configuration_hash)` matching — the same key
// `cart_lines_unique_line_key` encodes (§4.2), minus `promotion_id` (gift lines are
// excluded from this pass entirely — see `filterCustomerLines` below).
// ---------------------------------------------------------------------------

/** Deep-equality on `configuration`, canonicalizing key order — mirrors
 * `commands/lines.ts`'s identically-named helper exactly (duplicated at this file's own
 * small scope per this module's established precedent: `lib/reprice.ts`, `lib/cartView.ts`
 * and `lib/idempotency.ts` all duplicate this same pair of tiny functions rather than
 * exporting lines.ts's private ones). */
function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function buildLineMatchKey(productId: string, variantId: string | null, configuration: Record<string, unknown> | null): string {
  return `${productId}:${variantId ?? ''}:${canonicalJson(configuration ?? null)}`
}

/** Only `origin: 'customer'` lines ever participate in the §7.1 policy decision or the
 * union/sum/conflict pass. A `origin: 'promotion'` (gift) line is evaluator OUTPUT, never
 * "the buyer's" content (§4.2) — §7.1's table never names a gift-line disposition, and
 * the task brief is explicit: a source gift line is simply dropped from the union with no
 * disposition needed, since the target's own mandatory post-merge re-price (§7.3)
 * regenerates its own gifts from scratch for the new buyer context regardless. This
 * applies to BOTH carts: a target cart's existing gift lines don't count toward "target
 * non-empty" either (an all-gift cart is, for merge-policy purposes, empty). */
function filterCustomerLines(lines: CartLine[]): CartLine[] {
  return lines.filter((line) => line.origin === 'customer' && line.deletedAt == null)
}

// ---------------------------------------------------------------------------
// Shared: quantity-rule max-cap resolution (§7.1 row 4's "capped at maxOrderQuantity")
// ---------------------------------------------------------------------------

function tryResolvePolicyResolutionService(container: { resolve: <T = unknown>(name: string) => T }): PolicyResolutionService | null {
  try {
    return container.resolve<PolicyResolutionService>('policyResolutionService') ?? null
  } catch {
    return null
  }
}

/** Batched, mirroring `commands/lines.ts`'s `bulkAddLinesCommand` own policy-resolution
 * batching: one product fetch + one `resolveMany` call for every matched (sum/cap
 * candidate) pair, never one query per line. */
async function resolveMaxOrderQuantities(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scope: CartMergeScope,
  storeId: string | null,
  lines: CartLine[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>()
  if (lines.length === 0) return result

  const productIds = Array.from(new Set(lines.map((line) => line.productId)))
  const products = (await findWithDecryption(
    em,
    CatalogProduct,
    { id: { $in: productIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )) as CatalogProduct[]
  const productsById = new Map(products.map((product) => [product.id, product]))

  const resolver = tryResolvePolicyResolutionService(container)
  const policies: QuantityRulePolicy[] = resolver
    ? await resolver.resolveMany(
        em,
        lines.map((line) => ({ tenantId: scope.tenantId, organizationId: scope.organizationId, storeId, productId: line.productId, variantId: line.variantId ?? null })),
      )
    : lines.map(() => null)

  lines.forEach((line, index) => {
    const product = productsById.get(line.productId)
    if (!product) {
      result.set(line.id, null)
      return
    }
    const rules = deriveQuantityRules(policies[index] ?? null, product)
    result.set(line.id, rules.maxOrderQuantity)
  })
  return result
}

// ---------------------------------------------------------------------------
// §4.4's `outcome` reversibility — THE KEY DESIGN DECISION for this step.
// ---------------------------------------------------------------------------
//
// `POST /current/undo-merge` must restore the PRE-merge state exactly, within 15 minutes.
// For a `summed`/`capped` disposition, undoing it means decrementing the target line's
// quantity back to what it was — and the exported, spec-frozen `CartMergeOutcomeEntry`
// shape (`{ sourceLineId, targetLineId, disposition, reason? }`, §4.4 "shape fixed in
// rev 7") carries no before/after quantity to reverse by.
//
// Chosen mechanism (option (a) from the task brief): extend the STORED `outcome` jsonb
// payload with one additional, optional field — `previousTargetQuantity` — on top of the
// exported `CartMergeOutcomeEntry` shape, rather than inventing a parallel column.
// `CartMergeLog.outcome` is declared `outcome!: CartMergeOutcomeEntry[]` in
// `data/entities.ts`, but that is a TypeScript annotation over a `jsonb` column with no
// runtime schema enforcement — a `StoredMergeOutcomeEntry[]` (a structural SUBTYPE of
// `CartMergeOutcomeEntry[]`, adding one optional field) satisfies that property's type
// exactly and persists the extra field in the same JSON blob at zero migration cost. The
// exported `CartMergeOutcomeEntry` type itself is untouched — nothing outside this file
// (or a future Step 7.4) ever needs to know the extra field exists.
//
// For a `merged` (union/conflict) disposition, no quantity data is needed at all: the
// target line did not exist before the merge, so undo is simply "delete this target line
// id" — inferred directly from the disposition, not from any stored field.
export type StoredMergeOutcomeEntry = CartMergeOutcomeEntry & {
  /** Only meaningful for `disposition: 'summed' | 'capped'` — the target line's own
   * quantity (as the numeric-string column convention this module uses throughout)
   * immediately BEFORE this merge changed it. Absent/`null` for every other disposition. */
  previousTargetQuantity?: string | null
}

/** The pre-merge buyer-identity snapshot of the cart that ADOPTION (§7.1 row 1, strategy
 * `'replace'`) reassigns ownership of — needed so `cart.mergeUndo` can reverse the
 * reassignment exactly. Stored inside `CartMergeLog.sourceSnapshot` (declared `unknown` in
 * `data/entities.ts` — no exported type to respect, so extending its runtime shape here is
 * free) rather than a new column, alongside the full pre-merge source lines §4.4 already
 * requires that column to carry. */
export type SurvivorBuyerContextSnapshot = {
  customerId: string | null
  customerIds: string[] | null
  customerUserId: string | null
  customerGroupIds: string[]
  priceKindId: string | null
  buyerDigest: string
}

export type StoredSourceSnapshot = {
  lines: CartLineSnapshot[]
  /** Present only when `strategy === 'replace'` (adoption). */
  survivorBuyerContextBefore?: SurvivorBuyerContextSnapshot | null
}

function normalizeSourceSnapshot(raw: unknown): StoredSourceSnapshot {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'lines' in (raw as Record<string, unknown>)) {
    const candidate = raw as { lines?: unknown; survivorBuyerContextBefore?: unknown }
    return {
      lines: Array.isArray(candidate.lines) ? (candidate.lines as CartLineSnapshot[]) : [],
      survivorBuyerContextBefore: (candidate.survivorBuyerContextBefore as SurvivorBuyerContextSnapshot | null | undefined) ?? null,
    }
  }
  // Defensive fallback — a bare array is not a shape this file ever writes, but guards
  // against a hand-authored or future-format row that is.
  return { lines: Array.isArray(raw) ? (raw as CartLineSnapshot[]) : [], survivorBuyerContextBefore: null }
}

// ---------------------------------------------------------------------------
// cart.merge
// ---------------------------------------------------------------------------

export type CartMergeInput = {
  /** The cart the buyer's own session/token names — resolved by the ROUTE the ordinary
   * way (`X-Cart-Token` + `resolveCurrentCart`), never re-resolved here. */
  targetCartId: string
  tenantId: string
  organizationId: string
  /** Identifies the SOURCE (guest) cart — the only thing that can, since it has no
   * session of its own (documented judgment call on the public body shape, §10's route
   * table never states one — see `data/validators.ts`'s `cartMergeRequestSchema`). */
  sourceToken: string
  /** Always supplied on this step's one calling path (`POST /current/merge`, always a
   * storefront route) — used for the ADOPT case's ownership reassignment, the merge log's
   * `merged_by_actor_*` attribution, and the post-merge mandatory re-price dispatch. */
  routeContext: ResolvedCartRouteContext
}

export type CartMergeSummary = {
  strategy: CartMergeStrategy
  mergeLogId: string
  /** `true` exactly when §7.1 row 1 (adopt) fired — the SURVIVING cart is the former
   * SOURCE (guest) cart, not the session's original target. */
  adopted: boolean
  counts: { merged: number; summed: number; capped: number; declined: number; rejected: number }
  /** The same `CartMergeOutcomeEntry[]` the log persists, minus the internal
   * `previousTargetQuantity` reversibility field — "derive it from the same array you are
   * already building for the log, don't invent a parallel structure" (task brief). */
  lines: CartMergeOutcomeEntry[]
}

export type CartMergeResult = {
  cart: CartRepriceResult['cart']
  /** The rotated plaintext token for the SURVIVING cart (§8.3: "rotated on merge and on
   * adoption" — read here as: rotated for the cart that ends up being the live one after
   * ANY `cart.merge` call, not only the adoption sub-case; see this command's own
   * `generateCartToken()` call site for the full reasoning). Appears here, and only here,
   * same "token appears once" convention `cart.create` already follows. */
  token: string
  mergeSummary: CartMergeSummary
  priceChanges: CartRepriceResult['priceChanges']
  warnings?: CartRepriceResult['warnings']
}

type MergeLineFields = {
  outcome: StoredMergeOutcomeEntry[]
  newLines: CartLine[]
  updatedLineIds: string[]
}

/**
 * The combined §7.1 rows 3-5 pass over every SOURCE customer-origin line: a target match
 * (by `(productId, variantId, configuration)`, the same key `cart_lines_unique_line_key`
 * encodes minus `promotion_id`) is summed (capped at `maxOrderQuantity` when a limit
 * applies); no match — whether because the line is genuinely disjoint (row 3) or because
 * it shares a product+variant with a target line but differs on configuration (row 5's
 * "conflict") — creates a brand-new target line. Both of those "no match" cases produce
 * the IDENTICAL mechanical outcome (a new line, disposition `'merged'`); the spec's rows 3
 * and 5 differ only in WHY no match occurred, not in what the merge does about it, so this
 * pass does not need two code paths for them.
 *
 * Step 7.4 — §6a.5: `visibility` is checked FIRST, before a source line is even matched
 * against a target line — a line can fail visibility even when it would otherwise just sum
 * into a matching target line (the task brief's own example), so the match/sum logic below
 * never runs for a rejected line at all. A rejected line produces NO target line and NO
 * quantity change to any existing one; its own outcome entry carries `targetLineId: null`
 * and `reason: 'product_unavailable'`, same shape `CartMergeOutcomeEntry.reason?` already
 * exists for. `visibility` is precomputed by the caller via ONE batched
 * `evaluateCartVisibility` call (never per-line) — this function stays a plain, synchronous
 * classifier, with no `em` read of its own, so it is free to run outside `withAtomicFlush`
 * alongside the rest of this file's existing pre-flush line-building logic.
 */
function buildMergeOutcome(
  em: EntityManager,
  sourceLines: CartLine[],
  targetLines: CartLine[],
  maxQuantityBySourceLineId: Map<string, number | null>,
  survivorCart: Cart,
  startingLineNumber: number,
  visibility: CartVisibilityResult,
): MergeLineFields {
  const targetByKey = new Map<string, CartLine>()
  for (const line of targetLines) {
    targetByKey.set(buildLineMatchKey(line.productId, line.variantId ?? null, line.configuration ?? null), line)
  }

  const outcome: StoredMergeOutcomeEntry[] = []
  const newLines: CartLine[] = []
  const updatedLineIds: string[] = []
  let nextLineNumber = startingLineNumber

  for (const sourceLine of sourceLines) {
    const visibilityRef = { productId: sourceLine.productId, variantId: sourceLine.variantId ?? null }
    const visible = isVisible(visibility.get(cartVisibilityKey(visibilityRef)) ?? 'unavailable')
    if (!visible) {
      outcome.push({
        sourceLineId: sourceLine.id,
        targetLineId: null,
        disposition: 'rejected',
        reason: 'product_unavailable',
      })
      continue
    }

    const key = buildLineMatchKey(sourceLine.productId, sourceLine.variantId ?? null, sourceLine.configuration ?? null)
    const matched = targetByKey.get(key)

    if (!matched) {
      const newLine = em.create(CartLine, {
        organizationId: survivorCart.organizationId,
        tenantId: survivorCart.tenantId,
        cartId: survivorCart.id,
        lineNumber: nextLineNumber,
        productId: sourceLine.productId,
        variantId: sourceLine.variantId ?? null,
        sku: sourceLine.sku ?? null,
        name: sourceLine.name,
        optionValues: sourceLine.optionValues ?? null,
        quantity: sourceLine.quantity,
        quantityUnit: sourceLine.quantityUnit ?? null,
        uomSnapshot: sourceLine.uomSnapshot ?? null,
        unitPriceNet: sourceLine.unitPriceNet ?? null,
        unitPriceGross: sourceLine.unitPriceGross ?? null,
        taxRate: sourceLine.taxRate ?? null,
        priceKindId: sourceLine.priceKindId ?? null,
        priceRowId: sourceLine.priceRowId ?? null,
        priceTierMinQuantity: sourceLine.priceTierMinQuantity ?? null,
        pricedAt: sourceLine.pricedAt,
        lineTotals: sourceLine.lineTotals,
        discountTotalNet: sourceLine.discountTotalNet ?? null,
        promotionId: null,
        origin: 'customer' as const,
        // Preserved rather than reset — honest carry-over of the line's last-known state.
        // This line already passed THIS merge's own §6a.5 visibility check above (the
        // `continue` on rejection means execution never reaches here for a failing line);
        // any pre-existing flag was set by an UNRELATED check and is left for the next
        // §6a.2 whole-cart pass (trigger 2) to resolve, same as any other line's.
        flagState: sourceLine.flagState ?? null,
        configuration: sourceLine.configuration ?? null,
        addedByActorType: 'merge' as const,
        addedByActorId: null,
        metadata: sourceLine.metadata ?? null,
      })
      nextLineNumber += 1
      newLines.push(newLine)
      outcome.push({ sourceLineId: sourceLine.id, targetLineId: null, disposition: 'merged' })
      continue
    }

    const previousTargetQuantity = matched.quantity
    const summedQuantity = Number(matched.quantity) + Number(sourceLine.quantity)
    const maxOrderQuantity = maxQuantityBySourceLineId.get(sourceLine.id) ?? null
    const capped = maxOrderQuantity != null && summedQuantity > maxOrderQuantity
    const finalQuantity = capped ? maxOrderQuantity! : summedQuantity
    matched.quantity = String(finalQuantity)
    updatedLineIds.push(matched.id)
    outcome.push({
      sourceLineId: sourceLine.id,
      targetLineId: matched.id,
      disposition: capped ? 'capped' : 'summed',
      previousTargetQuantity,
    })
  }

  return { outcome, newLines, updatedLineIds }
}

const mergeCartCommand: CommandHandler<CartMergeInput, CartMergeResult> = {
  id: 'cart.merge',
  // §3.1a's command-undo table: "cart.merge | Yes (cart.mergeUndo, 15 min) | §7.2". The
  // generic undo path below and the standalone `cart.mergeUndo` command share ONE restore
  // function (`restoreCartMerge`) — see this file's header comment.
  isUndoable: true,
  async execute(input, ctx) {
    const scope: CartMergeScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const sessionCart = await findOneWithDecryption(
      em,
      Cart,
      { id: input.targetCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
      {},
      scope,
    )
    if (!sessionCart) throw notFound('[internal] cart not found')

    const guestCart = await findOneWithDecryption(
      em,
      Cart,
      { tokenHash: hashCartToken(input.sourceToken), tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
      {},
      scope,
    )
    // §6a.3's no-write-side-enumeration-oracle discipline extends naturally here: a wrong
    // token, a cross-tenant token and a genuinely absent source cart all collapse to the
    // same 404 — never a distinguishable reason.
    if (!guestCart) throw notFound('[internal] source cart not found')
    if (guestCart.id === sessionCart.id) throw badRequest('[internal] cannot merge a cart into itself')
    // Same store, same currency only (PLAN.md's own Step 7.3 scope line; §16 Open Question 2
    // — "Cross-store carts [are] scoped to one store per the roadmap" — reads as the reason
    // this constraint exists, not an incidental detail). A guest cart assembled on one
    // storefront/currency and a customer cart on another have no shared assortment scope,
    // price kind or tax mode to reconcile — merging them would mix store-scoped lines
    // under a currency/store the buyer never saw them priced in. Rejected with a `400` and
    // an explicit `code` (this file's own convention for a policy violation that is not a
    // missing-resource case, e.g. `merge_undo_window_expired` below) rather than the
    // no-oracle 404 collapse used above: a mismatched store/currency is not a credential or
    // existence question, so there is nothing to protect by obscuring the reason.
    if (guestCart.storeId !== sessionCart.storeId || guestCart.currencyCode !== sessionCart.currencyCode) {
      throw new CrudHttpError(400, { error: '[internal] cart_merge_scope_mismatch', code: 'cart_merge_scope_mismatch' })
    }
    // Step 7.5 — §9: a locked TARGET (session) cart gets the distinguishable `423
    // cart_locked`, not the generic collapse below — a buyer mid-checkout should not be
    // able to merge a second cart into the one cart `checkout` is currently holding.
    // Documented judgment call: a locked GUEST/source cart is deliberately left OUT of this
    // distinction and falls through into the generic 404 collapse just below, same as any
    // other non-active source status — merging FROM a cart that happens to be stuck in
    // someone else's checkout is a far stranger case than locking the survivor out from
    // under an in-progress checkout, and the buyer has no real stake in being told which
    // specific non-active reason the source cart is unavailable for.
    assertCartNotLocked(sessionCart)
    // A non-active cart on either side (already merged/expired/converted/locked/abandoned)
    // is treated as unavailable for merge purposes, same no-oracle collapse as above —
    // neither §7.1 nor §7.2 names a merge-of-an-inactive-cart case, and admitting one would
    // let a stale or already-consumed cart re-enter the merge pass.
    if (sessionCart.status !== 'active' || guestCart.status !== 'active') {
      throw notFound('[internal] cart not found')
    }

    const sessionLinesAll = (await findWithDecryption(
      em,
      CartLine,
      { cartId: sessionCart.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartLine[]
    const guestLinesAll = (await findWithDecryption(
      em,
      CartLine,
      { cartId: guestCart.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartLine[]

    const sessionCustomerLines = filterCustomerLines(sessionLinesAll)
    const guestCustomerLines = filterCustomerLines(guestLinesAll)

    const now = new Date()
    let strategy: CartMergeStrategy
    let survivorCart: Cart
    let absorbedCart: Cart
    let absorbedLinesForSnapshot: CartLine[]
    let survivorBuyerContextBefore: SurvivorBuyerContextSnapshot | null = null
    let outcome: StoredMergeOutcomeEntry[] = []
    let newLines: CartLine[] = []

    // §7.1's policy table, rows 1-5 (the sixth, "Proposal accepted -> manual", is §7a's
    // seam and out of scope). Precedence: "guest cart empty" (row 2) is checked FIRST so a
    // cart that is empty on BOTH sides also resolves to `keep_target` (nothing to adopt
    // either) rather than falling through to row 1's condition.
    if (guestCustomerLines.length === 0) {
      // Row 2: keep_target — nothing moves.
      strategy = 'keep_target'
      survivorCart = sessionCart
      absorbedCart = guestCart
      absorbedLinesForSnapshot = guestLinesAll
      outcome = []
    } else if (sessionCustomerLines.length === 0) {
      // Row 1: adopt — the guest cart's ownership is reassigned; it becomes the live cart.
      strategy = 'replace'
      survivorCart = guestCart
      absorbedCart = sessionCart
      absorbedLinesForSnapshot = sessionLinesAll
      survivorBuyerContextBefore = {
        customerId: survivorCart.customerId ?? null,
        customerIds: survivorCart.customerIds ?? null,
        customerUserId: survivorCart.customerUserId ?? null,
        customerGroupIds: survivorCart.customerGroupIds,
        priceKindId: survivorCart.priceKindId ?? null,
        buyerDigest: survivorCart.buyerDigest,
      }
      survivorCart.customerId = input.routeContext.customerId
      survivorCart.customerIds = input.routeContext.customerIds
      survivorCart.customerUserId = input.routeContext.customerUserId
      survivorCart.customerGroupIds = input.routeContext.customerGroupIds
      survivorCart.priceKindId = input.routeContext.priceKindId
      survivorCart.buyerDigest = input.routeContext.buyerDigest
      outcome = []
    } else {
      // Rows 3-5 combined: union (disjoint), sum (matching, default strategy per §7.1),
      // conflict (matching product+variant, differing configuration -> kept separate).
      strategy = 'sum'
      survivorCart = sessionCart
      absorbedCart = guestCart
      absorbedLinesForSnapshot = guestLinesAll

      const maxQuantities = await resolveMaxOrderQuantities(em, ctx.container, scope, survivorCart.storeId ?? null, guestCustomerLines)
      const startingLineNumber = sessionLinesAll.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 1

      // Step 7.4 — §6a.5: the SAME enforcement key §6a.1b/§6a.4 already use elsewhere in
      // this module — enforce iff the SURVIVOR's channel is storefront or a scope was
      // resolved for this call. `routeContext.assortmentScope` is the buyer's own, freshly
      // resolved (`{ fresh: true }`, D-R4-22) scope for THIS request — never the source
      // cart's, and never anything the request body could supply.
      const mergeAssortmentScope = shouldEnforceAssortmentScope(survivorCart.channel, input.routeContext.assortmentScope)
        ? input.routeContext.assortmentScope
        : undefined
      const mergeVisibility: CartVisibilityResult = await evaluateCartVisibility({
        lines: guestCustomerLines.map((line) => ({ productId: line.productId, variantId: line.variantId ?? null })),
        scope: mergeAssortmentScope,
        tenantScope: scope,
        em,
        container: ctx.container,
      })

      const built = buildMergeOutcome(em, guestCustomerLines, sessionCustomerLines, maxQuantities, survivorCart, startingLineNumber, mergeVisibility)
      outcome = built.outcome
      newLines = built.newLines
      // `built.updatedLineIds` (the SUMMED/CAPPED target lines) is not separately emitted —
      // see the "Summed/capped lines are not NEW" comment further down this function.
    }

    // §8.3: "rotated on merge and on adoption" — read as: the cart that ends up being the
    // LIVE one after ANY `cart.merge` call gets its token rotated, always, not only in the
    // adoption sub-case. Documented judgment call: rotating unconditionally is the simplest
    // reading that satisfies both named cases in one rule, and a login/merge event is
    // exactly the kind of trust-boundary crossing session-fixation hygiene already rotates
    // tokens for elsewhere in this module (`cart.create`'s own token-per-cart convention).
    const { token: newToken, tokenHash: newTokenHash } = generateCartToken()
    survivorCart.tokenHash = newTokenHash

    absorbedCart.status = 'merged'
    absorbedCart.mergedIntoCartId = survivorCart.id
    absorbedCart.resolvedAt = now

    const sourceSnapshot: StoredSourceSnapshot = {
      lines: absorbedLinesForSnapshot.map(toCartLineSnapshot),
      ...(survivorBuyerContextBefore ? { survivorBuyerContextBefore } : {}),
    }

    const mergeLog = em.create(CartMergeLog, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      sourceCartId: absorbedCart.id,
      targetCartId: survivorCart.id,
      strategy,
      sourceSnapshot: sourceSnapshot as unknown,
      outcome,
      mergedByActorType: 'buyer' as CartMergeActorType,
      mergedByActorId: input.routeContext.customerUserId ?? null,
      proposalCartId: null,
    })

    await withAtomicFlush(
      em,
      [
        () => {
          em.persist(mergeLog)
          for (const line of newLines) em.persist(line)
        },
      ],
      { transaction: true, label: 'cart.merge' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    // The SURVIVOR cart's own `cart.cart.updated` + indexing fires from the mandatory
    // re-price dispatch below (it always flushes the cart row inside its own transaction) —
    // emitting it again here would double-fire for every merge. The ABSORBED cart is never
    // touched by that dispatch, so its own side effects fire here, the only place that ever
    // will.
    await emitCrudSideEffects({ dataEngine, action: 'updated', entity: absorbedCart, identifiers: getCartIdentifiers(absorbedCart), events: cartCrudEvents, indexer: cartCrudIndexer })
    for (const line of newLines) {
      await emitCrudSideEffects({ dataEngine, action: 'created', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
      await emitCartEvent('cart.line.added', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
    }
    // Summed/capped lines are not NEW — the subsequent re-price dispatch's own whole-cart
    // pass re-prices and `cart.line.updated`-emits every eligible line, this one included,
    // so no separate emission is needed here for `updatedLineIds`.

    // Step 7.4 — §6a.5/D-R4-23: the operator-facing signal, once per request, counting every
    // `'rejected'` entry THIS merge call produced (zero for `keep_target`/`replace`, which
    // never call `buildMergeOutcome` at all).
    const rejectedCount = outcome.filter((entry) => entry.disposition === 'rejected').length
    if (rejectedCount > 0) {
      await emitVisibilityRejectedEvent(survivorCart, rejectedCount, 'merge')
    }

    await emitCartEvent('cart.cart.merged', {
      sourceCartId: absorbedCart.id,
      targetCartId: survivorCart.id,
      kind: 'basket',
      mergeLogId: mergeLog.id,
      strategy,
      proposalCartId: null,
      customerId: survivorCart.customerId ?? null,
      customerUserId: survivorCart.customerUserId ?? null,
    })
    if (strategy === 'replace') {
      await emitCartEvent('cart.cart.adopted', {
        cartId: survivorCart.id,
        customerId: survivorCart.customerId ?? null,
        customerUserId: survivorCart.customerUserId ?? null,
      })
    }

    // §7.3: mandatory, whole-cart, dispatched for EVERY successful merge outcome (including
    // `keep_target`, where nothing moved) — documented judgment call, task brief question
    // (2). Trigger 2 (buyer identity changes) fires on every login regardless of which §7.1
    // row the merge itself resolved to, since the buyer's own identity just became known
    // either way; re-pricing only the outcomes that moved lines would under-fire exactly
    // the case §7.3 says trigger 2 exists for.
    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const repriceInput: CartRepriceInput = {
      cartId: survivorCart.id,
      tenantId: survivorCart.tenantId,
      organizationId: survivorCart.organizationId,
      trigger: 'merge',
      routeContext: input.routeContext,
    }
    const { result: repriceResult } = await commandBus.execute<CartRepriceInput, CartRepriceResult>(repriceCartCommand.id, {
      input: repriceInput,
      ctx,
    })

    const counts = { merged: 0, summed: 0, capped: 0, declined: 0, rejected: 0 }
    for (const entry of outcome) counts[entry.disposition] += 1
    const publicOutcome: CartMergeOutcomeEntry[] = outcome.map(({ sourceLineId, targetLineId, disposition, reason }) => ({
      sourceLineId,
      targetLineId,
      disposition,
      ...(reason ? { reason } : {}),
    }))

    return {
      cart: repriceResult.cart,
      token: newToken,
      mergeSummary: { strategy, mergeLogId: mergeLog.id, adopted: strategy === 'replace', counts, lines: publicOutcome },
      priceChanges: repriceResult.priceChanges,
      ...(repriceResult.warnings && repriceResult.warnings.length > 0 ? { warnings: repriceResult.warnings } : {}),
    }
  },
  buildLog: async ({ result, input }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.merge', 'Merge cart'),
      resourceKind: 'cart.cart_merge_log',
      resourceId: result.mergeSummary.mergeLogId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: {
        // Lean on purpose: `CartMergeLog` itself (re-read by id below) already carries the
        // full pre-merge snapshot and outcome (§4.4) — duplicating that into the command
        // log's own payload would store the same data twice for no reversibility benefit.
        undo: { mergeLogId: result.mergeSummary.mergeLogId },
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<{ mergeLogId: string }>(logEntry)
    const mergeLogId = payload?.mergeLogId ?? null
    if (!mergeLogId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const mergeLog = await em.findOne(CartMergeLog, { id: mergeLogId })
    if (!mergeLog) return
    if (logEntry?.tenantId && logEntry?.organizationId) {
      ensureSameScope(mergeLog, logEntry.organizationId, logEntry.tenantId)
    }
    // The generic command-undo-log mechanism has no HTTP response to surface a 409 to —
    // mirrors `cart.lines.add`'s own `undo` handler, which silently no-ops rather than
    // throwing when its target data is gone. `cart.mergeUndo` (below) is the path that
    // DOES throw, for the buyer-facing route that can actually show the error.
    if (!isWithinMergeUndoWindow(mergeLog, new Date())) return
    const restored = await restoreCartMerge(em, { tenantId: mergeLog.tenantId, organizationId: mergeLog.organizationId }, mergeLog)
    await emitMergeUndoSideEffects(ctx.container, restored)
    await dispatchPostUndoReprice(ctx, restored.survivorCart, undefined)
  },
}

// ---------------------------------------------------------------------------
// The shared restore function — reached from `cart.merge`'s own generic `undo` above and
// from `cart.mergeUndo` below.
// ---------------------------------------------------------------------------

export const CART_MERGE_UNDO_WINDOW_MINUTES = 15

function isWithinMergeUndoWindow(mergeLog: CartMergeLog, now: Date): boolean {
  const windowMs = CART_MERGE_UNDO_WINDOW_MINUTES * 60_000
  return now.getTime() - mergeLog.createdAt.getTime() <= windowMs
}

type RestoredMerge = {
  survivorCart: Cart
  absorbedCart: Cart
  deletedLineIds: string[]
  restoredLines: CartLine[]
}

/**
 * THE single restore function the PLAN.md row names. Reverses exactly what
 * `mergeCartCommand.execute` did for the given `mergeLog`:
 * - a `'merged'` (union/conflict) outcome entry's target line is soft-deleted (it did not
 *   exist before the merge);
 * - a `'summed'`/`'capped'` entry's target line quantity is restored from the entry's own
 *   `previousTargetQuantity` (§4.4's reversibility extension, see this file's header);
 * - for `strategy: 'replace'` (adoption), the survivor's buyer-identity fields are restored
 *   from `sourceSnapshot.survivorBuyerContextBefore` (see `SurvivorBuyerContextSnapshot`);
 * - the absorbed cart's status is restored to `'active'`, or `'expired'` when its own
 *   `expiresAt` has since passed — mirroring §9's literal "`merged -> active | expired`"
 *   nuance, which the lifecycle table itself scopes to "Proposals only." Documented
 *   judgment call (task brief): read that scoping as under-specified prose rather than an
 *   actual exclusion of the ordinary guest-merge case — §7.2's "`POST /current/undo-merge`
 *   restores the pre-merge state... within 15 minutes" and §3.1a's command-undo table
 *   (listing `cart.merge`/`cart.mergeUndo` as ordinary commands with no proposal caveat)
 *   both describe exactly the case this function implements, with no proposal involved.
 *
 * Does NOT re-rotate the survivor's token: the token the client currently holds (whatever
 * `cart.merge` rotated it to) remains the valid credential for addressing this cart after
 * undo — token rotation is a session-fixation hygiene action, not buyer-visible "state" for
 * undo to reverse (see `mergeCartCommand`'s own rotation comment above). This is also
 * exactly what makes ADOPTION-undo reachable at all: the pre-rotation guest token is never
 * recoverable (only its hash was ever stored, §8.3) — a client undoing an adoption MUST
 * have captured the NEW token from the adoption response and present THAT to resolve
 * "current cart" for the undo call. Narrower than the non-adoption case in exactly that
 * one respect (a client that discarded the new token cannot reach undo at all for an
 * adopted cart), documented here per the task brief rather than silently shipped.
 */
async function restoreCartMerge(em: EntityManager, scope: CartMergeScope, mergeLog: CartMergeLog): Promise<RestoredMerge> {
  const survivorCart = await findOneWithDecryption(
    em,
    Cart,
    { id: mergeLog.targetCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!survivorCart) throw notFound('[internal] merged cart no longer exists')
  const absorbedCart = await findOneWithDecryption(
    em,
    Cart,
    { id: mergeLog.sourceCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!absorbedCart) throw notFound('[internal] absorbed cart no longer exists')

  const outcome = (mergeLog.outcome ?? []) as StoredMergeOutcomeEntry[]
  const touchedLineIds = outcome.map((entry) => entry.targetLineId).filter((id): id is string => !!id)
  const targetLines = touchedLineIds.length
    ? ((await findWithDecryption(em, CartLine, { id: { $in: touchedLineIds }, tenantId: scope.tenantId, organizationId: scope.organizationId }, {}, scope)) as CartLine[])
    : []
  const targetLineById = new Map(targetLines.map((line) => [line.id, line]))
  const snapshot = normalizeSourceSnapshot(mergeLog.sourceSnapshot)

  const deletedLineIds: string[] = []
  const restoredLines: CartLine[] = []
  const now = new Date()

  await withAtomicFlush(
    em,
    [
      () => {
        for (const entry of outcome) {
          if (!entry.targetLineId) continue
          const line = targetLineById.get(entry.targetLineId)
          if (!line) continue
          if (entry.disposition === 'merged') {
            line.deletedAt = now
            deletedLineIds.push(line.id)
          } else if ((entry.disposition === 'summed' || entry.disposition === 'capped') && entry.previousTargetQuantity != null) {
            line.quantity = entry.previousTargetQuantity
            restoredLines.push(line)
          }
        }

        if (mergeLog.strategy === 'replace' && snapshot.survivorBuyerContextBefore) {
          const before = snapshot.survivorBuyerContextBefore
          survivorCart.customerId = before.customerId
          survivorCart.customerIds = before.customerIds
          survivorCart.customerUserId = before.customerUserId
          survivorCart.customerGroupIds = before.customerGroupIds
          survivorCart.priceKindId = before.priceKindId
          survivorCart.buyerDigest = before.buyerDigest
        }

        const absorbedExpired = absorbedCart.expiresAt.getTime() <= now.getTime()
        absorbedCart.status = absorbedExpired ? 'expired' : 'active'
        absorbedCart.mergedIntoCartId = null
        absorbedCart.resolvedAt = absorbedExpired ? now : null
      },
    ],
    { transaction: true, label: 'cart.mergeUndo' },
  )

  return { survivorCart, absorbedCart, deletedLineIds, restoredLines }
}

async function emitMergeUndoSideEffects(
  container: { resolve: <T = unknown>(name: string) => T },
  restored: RestoredMerge,
): Promise<void> {
  const dataEngine = container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({ dataEngine, action: 'updated', entity: restored.absorbedCart, identifiers: getCartIdentifiers(restored.absorbedCart), events: cartCrudEvents, indexer: cartCrudIndexer })
  for (const lineId of restored.deletedLineIds) {
    await emitCartEvent('cart.line.removed', { id: lineId, cartId: restored.survivorCart.id, organizationId: restored.survivorCart.organizationId, tenantId: restored.survivorCart.tenantId })
  }
  for (const line of restored.restoredLines) {
    await emitCrudSideEffects({ dataEngine, action: 'updated', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.updated', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
  }
  // The survivor cart's own `cart.cart.updated` fires from the post-undo re-price dispatch,
  // same "let reprice cover what it always covers anyway" discipline as the merge command.
}

async function dispatchPostUndoReprice(
  ctx: CommandRuntimeContext,
  survivorCart: Cart,
  routeContext: ResolvedCartRouteContext | undefined,
): Promise<CartRepriceResult> {
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  const repriceInput: CartRepriceInput = {
    cartId: survivorCart.id,
    tenantId: survivorCart.tenantId,
    organizationId: survivorCart.organizationId,
    trigger: 'merge',
    routeContext,
  }
  const { result } = await commandBus.execute<CartRepriceInput, CartRepriceResult>(repriceCartCommand.id, { input: repriceInput, ctx })
  return result
}

// ---------------------------------------------------------------------------
// cart.mergeUndo — the buyer-facing entry point, `POST /current/undo-merge`.
// ---------------------------------------------------------------------------

export type CartMergeUndoInput = {
  /** The cart addressed by the CURRENT session token — for the ordinary (non-adoption)
   * case this is the same cart the original merge's target was; for an undone ADOPTION
   * this is the adopted cart, reached via the NEW token the merge response returned (see
   * `restoreCartMerge`'s own doc comment for why that is the only way undo can reach it). */
  cartId: string
  tenantId: string
  organizationId: string
  routeContext?: ResolvedCartRouteContext
}

export type CartMergeUndoResult = {
  cart: CartRepriceResult['cart']
  priceChanges: CartRepriceResult['priceChanges']
  warnings?: CartRepriceResult['warnings']
}

const mergeUndoCommand: CommandHandler<CartMergeUndoInput, CartMergeUndoResult> = {
  id: 'cart.mergeUndo',
  // Undoing an undo is not a modeled feature — no `undo` handler, matching this module's
  // existing precedent for commands §3.1a's own undo table marks "No" (`cart.reprice`, etc).
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartMergeScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await findOneWithDecryption(
      em,
      Cart,
      { id: input.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
      {},
      scope,
    )
    if (!cart) throw notFound('[internal] cart not found')

    const logs = (await findWithDecryption(
      em,
      CartMergeLog,
      { targetCartId: cart.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartMergeLog[]
    if (logs.length === 0) throw notFound('[internal] no merge to undo for this cart')
    const latest = logs.reduce((a, b) => (a.createdAt.getTime() >= b.createdAt.getTime() ? a : b))

    const now = new Date()
    // Unlike the generic `cart.merge.undo` handler (silently no-ops past the window — it
    // has no HTTP response to surface anything to), this public command throws a `409` the
    // route maps straight through: a buyer-initiated action gets a real, visible answer.
    // Carries an explicit `code` (§15a's error-catalogue convention — e.g.
    // `code_reservation_unavailable`) rather than a bare `conflict()` message, so a client
    // can switch on it instead of string-matching `error`.
    if (!isWithinMergeUndoWindow(latest, now)) {
      throw new CrudHttpError(409, { error: '[internal] merge_undo_window_expired', code: 'merge_undo_window_expired' })
    }

    const restored = await restoreCartMerge(em, scope, latest)
    await emitMergeUndoSideEffects(ctx.container, restored)
    const repriceResult = await dispatchPostUndoReprice(ctx, restored.survivorCart, input.routeContext)

    return {
      cart: repriceResult.cart,
      priceChanges: repriceResult.priceChanges,
      ...(repriceResult.warnings && repriceResult.warnings.length > 0 ? { warnings: repriceResult.warnings } : {}),
    }
  },
}

registerCommand(mergeCartCommand)
registerCommand(mergeUndoCommand)

export { mergeCartCommand, mergeUndoCommand }
export type { CartMergeLineDisposition }
