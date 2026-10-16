import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue } from 'awilix'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { ensureSameScope } from '@open-mercato/shared/lib/commands/scope'
import { badRequest, conflict, CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '#generated/entities.ids.generated'

import {
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import {
  buildPriceRowFilter,
  filterRowsForVariant,
  resolvePriceKindId,
  resolvePriceVariantId,
} from '@open-mercato/core/modules/catalog/lib/pricing'
import type { PriceRow, PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing'
import type {
  BuyerPricingContext,
  CatalogBuyerPricingService,
  ResolvedLinePrice,
} from '@open-mercato/core/modules/catalog/services/catalogBuyerPricingService'

// `availability` is NOT in this module's `requires` (index.ts) — it is a soft/optional
// peer, same category as `ecommerce` in `lib/routeContext.ts`. `deriveQuantityRules` is a
// pure, dependency-free leaf function (no DI, no entities, no container) — see its own
// doc comment: "so other modules (e.g. a future `cart` module) can derive the same rules
// without depending on `ecommerce`". Importing it directly carries no runtime coupling to
// `availability`'s module registration. The one genuinely runtime-coupled piece —
// `policyResolutionService`, a DI-registered service — is resolved through a local
// `tryResolvePolicyResolutionService` below, mirroring `routeContext.ts`'s
// `tryResolveStoreContextService` pattern: absent module, absent service, graceful
// fallback to the catalog product's own min/max/increment columns.
import { deriveQuantityRules } from '@open-mercato/core/modules/availability/lib/quantityRules'
import type { QuantityRulePolicy, QuantityRules } from '@open-mercato/core/modules/availability/lib/quantityRules'
import type { PolicyResolutionService } from '@open-mercato/core/modules/availability/lib/policyResolution'

import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { SalesAdjustmentDraft } from '@open-mercato/core/modules/sales/lib/types'

import { Cart, CartLine } from '../data/entities'
import type { CartChannel, CartLineActorType, CartLineOrigin } from '../data/entities'
import {
  cartVisibilityKey,
  evaluateCartVisibility,
  isVisible,
} from '../lib/visibility'
import type { CartVisibilityLineRef, ResolvedAssortmentScope } from '../lib/visibility'
import { shouldEnforceAssortmentScope } from '../lib/routeContext'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { buildRecomputeCartTotalsPhase } from '../lib/reprice'
import type { CartPriceChange } from '../lib/reprice'
import { buildPromotionsEffectsPhase } from '../lib/promotionContext'
import type { CartPromotionWarning } from '../lib/promotionContext'
import { assertCartNotLocked } from '../lib/lockGuard'
import { emitCartEvent } from '../events'
// Type-only — erased at compile time, so this carries none of the runtime circularity risk
// a VALUE import would: `commands/cart.ts` already imports `emitVisibilityRejectedEvent`
// from THIS file (Step 7.4), so a value-level import back from here would create a
// module-load cycle. See `dispatchCartRepriceForUndo` below for how the undo handlers call
// `cart.reprice` without importing its handler object.
import type { CartRepriceInput, CartRepriceResult } from './cart'

// Step 4.6 — `cart.lines.add`, `.update`, `.remove`, `.bulkAdd`. Builds directly on Step
// 4.4's `evaluateCartVisibility` (§6a) and Step 4.5's `cart.create`/`cart.get` + the
// storefront/trusted route-context split. See the module-level comments on each command
// below for the ordering and rejection-vs-throw decisions this step had to make.

const CART_LINE_ENTITY_ID = E.cart.cart_line
const cartLineCrudIndexer: CrudIndexerConfig<CartLine> = { entityType: CART_LINE_ENTITY_ID }

// Step 8.2 (QA F12) — this file's own `Cart`-entity indexer/events config, deliberately
// duplicated from `commands/cart.ts`'s identical `cartCrudIndexer`/`cartCrudEvents` rather
// than imported from there: `cart.ts` already imports `emitVisibilityRejectedEvent` from
// THIS file (Step 7.4), so importing a VALUE back from `cart.ts` here would create a
// module-load cycle. `lib/reprice.ts`'s own header comment sets the precedent for this exact
// trade-off ("Deliberately duplicates `commands/lines.ts`'s small per-line pricing helpers
// ... rather than exporting and importing lines.ts's private functions").
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

const MAX_BULK_ADD_ENTRIES = 100
// Multiples of an increment are compared as floating-point numbers; this tolerance
// absorbs IEEE-754 noise (e.g. 0.1 + 0.2) without masking a genuinely non-aligned quantity.
const QUANTITY_EPSILON = 1e-6

type CartLineScope = { tenantId: string; organizationId: string }

function getCartLineIdentifiers(line: CartLine) {
  return { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId }
}

// ---------------------------------------------------------------------------
// Shared: `cart.line.visibility_rejected` (§11, D-R4-23, TC-CART-R1-10)
// ---------------------------------------------------------------------------

/**
 * §6a.1c's per-line enforcement points (`'lines.add'`/`'lines.update'`/`'lines.bulkAdd'`,
 * this file's own) plus the two whole-cart/merge passes added at Step 7.4:
 * `'reprice'` — §6a.2's whole-cart re-visibility pass, trigger 2 (`commands/cart.ts`'s
 * `cart.reprice`); `'merge'` — §6a.5's merge-time pass (`commands/merge.ts`'s `cart.merge`).
 * Trigger 5 (checkout lock, `commands/lock.ts`'s `cart.lock`) gets NO dedicated value of its
 * own (Step 7.5): `cart.lock` dispatches `cart.reprice` with `trigger: 'lock'`, which runs
 * the SAME §6a.2 whole-cart re-visibility pass as trigger 2/merge and reports through this
 * SAME `'reprice'` value — a lock-triggered rejection is indistinguishable, at this event's
 * granularity, from any other re-price-triggered one.
 */
export type CartVisibilityRejectionTrigger = 'lines.add' | 'lines.update' | 'lines.bulkAdd' | 'reprice' | 'merge'

/**
 * Emitted once per REQUEST with the count of lines this call rejected for a VISIBILITY
 * reason specifically — never once per rejected line, and never for a rejection the request
 * incurred for an unrelated reason (quantity rule, unpriceable product, a missing
 * product/variant row). §6a.3's no-enumeration-oracle collapse applies to the BUYER-facing
 * `product_unavailable` warning only; this event is the operator-facing signal D-R4-23 names,
 * so it is free to be precise about which rejections were actually a scope mismatch.
 *
 * Exported since Step 7.4 — `commands/cart.ts`'s §6a.2 pass and `commands/merge.ts`'s §6a.5
 * pass both emit through this SAME helper rather than each re-deriving the event shape.
 */
export async function emitVisibilityRejectedEvent(
  cart: Pick<Cart, 'id' | 'tenantId' | 'organizationId'>,
  rejectedCount: number,
  triggeredBy: CartVisibilityRejectionTrigger,
): Promise<void> {
  if (rejectedCount <= 0) return
  await emitCartEvent('cart.line.visibility_rejected', {
    cartId: cart.id,
    organizationId: cart.organizationId,
    tenantId: cart.tenantId,
    rejectedCount,
    triggeredBy,
  })
}

// ---------------------------------------------------------------------------
// Shared: quantity-rule validation (§5.5)
// ---------------------------------------------------------------------------

export type CartLineRejectionReason =
  | 'quantity_below_minimum'
  | 'quantity_invalid_increment'
  | 'product_unavailable'
  | 'product_not_priceable'

export type CartLineWarning = 'quantity_capped'

export type QuantityRuleCheck =
  | { status: 'accepted'; quantity: number }
  | { status: 'accepted_clamped'; quantity: number; requestedQuantity: number }
  | { status: 'rejected'; reason: 'quantity_below_minimum' | 'quantity_invalid_increment'; nearestValid: number }

/**
 * §5.5's three rules, in the order that keeps `nearestValid` meaningful on its own:
 *
 * 1. Increment alignment is checked against base 0 (a plain "multiple of N"), never
 *    against `minOrderQuantity` as the base. Anchoring to `minOrderQuantity` instead would
 *    make the two constraints interact badly whenever `minOrderQuantity` is itself not a
 *    multiple of the increment (e.g. min=7, increment=5): summing two independently valid
 *    quantities (merge-by-quantity, §4.2) would then routinely fail re-validation, since
 *    sums of base-`min` aligned values are not themselves base-`min` aligned in general.
 *    Sums of base-0 aligned values always stay base-0 aligned (basic algebra), which is
 *    exactly the property the merge-sum re-check below depends on.
 * 2. Below `minOrderQuantity` is rejected outright, with `nearestValid` bumped up to the
 *    smallest increment-aligned value at or above the minimum.
 * 3. Above `maxOrderQuantity` is capped with a warning, never rejected.
 *
 * This ordering means a quantity that is both below-minimum and non-aligned reports
 * `quantity_invalid_increment` (its `nearestValid` already accounts for the minimum too,
 * via the same bump), not `quantity_below_minimum`. Documented here since §5.5's prose
 * states the three rules independently and does not resolve this overlap itself.
 */
export function checkQuantityRule(rules: QuantityRules, requestedQuantity: number): QuantityRuleCheck {
  const { minOrderQuantity, maxOrderQuantity, quantityIncrement } = rules
  const hasIncrement = quantityIncrement != null && quantityIncrement > 0

  const bumpToMinimum = (value: number): number => {
    if (minOrderQuantity == null || value >= minOrderQuantity) return value
    return hasIncrement ? Math.ceil(minOrderQuantity / quantityIncrement) * quantityIncrement : minOrderQuantity
  }

  if (hasIncrement) {
    const roundedSteps = Math.round(requestedQuantity / quantityIncrement)
    let aligned = roundedSteps * quantityIncrement
    if (aligned <= 0) aligned = quantityIncrement
    if (Math.abs(aligned - requestedQuantity) > QUANTITY_EPSILON) {
      return { status: 'rejected', reason: 'quantity_invalid_increment', nearestValid: bumpToMinimum(aligned) }
    }
  }

  if (minOrderQuantity != null && requestedQuantity < minOrderQuantity) {
    return { status: 'rejected', reason: 'quantity_below_minimum', nearestValid: bumpToMinimum(minOrderQuantity) }
  }

  if (maxOrderQuantity != null && requestedQuantity > maxOrderQuantity) {
    return { status: 'accepted_clamped', quantity: maxOrderQuantity, requestedQuantity }
  }

  return { status: 'accepted', quantity: requestedQuantity }
}

function tryResolvePolicyResolutionService(container: { resolve: <T = unknown>(name: string) => T }): PolicyResolutionService | null {
  try {
    return container.resolve<PolicyResolutionService>('policyResolutionService') ?? null
  } catch {
    return null
  }
}

async function resolveQuantityRulesForProduct(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scope: CartLineScope,
  storeId: string | null,
  product: CatalogProduct,
  variantId: string | null,
): Promise<QuantityRules> {
  const resolver = tryResolvePolicyResolutionService(container)
  let policy: QuantityRulePolicy = null
  if (resolver) {
    policy = await resolver.resolve(em, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      storeId,
      productId: product.id,
      variantId,
    })
  }
  return deriveQuantityRules(policy, product)
}

// ---------------------------------------------------------------------------
// Shared: pricing a line
// ---------------------------------------------------------------------------

function buildCartPricingRowFilterContext(cart: Cart): PricingContext {
  return {
    channelId: cart.salesChannelId ?? null,
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? [],
    customerGroupIds: cart.customerGroupIds,
    currencyCode: cart.currencyCode,
    priceKindId: cart.priceKindId ?? null,
    quantity: 1,
    date: new Date(),
  }
}

function buildBuyerPricingContext(cart: Cart, quantity: number, date: Date): BuyerPricingContext {
  return {
    channelId: cart.salesChannelId ?? null,
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? [],
    customerGroupIds: cart.customerGroupIds,
    currencyCode: cart.currencyCode,
    priceKindId: cart.priceKindId ?? null,
    quantity,
    date,
  }
}

/**
 * Matches `ecommerce/lib/storefrontPricing.ts`'s `fetchPageRows` row-fetch shape (the
 * precedent the task points at): one `CatalogProductPrice` query narrowed by
 * `buildPriceRowFilter`, scoped to the requested product ids (plus any variant ids as an
 * `$or`), never one query per product.
 */
async function fetchPriceRowsBatch(
  em: EntityManager,
  scope: CartLineScope,
  pricingContext: PricingContext,
  productIds: string[],
  variantIds: string[],
): Promise<PriceRow[]> {
  if (!productIds.length) return []
  const targetClause = variantIds.length
    ? { $or: [{ product: { $in: productIds } }, { variant: { $in: variantIds } }] }
    : { product: { $in: productIds } }
  const where = {
    $and: [buildPriceRowFilter(pricingContext), targetClause],
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }
  const rows = await findWithDecryption(em, CatalogProductPrice, where as never, { populate: ['priceKind', 'offer'] }, scope)
  return rows as unknown as PriceRow[]
}

function groupRowsByProduct(rows: PriceRow[], variantToProduct: Map<string, string>): Map<string, PriceRow[]> {
  const grouped = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const variantId = resolvePriceVariantId(row)
    const productId = variantId ? variantToProduct.get(variantId) ?? null : (typeof row.product === 'string' ? row.product : row.product?.id ?? null)
    if (!productId) continue
    const bucket = grouped.get(productId) ?? []
    bucket.push(row)
    grouped.set(productId, bucket)
  }
  return grouped
}

async function resolveLinePricing(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  cart: Cart,
  rows: PriceRow[],
  quantity: number,
  date: Date,
): Promise<ResolvedLinePrice> {
  const buyerPricingService = container.resolve<CatalogBuyerPricingService>('catalogBuyerPricingService')
  const context = buildBuyerPricingContext(cart, quantity, date)
  return buyerPricingService.resolveLinePrice(em, rows, context, {
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
  })
}

function applyPriceSnapshot(line: CartLine, resolved: ResolvedLinePrice, pricedAt: Date): void {
  line.unitPriceNet = resolved.amountNet !== null ? String(resolved.amountNet) : null
  line.unitPriceGross = resolved.amountGross !== null ? String(resolved.amountGross) : null
  line.taxRate = resolved.taxRatePercent !== null ? String(resolved.taxRatePercent) : null
  line.priceKindId = resolved.priceRow ? resolvePriceKindId(resolved.priceRow) : null
  line.priceRowId = resolved.priceRow?.id ?? null
  line.priceTierMinQuantity = resolved.currentTier?.minQuantity ?? null
  line.pricedAt = pricedAt
}

/**
 * §5.2 trigger 1 is scoped to "crosses a `min_quantity`/`max_quantity` tier boundary" —
 * i.e. the bounds of the single `CatalogProductPrice` row that is currently winning
 * (`line.priceRowId`), not a re-derivation of the whole tier ladder. A single row-by-id
 * lookup (cheap, no row-set fetch, no `catalogBuyerPricingService` call) is enough to
 * answer "did we leave that row's own window" — this is the check `.update` uses to decide
 * whether a re-price is even necessary, so a same-tier quantity change never calls the
 * pricing service at all.
 */
async function isWithinStoredPriceTier(
  em: EntityManager,
  scope: CartLineScope,
  line: CartLine,
  quantity: number,
): Promise<boolean> {
  if (!line.priceRowId) return false
  const row = await findOneWithDecryption(
    em,
    CatalogProductPrice,
    { id: line.priceRowId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  if (!row) return false
  const min = row.minQuantity ?? 1
  if (quantity < min) return false
  if (row.maxQuantity != null && quantity > row.maxQuantity) return false
  return true
}

/**
 * `CartLine.lineTotals` is "Verbatim `SalesLineCalculationResult`" (§4.2) — `sales/AGENTS.md`
 * is explicit that document math MUST go through `salesCalculationService`, never inlined.
 * `calculateLine` is the single-line entry point (no whole-document context required), so a
 * line's own totals snapshot is computed the same way `sales` would compute it for a real
 * document, with the tax/discount arithmetic owned entirely by `sales`.
 */
async function computeLineTotals(
  container: { resolve: <T = unknown>(name: string) => T },
  cart: Cart,
  params: {
    productId: string
    variantId: string | null
    name: string
    quantity: number
    unitPriceNet: number | null
    unitPriceGross: number | null
    taxRate: number | null
    configuration: Record<string, unknown> | null
  },
): Promise<Record<string, unknown>> {
  const salesCalculationService = container.resolve<SalesCalculationService>('salesCalculationService')
  const result = await salesCalculationService.calculateLine({
    documentKind: 'quote',
    line: {
      kind: 'product',
      productId: params.productId,
      productVariantId: params.variantId,
      name: params.name,
      quantity: params.quantity,
      currencyCode: cart.currencyCode,
      unitPriceNet: params.unitPriceNet,
      unitPriceGross: params.unitPriceGross,
      taxRate: params.taxRate,
      configuration: params.configuration,
    },
    context: { tenantId: cart.tenantId, organizationId: cart.organizationId, currencyCode: cart.currencyCode },
  })
  return result as unknown as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Shared: visibility
// ---------------------------------------------------------------------------

type CartLineAuthInput =
  | { routeContext: ResolvedCartRouteContext; tenantId?: undefined; organizationId?: undefined; assortmentScope?: undefined }
  | { routeContext?: undefined; tenantId: string; organizationId: string; assortmentScope?: ResolvedAssortmentScope }

function resolveLineAuthScopeIds(input: CartLineAuthInput): {
  tenantId: string
  organizationId: string
  rawScope: ResolvedAssortmentScope | undefined
} {
  if (input.routeContext) {
    return {
      tenantId: input.routeContext.tenantId,
      organizationId: input.routeContext.organizationId,
      rawScope: input.routeContext.assortmentScope,
    }
  }
  return { tenantId: input.tenantId, organizationId: input.organizationId, rawScope: input.assortmentScope }
}

/** §6a.1b — enforce iff the cart channel is `storefront` or a scope was resolved for this call. */
function resolveEnforcedScope(cart: Cart, rawScope: ResolvedAssortmentScope | undefined): ResolvedAssortmentScope | undefined {
  return shouldEnforceAssortmentScope(cart.channel, rawScope) ? rawScope : undefined
}

/**
 * Defense in depth for §6a.1a: every storefront-channel cart must have been created
 * through the route edge, which always resolves and supplies a `routeContext`. A trusted
 * in-process caller that forgets to resolve one for a `storefront` cart is a programming
 * error, not a buyer-facing condition — it throws rather than silently exempting the call.
 */
function assertStorefrontHasRouteContext(cart: Cart, input: CartLineAuthInput): void {
  if (cart.channel === 'storefront' && !input.routeContext) {
    throw badRequest('[internal] A storefront-channel cart requires a resolved routeContext for its visibility check')
  }
}

async function checkSingleLineVisibility(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  tenantScope: CartLineScope,
  line: CartVisibilityLineRef,
  assortmentScope: ResolvedAssortmentScope | undefined,
): Promise<boolean> {
  const result = await evaluateCartVisibility({ lines: [line], scope: assortmentScope, tenantScope, em, container })
  return isVisible(result.get(cartVisibilityKey(line)) ?? 'unavailable')
}

// ---------------------------------------------------------------------------
// Shared: actor attribution (§4.2)
// ---------------------------------------------------------------------------

type ResolvedLineActor = { addedByActorType: CartLineActorType; addedByActorId: string | null }

/**
 * Storefront calls derive the actor from the resolved `routeContext` — a buyer, identified
 * (`customerUserId`) or guest (`null`), never anything a request body could spoof. Trusted
 * (non-storefront) calls carry no resolved buyer identity at all (§6a.4), so the caller must
 * supply `addedByActorType`/`addedByActorId` explicitly, the same way `cart.create`'s trusted
 * path supplies its own `customerId` rather than inheriting one from a resolved context.
 */
function resolveLineActor(
  input: CartLineAuthInput,
  explicit: { addedByActorType?: CartLineActorType; addedByActorId?: string | null } | undefined,
): ResolvedLineActor {
  if (input.routeContext) {
    return { addedByActorType: 'buyer', addedByActorId: input.routeContext.customerUserId ?? null }
  }
  if (!explicit?.addedByActorType) {
    throw badRequest('[internal] addedByActorType is required for a trusted (non-storefront) cart.lines call')
  }
  return { addedByActorType: explicit.addedByActorType, addedByActorId: explicit.addedByActorId ?? null }
}

// ---------------------------------------------------------------------------
// Shared: cart/line loading, snapshotting, merge-by-quantity lookup
// ---------------------------------------------------------------------------

/**
 * Uniform not-found, mirroring `cart.get`'s own no-oracle convention (Step 4.5): a wrong
 * tenant/org and a nonexistent id both collapse to the identical message, so a mutation
 * attempt never discloses which of those is actually true — that part of the no-oracle
 * collapse protects something real (whether a cart with this id/token even exists for this
 * tenant) and stays a 404.
 *
 * Step 7.5 — ONE exception to that collapse, applied unconditionally regardless of
 * `requireActive`: a `locked` cart gets the distinguishable `423 cart_locked`
 * (`assertCartNotLocked`, `lib/lockGuard.ts`) BEFORE falling through to the generic
 * `requireActive` check below. §9's own text states the mutation-while-locked rejection as a
 * blanket rule with no stated carve-out for any particular caller, which is why this runs
 * for EVERY caller of this function, including `cart.lines.remove`'s own `requireActive:
 * false` call — see that command's own comment for the documented judgment call this makes
 * (locked specifically is now always enforced; every OTHER non-active status stays exempt
 * for `.remove`, as it already was before this step).
 *
 * Step 8.5 (QA F15) — `requireActive`'s own branch is no longer part of the no-oracle
 * collapse: it now throws a distinguishable `409 cart_not_active` (carrying the cart's real
 * `status`) instead of folding into the generic 404. `GET /current` already discloses a
 * non-active cart's `status` with a `200` (`cartService.resolveBasketByToken` / §8.3 do not
 * gate on `status` at all), so collapsing a WRITE's "exists, right tenant, wrong status" into
 * the SAME 404 as "does not exist"/"wrong tenant" no longer hides anything a client could not
 * already learn from the read side — it only contradicted `cart.mdx`'s documented `409`
 * contract for a non-active-cart write. The owner ruled explicitly: fix the code to match the
 * docs, not the other way around. "Exists, wrong tenant" vs "exists, right tenant, not
 * active" remain genuinely different concerns (identity-hiding vs. state-disclosure), so only
 * the latter is relaxed here.
 */
async function loadMutableCart(
  em: EntityManager,
  scope: CartLineScope,
  cartId: string,
  options: { requireActive: boolean },
): Promise<Cart> {
  const cart = await findOneWithDecryption(
    em,
    Cart,
    { id: cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!cart) throw notFound('[internal] cart not found')
  assertCartNotLocked(cart)
  if (options.requireActive && cart.status !== 'active') {
    throw new CrudHttpError(409, { error: '[internal] cart_not_active', code: 'cart_not_active', status: cart.status })
  }
  return cart
}

export type CartLineSnapshot = {
  id: string
  cartId: string
  tenantId: string
  organizationId: string
  lineNumber: number
  productId: string
  variantId: string | null
  sku: string | null
  name: string
  optionValues: Record<string, string> | null
  quantity: string
  quantityUnit: string | null
  unitPriceNet: string | null
  unitPriceGross: string | null
  taxRate: string | null
  priceKindId: string | null
  priceRowId: string | null
  priceTierMinQuantity: number | null
  pricedAt: Date
  lineTotals: Record<string, unknown>
  discountTotalNet: string | null
  promotionId: string | null
  origin: CartLineOrigin
  configuration: Record<string, unknown> | null
  addedByActorType: CartLineActorType
  addedByActorId: string | null
  metadata: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}

// Exported (Step 5.2) so `lib/cartView.ts`'s §10.1 `CartView` envelope builder can map a
// freshly re-fetched `CartLine` the same way every command in this file already does,
// instead of duplicating this 20-field mapping a third time. `lib/currentCartRoute.ts`
// already imports command handlers/types directly from this module (see its own header
// comment) — a plain pure-function export carries no additional coupling risk.
export function toCartLineSnapshot(line: CartLine): CartLineSnapshot {
  return {
    id: line.id,
    cartId: line.cartId,
    tenantId: line.tenantId,
    organizationId: line.organizationId,
    lineNumber: line.lineNumber,
    productId: line.productId,
    variantId: line.variantId ?? null,
    sku: line.sku ?? null,
    name: line.name,
    optionValues: line.optionValues ?? null,
    quantity: line.quantity,
    quantityUnit: line.quantityUnit ?? null,
    unitPriceNet: line.unitPriceNet ?? null,
    unitPriceGross: line.unitPriceGross ?? null,
    taxRate: line.taxRate ?? null,
    priceKindId: line.priceKindId ?? null,
    priceRowId: line.priceRowId ?? null,
    priceTierMinQuantity: line.priceTierMinQuantity ?? null,
    pricedAt: line.pricedAt,
    lineTotals: line.lineTotals,
    discountTotalNet: line.discountTotalNet ?? null,
    promotionId: line.promotionId ?? null,
    origin: line.origin,
    configuration: line.configuration ?? null,
    addedByActorType: line.addedByActorType,
    addedByActorId: line.addedByActorId ?? null,
    metadata: line.metadata ?? null,
    createdAt: line.createdAt,
    updatedAt: line.updatedAt,
    deletedAt: line.deletedAt ?? null,
  }
}

function toQuantityNumber(value: number | string): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) throw badRequest('[internal] quantity must be a finite number')
  return numeric
}

/**
 * Deep-equality on `configuration`, canonicalizing key order first. Avoids re-deriving
 * Postgres's `md5(jsonb::text)` stored-generated-column algorithm in JS (jsonb normalizes
 * key order on storage, so two differently-ordered-but-equal objects hash identically there
 * — replicating that exactly is fragile); matching on the plain columns plus a canonical
 * deep-equality check is semantically equivalent for the purpose of finding a merge target,
 * and the DB's own `UNIQUE NULLS NOT DISTINCT` index (§4.2) is the authoritative backstop.
 */
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

function configurationsEqual(a: Record<string, unknown> | null | undefined, b: Record<string, unknown> | null | undefined): boolean {
  const left = a ?? null
  const right = b ?? null
  if (left === null && right === null) return true
  if (left === null || right === null) return false
  return canonicalJson(left) === canonicalJson(right)
}

/** `(cart_id, product_id, variant_id, configuration_hash, promotion_id)` merge-by-quantity lookup, scoped to `origin: 'customer'` lines (`promotion_id IS NULL`) — the only origin this step ever writes. */
async function findExistingCustomerLine(
  em: EntityManager,
  scope: CartLineScope,
  cartId: string,
  productId: string,
  variantId: string | null,
  configuration: Record<string, unknown> | null,
): Promise<CartLine | null> {
  const candidates = await findWithDecryption(
    em,
    CartLine,
    { cartId, productId, variantId: variantId ?? null, promotionId: null, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  return (candidates as CartLine[]).find((line) => configurationsEqual(line.configuration ?? null, configuration)) ?? null
}

async function computeStartingLineNumber(em: EntityManager, scope: CartLineScope, cartId: string): Promise<number> {
  const existing = await em.find(CartLine, { cartId, tenantId: scope.tenantId, organizationId: scope.organizationId })
  return existing.reduce((max, line) => Math.max(max, line.lineNumber), 0) + 1
}

type NewLineFields = {
  productId: string
  variantId: string | null
  sku: string | null
  name: string
  optionValues: Record<string, string> | null
  configuration: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
}

function resolveSnapshotFields(product: CatalogProduct, variant: CatalogProductVariant | null, configuration: Record<string, unknown> | null, metadata: Record<string, unknown> | null): NewLineFields {
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    sku: variant?.sku ?? product.sku ?? null,
    name: product.title,
    optionValues: variant?.optionValues ?? null,
    configuration: configuration ?? null,
    metadata: metadata ?? null,
  }
}

// ---------------------------------------------------------------------------
// Shared: whole-cart promotions + totals recompute (Step 8.2, QA F12)
// ---------------------------------------------------------------------------

/**
 * Spec `cart-module.md:119`'s write flow for every command — load, re-price, run through
 * `promotionsService`, `calculateDocumentTotals`, persist totals, all inside the same
 * transaction — applied to this file's own line-mutation commands, which until this step
 * only ever touched the one line they were mutating and left `Cart.totals`/every OTHER
 * line's `discountTotalNet` stale (QA finding F12: a 2-unit "5% off 2+ items" cart showed
 * zeroed totals after add, a stale discount after a quantity cut below the threshold, and a
 * non-zero grand total after deleting the last line).
 *
 * Reuses `cart.reprice`'s OWN phase builders (`lib/promotionContext.ts`'s
 * `buildPromotionsEffectsPhase`, `lib/reprice.ts`'s `buildRecomputeCartTotalsPhase`) rather
 * than a parallel re-implementation — this function's only job is wiring them into THIS
 * caller's own `withAtomicFlush` phase array, mirroring `commands/cart.ts`'s
 * `repriceCartCommand.execute` almost verbatim for just these two phases (catalog
 * unit-price re-resolution — `buildCartLineRepricePhases` — and the §6a.2 whole-cart
 * re-visibility pass are deliberately NOT included: out of this step's scope per the task
 * brief, and already covered by this file's own per-line checks/pricing).
 *
 * Registers `auth` on the container SYNCHRONOUSLY, before returning any phase — same
 * ordering `cart.reprice` uses, since `promotionsService.evaluate()` resolves its tenant/org
 * scope from that DI token and fails closed (400) without it.
 *
 * The returned phases close over a freshly-populated `lines` array via a leading fetch
 * phase rather than a value the caller fetches up front: every caller here mutates a
 * scalar (create/update/soft-delete a line) BEFORE these phases run, so re-reading the
 * cart's full line set must itself be a phase in the SAME `withAtomicFlush` sequence
 * (`packages/core/AGENTS.md`'s "Entity Update Safety" rule) — never a plain query the caller
 * runs ahead of `withAtomicFlush` entirely. The array is mutated in place by the leading
 * fetch phase (`lines.push(...)`) rather than reassigned, so the SAME reference threads
 * through every later phase exactly like `buildPromotionsEffectsPhase`'s own in-place gift
 * line push/splice already depends on.
 */
function buildCartPromotionsAndTotalsPhases(params: {
  em: EntityManager
  container: CommandRuntimeContext['container']
  cart: Cart
  scope: CartLineScope
  assortmentScope: ResolvedAssortmentScope | undefined
  now: Date
  createdGiftLines: CartLine[]
  removedGiftLines: CartLine[]
  promotionWarnings: CartPromotionWarning[]
}): Array<() => Promise<void>> {
  const { em, container, cart, scope, assortmentScope, now, createdGiftLines, removedGiftLines, promotionWarnings } = params
  container.register({ auth: asValue({ tenantId: cart.tenantId, orgId: cart.organizationId }) })

  const lines: CartLine[] = []
  const adjustments: SalesAdjustmentDraft[] = []
  const changes: CartPriceChange[] = []

  const fetchLinesPhase = async () => {
    const fetched = (await findWithDecryption(
      em,
      CartLine,
      { cartId: cart.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartLine[]
    lines.push(...fetched)
  }

  const promotionsPhase = buildPromotionsEffectsPhase({
    em,
    container,
    cart,
    lines,
    assortmentScope,
    tenantScope: scope,
    now,
    adjustments,
    warnings: promotionWarnings,
    createdGiftLines,
    removedGiftLines,
  })

  const totalsPhase = buildRecomputeCartTotalsPhase(container, cart, lines, now, changes, adjustments)

  return [fetchLinesPhase, promotionsPhase, totalsPhase]
}

/**
 * The cart-level side effects every line-mutation command now owes once it also mutates
 * `Cart.totals`/`totalsComputedAt` — mirrors `cart.reprice`'s own post-commit emission for
 * the SAME three things (the cart's own `updated` CRUD side effect, a created gift line's
 * `created` side effect + `cart.line.added`, a removed gift line's `deleted` side effect +
 * `cart.line.removed`), scoped to just what `buildCartPromotionsAndTotalsPhases` can
 * possibly have produced. Called AFTER the caller's own `withAtomicFlush` commits, same
 * "side effects only after the DB write lands" rule as every other emission in this file.
 */
async function emitCartPromotionsAndTotalsSideEffects(
  dataEngine: DataEngine,
  cart: Cart,
  outcome: { createdGiftLines: CartLine[]; removedGiftLines: CartLine[]; promotionWarnings: CartPromotionWarning[] },
): Promise<void> {
  await emitCrudSideEffects({
    dataEngine,
    action: 'updated',
    entity: cart,
    identifiers: { id: cart.id, organizationId: cart.organizationId, tenantId: cart.tenantId },
    events: cartCrudEvents,
    indexer: cartCrudIndexer,
  })
  for (const line of outcome.createdGiftLines) {
    await emitCrudSideEffects({ dataEngine, action: 'created', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.added', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
  }
  for (const line of outcome.removedGiftLines) {
    await emitCrudSideEffects({ dataEngine, action: 'deleted', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.removed', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
  }
  for (const warning of outcome.promotionWarnings) {
    if (warning.code !== 'promotion_no_longer_valid') continue
    await emitCartEvent('cart.promotion.no_longer_valid', {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      promotionId: warning.promotionId,
    })
  }
}

/**
 * The undo-side half of QA F12's fix (task brief point 7): `cart.lines.add`/`.remove`/
 * `.bulkAdd` restore their reversed line(s) in their own `undo()` handler, but reversing a
 * line is not the inverse of `Cart.totals` — only a full `cart.reprice` recomputes the
 * whole-cart aggregate, so this dispatches that command as a follow-up, the same pattern
 * `commands/promotions.ts`'s own `dispatchReprice` helper already establishes for
 * `cart.promotions.apply`/`.remove`.
 *
 * Calls the command bus with the LITERAL id string `'cart.reprice'` rather than importing
 * `repriceCartCommand` from `./cart` — a value-level import back from here would create a
 * module-load cycle (`cart.ts` already imports from this file). `CartRepriceInput`/
 * `CartRepriceResult` stay `import type`-only above for the identical reason.
 *
 * Trigger reason `'undo'` (`lib/reprice.ts`'s `CartPriceChangeReason`): none of the existing
 * values describe "a command's own undo handler is restoring a reversed line mutation" —
 * `'merge'`/`'lock'`/`'promotion_applied'`/`'promotion_removed'` are each already owned by a
 * different caller for a different reason, so reusing one of them would mislabel the
 * `priceChanges`/`cart.price.changed` disclosure this reprice may still produce. An undo has
 * no `ResolvedCartRouteContext` of its own to forward (unlike `cart.get`'s trigger dispatch
 * or `cart.promotions.apply`/`.remove`'s), so this never enforces assortment scope on a gift
 * line a reprice happens to create here — the same `undefined`-scope behavior every other
 * `routeContext`-less caller in this module already has.
 */
async function dispatchCartRepriceForUndo(
  ctx: CommandRuntimeContext,
  cart: { id: string; tenantId: string; organizationId: string },
): Promise<void> {
  const commandBus = ctx.container.resolve('commandBus') as CommandBus
  await commandBus.execute<CartRepriceInput, CartRepriceResult>('cart.reprice', {
    input: { cartId: cart.id, tenantId: cart.tenantId, organizationId: cart.organizationId, trigger: 'undo' },
    ctx,
  })
}

// ---------------------------------------------------------------------------
// cart.lines.add
// ---------------------------------------------------------------------------

export type CartLinesAddInput = CartLineAuthInput & {
  cartId: string
  productId: string
  variantId?: string | null
  quantity: number | string
  configuration?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
  addedByActorType?: CartLineActorType
  addedByActorId?: string | null
}

export type CartLinesAddOutcome =
  | { status: 'added'; line: CartLineSnapshot; before: null; warnings: CartLineWarning[] }
  | { status: 'merged'; line: CartLineSnapshot; before: CartLineSnapshot; warnings: CartLineWarning[] }
  | { status: 'rejected'; reason: CartLineRejectionReason; nearestValid?: number }

type CartLineAddUndoPayload = { before: CartLineSnapshot | null; after: CartLineSnapshot }

const addLineCommand: CommandHandler<CartLinesAddInput, CartLinesAddOutcome> = {
  id: 'cart.lines.add',
  // §3.1a's undo table: reverses a buyer-visible content change.
  isUndoable: true,
  async execute(input, ctx): Promise<CartLinesAddOutcome> {
    const { tenantId, organizationId, rawScope } = resolveLineAuthScopeIds(input)
    const scope: CartLineScope = { tenantId, organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId, { requireActive: true })
    assertStorefrontHasRouteContext(cart, input)
    const assortmentScope = resolveEnforcedScope(cart, rawScope)

    const requestedQuantity = toQuantityNumber(input.quantity)
    if (!(requestedQuantity > 0)) throw badRequest('[internal] quantity must be greater than zero')

    const variantId = input.variantId ?? null

    const product = await findOneWithDecryption(em, CatalogProduct, { id: input.productId, tenantId, organizationId, deletedAt: null }, {}, scope)
    if (!product) return { status: 'rejected', reason: 'product_unavailable' }

    let variant: CatalogProductVariant | null = null
    if (variantId) {
      variant = await findOneWithDecryption(em, CatalogProductVariant, { id: variantId, product: input.productId, tenantId, organizationId, deletedAt: null }, {}, scope)
      if (!variant) return { status: 'rejected', reason: 'product_unavailable' }
    }

    const rules = await resolveQuantityRulesForProduct(em, ctx.container, scope, cart.storeId ?? null, product, variantId)
    const check = checkQuantityRule(rules, requestedQuantity)
    if (check.status === 'rejected') return { status: 'rejected', reason: check.reason, nearestValid: check.nearestValid }
    const warnings: CartLineWarning[] = check.status === 'accepted_clamped' ? ['quantity_capped'] : []
    const acceptedQuantity = check.quantity

    const visible = await checkSingleLineVisibility(em, ctx.container, scope, { productId: input.productId, variantId }, assortmentScope)
    if (!visible) {
      await emitVisibilityRejectedEvent(cart, 1, 'lines.add')
      return { status: 'rejected', reason: 'product_unavailable' }
    }

    const actor = resolveLineActor(input, { addedByActorType: input.addedByActorType, addedByActorId: input.addedByActorId })
    const now = new Date()

    let outcome: CartLinesAddOutcome | null = null
    let changedLine: CartLine | null = null
    let changedAction: 'created' | 'updated' | null = null

    // Step 8.2 (QA F12) — populated only when the mutation phase below actually accepted
    // the line (`shouldRecompute` gates every phase that follows on this).
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    const promotionWarnings: CartPromotionWarning[] = []
    const shouldRecompute = () => !!outcome && outcome.status !== 'rejected'

    // The merge-by-quantity decision below (`findExistingCustomerLine`) and its write are a
    // read-decide-write sequence on a row that may not exist yet, so a row-level lock can't
    // protect it. A per-cart Postgres advisory lock — held for the whole transaction, the
    // same primitive `attachments`/`notifications`/`sso` already use — serializes every
    // `cart.lines.add`/`.bulkAdd` call against this cart instead, closing the race
    // `TC-CART-CONC-05` reproduced (a silently lost update, and a raw 500 off
    // `cart_lines_unique_line_key`).
    await withAtomicFlush(em, [
      async () => {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [`cart:lines:${cart.id}`])
      },
      async () => {
        const existing = await findExistingCustomerLine(em, scope, cart.id, input.productId, variantId, input.configuration ?? null)
        const pricingContext = buildCartPricingRowFilterContext(cart)
        const variantIds = variantId ? [variantId] : []
        const rows = filterRowsForVariant(await fetchPriceRowsBatch(em, scope, pricingContext, [input.productId], variantIds), variantId)

        if (existing) {
          const before = toCartLineSnapshot(existing)
          const summedQuantity = Number(existing.quantity) + acceptedQuantity
          const sumCheck = checkQuantityRule(rules, summedQuantity)
          if (sumCheck.status === 'rejected') {
            outcome = { status: 'rejected', reason: sumCheck.reason, nearestValid: sumCheck.nearestValid }
            return
          }
          if (sumCheck.status === 'accepted_clamped') warnings.push('quantity_capped')

          const resolved = await resolveLinePricing(em, ctx.container, cart, rows, sumCheck.quantity, now)
          if (!resolved.priceRow) {
            outcome = { status: 'rejected', reason: 'product_not_priceable' }
            return
          }

          existing.quantity = String(sumCheck.quantity)
          applyPriceSnapshot(existing, resolved, now)
          existing.lineTotals = await computeLineTotals(ctx.container, cart, {
            productId: existing.productId,
            variantId: existing.variantId ?? null,
            name: existing.name,
            quantity: sumCheck.quantity,
            unitPriceNet: resolved.amountNet,
            unitPriceGross: resolved.amountGross,
            taxRate: resolved.taxRatePercent,
            configuration: existing.configuration ?? null,
          })

          changedLine = existing
          changedAction = 'updated'
          outcome = { status: 'merged', line: toCartLineSnapshot(existing), before, warnings }
          return
        }

        const resolved = await resolveLinePricing(em, ctx.container, cart, rows, acceptedQuantity, now)
        if (!resolved.priceRow) {
          outcome = { status: 'rejected', reason: 'product_not_priceable' }
          return
        }

        const lineNumber = await computeStartingLineNumber(em, scope, cart.id)
        const fields = resolveSnapshotFields(product, variant, input.configuration ?? null, input.metadata ?? null)

        const newLine = em.create(CartLine, {
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          cartId: cart.id,
          lineNumber,
          productId: fields.productId,
          variantId: fields.variantId,
          sku: fields.sku,
          name: fields.name,
          optionValues: fields.optionValues,
          quantity: String(acceptedQuantity),
          origin: 'customer' as const,
          promotionId: null,
          discountTotalNet: null,
          flagState: null,
          configuration: fields.configuration,
          addedByActorType: actor.addedByActorType,
          addedByActorId: actor.addedByActorId,
          metadata: fields.metadata,
          // Placeholders — both overwritten immediately below (`pricedAt`/`lineTotals` carry
          // no MikroORM default, so `em.create`'s required-data type needs a concrete value).
          pricedAt: now,
          lineTotals: {},
        })
        applyPriceSnapshot(newLine, resolved, now)
        newLine.lineTotals = await computeLineTotals(ctx.container, cart, {
          productId: fields.productId,
          variantId: fields.variantId,
          name: fields.name,
          quantity: acceptedQuantity,
          unitPriceNet: resolved.amountNet,
          unitPriceGross: resolved.amountGross,
          taxRate: resolved.taxRatePercent,
          configuration: fields.configuration,
        })
        em.persist(newLine)

        changedLine = newLine
        changedAction = 'created'
        outcome = { status: 'added', line: toCartLineSnapshot(newLine), before: null, warnings }
      },
      // Step 8.2 (QA F12) — whole-cart promotions re-evaluation + totals recompute, gated
      // on the mutation phase above actually accepting the line (never on a rejection).
      ...buildCartPromotionsAndTotalsPhases({
        em,
        container: ctx.container,
        cart,
        scope,
        assortmentScope,
        now,
        createdGiftLines,
        removedGiftLines,
        promotionWarnings,
      }).map((phase) => async () => {
        if (!shouldRecompute()) return
        await phase()
      }),
    ], { transaction: true, label: 'cart.lines.add' })

    if (!outcome) throw new Error('[internal] cart.lines.add produced no outcome')
    // Captured into plain `const`s (never reassigned themselves) rather than read directly
    // off `outcome`/`changedLine`/`changedAction` from here on: those are `let`s reassigned
    // inside the `withAtomicFlush` phase closures above, which (correctly, for cases this
    // step does not control) makes TS stop narrowing them past the `await` — `never`
    // target-types below absorb that at zero runtime cost.
    const finalOutcome = outcome as CartLinesAddOutcome

    if (changedLine && changedAction) {
      const mutatedLine = changedLine as CartLine
      const action = changedAction as 'created' | 'updated'
      // Re-snapshot AFTER the promotions phase ran — it may have further updated
      // `discountTotalNet` on this exact line if a promotion targets it.
      const resultOutcome: CartLinesAddOutcome =
        finalOutcome.status === 'rejected' ? finalOutcome : { ...finalOutcome, line: toCartLineSnapshot(mutatedLine) }
      const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
      await emitCrudSideEffects({ dataEngine, action, entity: mutatedLine, identifiers: getCartLineIdentifiers(mutatedLine), indexer: cartLineCrudIndexer })
      await emitCartEvent(action === 'created' ? 'cart.line.added' : 'cart.line.updated', {
        id: mutatedLine.id,
        cartId: mutatedLine.cartId,
        organizationId: mutatedLine.organizationId,
        tenantId: mutatedLine.tenantId,
      })
      await emitCartPromotionsAndTotalsSideEffects(dataEngine, cart, { createdGiftLines, removedGiftLines, promotionWarnings })
      return resultOutcome
    }

    return finalOutcome
  },
  buildLog: async ({ result }) => {
    if (result.status === 'rejected') return null
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.lines.add', 'Add cart line'),
      resourceKind: 'cart.cart_line',
      resourceId: result.line.id,
      tenantId: result.line.tenantId,
      organizationId: result.line.organizationId,
      snapshotAfter: result.line,
      payload: {
        undo: {
          before: result.before,
          after: result.line,
        } satisfies CartLineAddUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CartLineAddUndoPayload>(logEntry, { dateFields: ['pricedAt', 'createdAt', 'updatedAt', 'deletedAt'] })
    const lineId = logEntry?.resourceId ?? payload?.after?.id ?? null
    if (!lineId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CartLine, { id: lineId })
    if (!line) return
    if (logEntry?.tenantId && logEntry?.organizationId) {
      ensureSameScope(line, logEntry.organizationId, logEntry.tenantId)
    }

    if (payload?.before) {
      restoreLineFromSnapshot(line, payload.before)
    } else {
      line.deletedAt = new Date()
    }
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({ dataEngine, action: payload?.before ? 'updated' : 'deleted', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })

    // Step 8.2 (QA F12) — reversing this line is not the inverse of `Cart.totals`; only a
    // full `cart.reprice` (trigger `'undo'`) recomputes the whole-cart aggregate correctly.
    await dispatchCartRepriceForUndo(ctx, { id: line.cartId, tenantId: line.tenantId, organizationId: line.organizationId })
  },
}

function restoreLineFromSnapshot(line: CartLine, snapshot: CartLineSnapshot): void {
  line.quantity = snapshot.quantity
  line.unitPriceNet = snapshot.unitPriceNet
  line.unitPriceGross = snapshot.unitPriceGross
  line.taxRate = snapshot.taxRate
  line.priceKindId = snapshot.priceKindId
  line.priceRowId = snapshot.priceRowId
  line.priceTierMinQuantity = snapshot.priceTierMinQuantity
  line.pricedAt = snapshot.pricedAt
  line.lineTotals = snapshot.lineTotals
  line.discountTotalNet = snapshot.discountTotalNet
  line.deletedAt = snapshot.deletedAt
}

// ---------------------------------------------------------------------------
// cart.lines.update
// ---------------------------------------------------------------------------

export type CartLinesUpdateInput = CartLineAuthInput & {
  cartId: string
  lineId: string
  quantity: number | string
}

export type CartLinesUpdateOutcome =
  | { status: 'updated'; line: CartLineSnapshot; warnings: CartLineWarning[]; priceChanges: CartPriceChange[] }
  | { status: 'rejected'; reason: CartLineRejectionReason; nearestValid?: number }

const updateLineCommand: CommandHandler<CartLinesUpdateInput, CartLinesUpdateOutcome> = {
  id: 'cart.lines.update',
  // §3.1a's undo table: quantity changes re-price; the "undo" a buyer wants is setting the
  // quantity back themselves, not a system rollback to a now-stale price snapshot. No
  // `undo` handler, matching `cart.reprice`'s documented non-undoable treatment.
  isUndoable: false,
  async execute(input, ctx) {
    const { tenantId, organizationId, rawScope } = resolveLineAuthScopeIds(input)
    const scope: CartLineScope = { tenantId, organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId, { requireActive: true })
    assertStorefrontHasRouteContext(cart, input)
    const assortmentScope = resolveEnforcedScope(cart, rawScope)

    const line = await findOneWithDecryption(em, CartLine, { id: input.lineId, cartId: cart.id, tenantId, organizationId, deletedAt: null }, {}, scope)
    if (!line) throw notFound('[internal] cart line not found')

    // §4.2: "A promotion line is buyer-immutable (`cart.lines.update`/`.remove` on it
    // return `409 promotion_line_immutable`)".
    if (line.origin === 'promotion') throw conflict('[internal] promotion_line_immutable')

    const requestedQuantity = toQuantityNumber(input.quantity)
    if (!(requestedQuantity > 0)) throw badRequest('[internal] quantity must be greater than zero')

    const product = await findOneWithDecryption(em, CatalogProduct, { id: line.productId, tenantId, organizationId, deletedAt: null }, {}, scope)
    if (!product) return { status: 'rejected', reason: 'product_unavailable' }

    const rules = await resolveQuantityRulesForProduct(em, ctx.container, scope, cart.storeId ?? null, product, line.variantId ?? null)
    const check = checkQuantityRule(rules, requestedQuantity)
    if (check.status === 'rejected') return { status: 'rejected', reason: check.reason, nearestValid: check.nearestValid }
    const warnings: CartLineWarning[] = check.status === 'accepted_clamped' ? ['quantity_capped'] : []
    const finalQuantity = check.quantity

    const visible = await checkSingleLineVisibility(em, ctx.container, scope, { productId: line.productId, variantId: line.variantId ?? null }, assortmentScope)
    if (!visible) {
      await emitVisibilityRejectedEvent(cart, 1, 'lines.update')
      return { status: 'rejected', reason: 'product_unavailable' }
    }

    const now = new Date()
    const sameTier = await isWithinStoredPriceTier(em, scope, line, finalQuantity)
    // §5.2 trigger 1 + §5.1's `priceChanges` disclosure (Step 5.1): populated only when the
    // tier-crossing re-price below actually moved the unit price, never for a same-tier
    // quantity change. `Cart.lastPriceChangeAt` (§5.3: "the cart records last_price_change_at")
    // is set on `cart` — already loaded on this same `em` by `loadMutableCart` — so the single
    // `em.flush()` below persists both the line's new snapshot and the cart's own timestamp.
    const priceChanges: CartPriceChange[] = []
    if (!sameTier) {
      const pricingContext = buildCartPricingRowFilterContext(cart)
      const variantIds = line.variantId ? [line.variantId] : []
      const rows = filterRowsForVariant(await fetchPriceRowsBatch(em, scope, pricingContext, [line.productId], variantIds), line.variantId ?? null)
      const resolved = await resolveLinePricing(em, ctx.container, cart, rows, finalQuantity, now)
      if (!resolved.priceRow) return { status: 'rejected', reason: 'product_not_priceable' }
      const oldUnitPriceNet = line.unitPriceNet ?? null
      const oldUnitPriceGross = line.unitPriceGross ?? null
      applyPriceSnapshot(line, resolved, now)
      line.lineTotals = await computeLineTotals(ctx.container, cart, {
        productId: line.productId,
        variantId: line.variantId ?? null,
        name: line.name,
        quantity: finalQuantity,
        unitPriceNet: resolved.amountNet,
        unitPriceGross: resolved.amountGross,
        taxRate: resolved.taxRatePercent,
        configuration: line.configuration ?? null,
      })
      const newUnitPriceNet = line.unitPriceNet ?? null
      const newUnitPriceGross = line.unitPriceGross ?? null
      if (oldUnitPriceNet !== newUnitPriceNet || oldUnitPriceGross !== newUnitPriceGross) {
        priceChanges.push({
          lineId: line.id,
          productId: line.productId,
          oldUnitPriceNet,
          newUnitPriceNet,
          oldUnitPriceGross,
          newUnitPriceGross,
          reason: 'tier_change',
        })
        cart.lastPriceChangeAt = now
      }
    }
    // Step 8.2 (QA F12) — this command previously closed with a single bare `em.flush()`
    // here. Adding the whole-cart promotions/totals recompute means a QUERY (the fresh
    // full-line fetch `buildCartPromotionsAndTotalsPhases` needs) now runs after this
    // scalar mutation on the SAME `em` — `packages/core/AGENTS.md`'s "Entity Update Safety"
    // rule requires `withAtomicFlush` for that, so this is no longer a plain flush. Every
    // validation/rejection check above (quantity rule, visibility, not-priceable) still
    // runs BEFORE this point and returns directly, matching `cart.lines.add`'s own
    // validate-first-then-atomic-mutate structure.
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    const promotionWarnings: CartPromotionWarning[] = []

    await withAtomicFlush(em, [
      async () => {
        line.quantity = String(finalQuantity)
      },
      ...buildCartPromotionsAndTotalsPhases({
        em,
        container: ctx.container,
        cart,
        scope,
        assortmentScope,
        now,
        createdGiftLines,
        removedGiftLines,
        promotionWarnings,
      }),
    ], { transaction: true, label: 'cart.lines.update' })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({ dataEngine, action: 'updated', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.updated', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
    if (priceChanges.length > 0) {
      await emitCartEvent('cart.price.changed', {
        cartId: cart.id,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        changes: priceChanges,
      })
    }
    await emitCartPromotionsAndTotalsSideEffects(dataEngine, cart, { createdGiftLines, removedGiftLines, promotionWarnings })

    // Re-snapshot AFTER the promotions phase ran — it may have set/cleared this line's own
    // `discountTotalNet` this same cycle.
    return { status: 'updated', line: toCartLineSnapshot(line), warnings, priceChanges }
  },
}

// ---------------------------------------------------------------------------
// cart.lines.remove
// ---------------------------------------------------------------------------

export type CartLinesRemoveInput = CartLineAuthInput & {
  cartId: string
  lineId: string
}

export type CartLinesRemoveResult = { removed: true; line: CartLineSnapshot }

type CartLineRemoveUndoPayload = { before: CartLineSnapshot; after: CartLineSnapshot }

const removeLineCommand: CommandHandler<CartLinesRemoveInput, CartLinesRemoveResult> = {
  id: 'cart.lines.remove',
  // §3.1a's undo table: reverses a buyer-visible content change.
  isUndoable: true,
  async execute(input, ctx) {
    const { tenantId, organizationId, rawScope } = resolveLineAuthScopeIds(input)
    const scope: CartLineScope = { tenantId, organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    // "Never blocked" (Step 4.6's PLAN.md row) is read here as: never blocked by a
    // `flag_state` or cart-`status` concern — mirroring §6a.2's own contrast, "a flagged
    // line CAN be removed, unlike a promotion line which cannot" — not as a blanket
    // override of the promotion-line-immutability rule below, which §4.2 states applies to
    // `.remove` by the identical wording it uses for `.update`. `requireActive: false`
    // keeps `.remove` permissive for every non-active status EXCEPT `locked` — converted/
    // merged/expired/abandoned carts all stay reachable here exactly as before this step.
    //
    // Step 7.5 — documented judgment call: `.remove` NOW also respects a LOCK specifically,
    // via `loadMutableCart`'s own unconditional `assertCartNotLocked` call (immune to this
    // `requireActive: false`). §9 states the mutation-while-locked rejection as a blanket
    // rule ("A locked cart that a client tries to mutate returns 423 Locked... not a generic
    // error") with no stated exception for removal, which is a stronger signal than reading
    // the OLD "no cart-status gate exists here at all... [lock] not built yet in this step"
    // comment (now stale, and replaced by this one) as an intentional safety valve letting a
    // buyer clear a flagged/locked cart's lines no matter what. A buyer mid-checkout losing
    // a line out from under the order checkout is actively assembling is a worse outcome
    // than the narrower, more buyer-friendly reading would have avoided — so `.remove` is
    // now uniform with `.add`/`.update`/`.bulkAdd` on locked-ness specifically, while staying
    // deliberately more permissive than them on every OTHER non-active status.
    const cart = await loadMutableCart(em, scope, input.cartId, { requireActive: false })
    const assortmentScope = resolveEnforcedScope(cart, rawScope)

    const line = await findOneWithDecryption(em, CartLine, { id: input.lineId, cartId: cart.id, tenantId, organizationId, deletedAt: null }, {}, scope)
    if (!line) throw notFound('[internal] cart line not found')

    if (line.origin === 'promotion') throw conflict('[internal] promotion_line_immutable')

    const before = toCartLineSnapshot(line)
    const now = new Date()

    // Step 8.2 (QA F12) — same reasoning as `cart.lines.update`'s own comment: a QUERY (the
    // fresh full-line fetch the whole-cart recompute needs) now runs after this scalar
    // mutation on the SAME `em`, so the former bare `em.flush()` becomes `withAtomicFlush`.
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    const promotionWarnings: CartPromotionWarning[] = []

    await withAtomicFlush(em, [
      async () => {
        line.deletedAt = now
      },
      ...buildCartPromotionsAndTotalsPhases({
        em,
        container: ctx.container,
        cart,
        scope,
        assortmentScope,
        now,
        createdGiftLines,
        removedGiftLines,
        promotionWarnings,
      }),
    ], { transaction: true, label: 'cart.lines.remove' })

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({ dataEngine, action: 'deleted', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.removed', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
    await emitCartPromotionsAndTotalsSideEffects(dataEngine, cart, { createdGiftLines, removedGiftLines, promotionWarnings })

    return { removed: true, line: toCartLineSnapshot(line) }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    const before = { ...result.line, deletedAt: null }
    return {
      actionLabel: translate('cart.audit.lines.remove', 'Remove cart line'),
      resourceKind: 'cart.cart_line',
      resourceId: result.line.id,
      tenantId: result.line.tenantId,
      organizationId: result.line.organizationId,
      snapshotBefore: before,
      snapshotAfter: result.line,
      payload: {
        undo: { before, after: result.line } satisfies CartLineRemoveUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CartLineRemoveUndoPayload>(logEntry, { dateFields: ['pricedAt', 'createdAt', 'updatedAt', 'deletedAt'] })
    const lineId = logEntry?.resourceId ?? payload?.before?.id ?? null
    if (!lineId) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const line = await em.findOne(CartLine, { id: lineId })
    if (!line) return
    if (logEntry?.tenantId && logEntry?.organizationId) {
      ensureSameScope(line, logEntry.organizationId, logEntry.tenantId)
    }
    line.deletedAt = null
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({ dataEngine, action: 'updated', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
    await emitCartEvent('cart.line.added', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })

    // Step 8.2 (QA F12) — restoring this line is not the inverse of `Cart.totals`; only a
    // full `cart.reprice` (trigger `'undo'`) recomputes the whole-cart aggregate correctly.
    await dispatchCartRepriceForUndo(ctx, { id: line.cartId, tenantId: line.tenantId, organizationId: line.organizationId })
  },
}

// ---------------------------------------------------------------------------
// cart.lines.bulkAdd
// ---------------------------------------------------------------------------

export type CartLinesBulkAddEntry = {
  productId: string
  variantId?: string | null
  quantity: number | string
  configuration?: Record<string, unknown> | null
  metadata?: Record<string, unknown> | null
}

export type CartLinesBulkAddInput = CartLineAuthInput & {
  cartId: string
  lines: CartLinesBulkAddEntry[]
  addedByActorType?: CartLineActorType
  addedByActorId?: string | null
}

export type CartLinesBulkAddEntryOutcome =
  | { index: number; status: 'added'; line: CartLineSnapshot; before: null; warnings: CartLineWarning[] }
  | { index: number; status: 'merged'; line: CartLineSnapshot; before: CartLineSnapshot; warnings: CartLineWarning[] }
  | { index: number; status: 'rejected'; reason: CartLineRejectionReason; nearestValid?: number }

export type CartLinesBulkAddResult = {
  results: CartLinesBulkAddEntryOutcome[]
  addedCount: number
  rejectedCount: number
}

type CartLineBulkAddUndoPayload = { entries: Array<{ before: CartLineSnapshot | null; after: CartLineSnapshot }> }

const bulkAddLinesCommand: CommandHandler<CartLinesBulkAddInput, CartLinesBulkAddResult> = {
  id: 'cart.lines.bulkAdd',
  // §3.1a's undo table: reverses a buyer-visible content change.
  isUndoable: true,
  async execute(input, ctx) {
    if (input.lines.length > MAX_BULK_ADD_ENTRIES) {
      throw badRequest(`[internal] cart.lines.bulkAdd accepts at most ${MAX_BULK_ADD_ENTRIES} entries`)
    }

    const { tenantId, organizationId, rawScope } = resolveLineAuthScopeIds(input)
    const scope: CartLineScope = { tenantId, organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadMutableCart(em, scope, input.cartId, { requireActive: true })
    assertStorefrontHasRouteContext(cart, input)
    const assortmentScope = resolveEnforcedScope(cart, rawScope)
    const actor = resolveLineActor(input, { addedByActorType: input.addedByActorType, addedByActorId: input.addedByActorId })

    if (input.lines.length === 0) return { results: [], addedCount: 0, rejectedCount: 0 }

    // ---- batched reads (§6a.1c: "never one-at-a-time") — nothing mutated yet ----
    const visibilityRefs: CartVisibilityLineRef[] = input.lines.map((entry) => ({ productId: entry.productId, variantId: entry.variantId ?? null }))
    const visibility = await evaluateCartVisibility({ lines: visibilityRefs, scope: assortmentScope, tenantScope: scope, em, container: ctx.container })

    const productIds = Array.from(new Set(input.lines.map((entry) => entry.productId)))
    const products = await findWithDecryption(em, CatalogProduct, { id: { $in: productIds }, tenantId, organizationId, deletedAt: null }, {}, scope)
    const productsById = new Map((products as CatalogProduct[]).map((product) => [product.id, product]))

    const variantIds = Array.from(new Set(input.lines.map((entry) => entry.variantId).filter((id): id is string => !!id)))
    const variants = variantIds.length
      ? await findWithDecryption(em, CatalogProductVariant, { id: { $in: variantIds }, tenantId, organizationId, deletedAt: null }, {}, scope)
      : []
    const variantsById = new Map((variants as CatalogProductVariant[]).map((variant) => [variant.id, variant]))

    const existingLines = await findWithDecryption(
      em,
      CartLine,
      { cartId: cart.id, productId: { $in: productIds }, promotionId: null, deletedAt: null, tenantId, organizationId },
      {},
      scope,
    )
    const lineByKey = new Map<string, CartLine>()
    for (const existingLine of existingLines as CartLine[]) {
      lineByKey.set(buildMergeKey(existingLine.productId, existingLine.variantId ?? null, existingLine.configuration ?? null), existingLine)
    }

    const pricingContext = buildCartPricingRowFilterContext(cart)
    const priceRows = await fetchPriceRowsBatch(em, scope, pricingContext, productIds, variantIds)
    // `CatalogProductVariant.product` resolves to an unpopulated Reference proxy here (no
    // `populate` was requested), so the product id a variant belongs to is read off the
    // REQUEST entries instead of that lazy relation.
    const variantToProduct = new Map<string, string>()
    for (const entry of input.lines) {
      if (entry.variantId) variantToProduct.set(entry.variantId, entry.productId)
    }
    const rowsByProduct = groupRowsByProduct(priceRows, variantToProduct)

    const policyResolver = tryResolvePolicyResolutionService(ctx.container)
    const policies = policyResolver
      ? await policyResolver.resolveMany(
          em,
          input.lines.map((entry) => ({ tenantId, organizationId, storeId: cart.storeId ?? null, productId: entry.productId, variantId: entry.variantId ?? null })),
        )
      : input.lines.map(() => null)

    let nextLineNumber = await computeStartingLineNumber(em, scope, cart.id)

    const outcomes: CartLinesBulkAddEntryOutcome[] = new Array(input.lines.length)
    const changedLines: CartLine[] = []
    const changedActions: Array<'created' | 'updated'> = []
    // TC-CART-R1-10: counts ONLY entries this call rejected for a visibility reason, never a
    // quantity-rule/not-priceable/missing-product rejection — see `emitVisibilityRejectedEvent`.
    // Phases run sequentially (SPEC-018, the comment above), so a shared closure counter is safe.
    let visibilityRejectedCount = 0

    // ---- per-entry decide + mutate, one `withAtomicFlush` phase per entry so an
    // earlier entry's mutation is flushed before a later entry's (in-memory-only) reads
    // run — SPEC-018's rule, even though every read here is served from the maps above
    // rather than a fresh DB query.
    const phases = input.lines.map((entry, index) => async () => {
      const variantId = entry.variantId ?? null
      let requestedQuantity: number
      try {
        requestedQuantity = toQuantityNumber(entry.quantity)
      } catch {
        outcomes[index] = { index, status: 'rejected', reason: 'product_unavailable' }
        return
      }
      if (!(requestedQuantity > 0)) {
        outcomes[index] = { index, status: 'rejected', reason: 'product_unavailable' }
        return
      }

      const product = productsById.get(entry.productId) ?? null
      if (!product) {
        outcomes[index] = { index, status: 'rejected', reason: 'product_unavailable' }
        return
      }
      const variant = variantId ? variantsById.get(variantId) ?? null : null
      if (variantId && !variant) {
        outcomes[index] = { index, status: 'rejected', reason: 'product_unavailable' }
        return
      }

      const rules = deriveQuantityRules(policies[index] ?? null, product)
      const check = checkQuantityRule(rules, requestedQuantity)
      if (check.status === 'rejected') {
        outcomes[index] = { index, status: 'rejected', reason: check.reason, nearestValid: check.nearestValid }
        return
      }
      const warnings: CartLineWarning[] = check.status === 'accepted_clamped' ? ['quantity_capped'] : []
      const acceptedQuantity = check.quantity

      const visible = isVisible(visibility.get(cartVisibilityKey({ productId: entry.productId, variantId })) ?? 'unavailable')
      if (!visible) {
        outcomes[index] = { index, status: 'rejected', reason: 'product_unavailable' }
        visibilityRejectedCount += 1
        return
      }

      const now = new Date()
      const key = buildMergeKey(entry.productId, variantId, entry.configuration ?? null)
      const existingLine = lineByKey.get(key) ?? null
      const rows = filterRowsForVariant(rowsByProduct.get(entry.productId) ?? [], variantId)

      if (existingLine) {
        const before = toCartLineSnapshot(existingLine)
        const summedQuantity = Number(existingLine.quantity) + acceptedQuantity
        const sumCheck = checkQuantityRule(rules, summedQuantity)
        if (sumCheck.status === 'rejected') {
          outcomes[index] = { index, status: 'rejected', reason: sumCheck.reason, nearestValid: sumCheck.nearestValid }
          return
        }
        if (sumCheck.status === 'accepted_clamped') warnings.push('quantity_capped')

        const resolved = await resolveLinePricing(em, ctx.container, cart, rows, sumCheck.quantity, now)
        if (!resolved.priceRow) {
          outcomes[index] = { index, status: 'rejected', reason: 'product_not_priceable' }
          return
        }
        existingLine.quantity = String(sumCheck.quantity)
        applyPriceSnapshot(existingLine, resolved, now)
        existingLine.lineTotals = await computeLineTotals(ctx.container, cart, {
          productId: existingLine.productId,
          variantId: existingLine.variantId ?? null,
          name: existingLine.name,
          quantity: sumCheck.quantity,
          unitPriceNet: resolved.amountNet,
          unitPriceGross: resolved.amountGross,
          taxRate: resolved.taxRatePercent,
          configuration: existingLine.configuration ?? null,
        })
        lineByKey.set(key, existingLine)
        const after = toCartLineSnapshot(existingLine)
        outcomes[index] = { index, status: 'merged', line: after, before, warnings }
        changedLines.push(existingLine)
        changedActions.push('updated')
        return
      }

      const resolved = await resolveLinePricing(em, ctx.container, cart, rows, acceptedQuantity, now)
      if (!resolved.priceRow) {
        outcomes[index] = { index, status: 'rejected', reason: 'product_not_priceable' }
        return
      }
      const fields = resolveSnapshotFields(product, variant, entry.configuration ?? null, entry.metadata ?? null)
      const newLine = em.create(CartLine, {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        cartId: cart.id,
        lineNumber: nextLineNumber++,
        productId: fields.productId,
        variantId: fields.variantId,
        sku: fields.sku,
        name: fields.name,
        optionValues: fields.optionValues,
        quantity: String(acceptedQuantity),
        origin: 'customer' as const,
        promotionId: null,
        discountTotalNet: null,
        flagState: null,
        configuration: fields.configuration,
        addedByActorType: actor.addedByActorType,
        addedByActorId: actor.addedByActorId,
        metadata: fields.metadata,
        pricedAt: now,
        lineTotals: {},
      })
      applyPriceSnapshot(newLine, resolved, now)
      newLine.lineTotals = await computeLineTotals(ctx.container, cart, {
        productId: fields.productId,
        variantId: fields.variantId,
        name: fields.name,
        quantity: acceptedQuantity,
        unitPriceNet: resolved.amountNet,
        unitPriceGross: resolved.amountGross,
        taxRate: resolved.taxRatePercent,
        configuration: fields.configuration,
      })
      em.persist(newLine)
      lineByKey.set(key, newLine)
      const after = toCartLineSnapshot(newLine)
      outcomes[index] = { index, status: 'added', line: after, before: null, warnings }
      changedLines.push(newLine)
      changedActions.push('created')
    })

    // Step 8.2 (QA F12) — whole-cart promotions re-evaluation + totals recompute, appended
    // after every entry's own mutation phase, mirroring `cart.reprice`'s own ordering (line
    // mutations first, promotions phase, totals phase last).
    const now = new Date()
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    const promotionWarnings: CartPromotionWarning[] = []

    // Same per-cart advisory lock as `cart.lines.add` (above) — `lineByKey`'s merge-by-quantity
    // decision is read-decide-write against rows that may not exist yet, so two concurrent
    // `bulkAdd`/`add` calls on this cart must serialize, not just this call's own entries
    // against each other.
    await withAtomicFlush(em, [
      async () => {
        await em.execute('select pg_advisory_xact_lock(hashtextextended(?::text, 0))', [`cart:lines:${cart.id}`])
      },
      ...phases,
      ...buildCartPromotionsAndTotalsPhases({
        em,
        container: ctx.container,
        cart,
        scope,
        assortmentScope,
        now,
        createdGiftLines,
        removedGiftLines,
        promotionWarnings,
      }),
    ], { transaction: true, label: 'cart.lines.bulkAdd' })
    await emitVisibilityRejectedEvent(cart, visibilityRejectedCount, 'lines.bulkAdd')

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    for (let i = 0; i < changedLines.length; i += 1) {
      const changedLine = changedLines[i]
      const action = changedActions[i]
      await emitCrudSideEffects({ dataEngine, action, entity: changedLine, identifiers: getCartLineIdentifiers(changedLine), indexer: cartLineCrudIndexer })
      await emitCartEvent(action === 'created' ? 'cart.line.added' : 'cart.line.updated', {
        id: changedLine.id,
        cartId: changedLine.cartId,
        organizationId: changedLine.organizationId,
        tenantId: changedLine.tenantId,
      })
    }
    await emitCartPromotionsAndTotalsSideEffects(dataEngine, cart, { createdGiftLines, removedGiftLines, promotionWarnings })

    // Re-snapshot every added/merged outcome AFTER the promotions phase ran — it may have
    // further updated `discountTotalNet` on any of these lines.
    const changedLineById = new Map(changedLines.map((line) => [line.id, line]))
    for (let i = 0; i < outcomes.length; i += 1) {
      const outcome = outcomes[i]
      if (outcome.status !== 'added' && outcome.status !== 'merged') continue
      const changedLine = changedLineById.get(outcome.line.id)
      if (changedLine) outcomes[i] = { ...outcome, line: toCartLineSnapshot(changedLine) }
    }

    const addedCount = outcomes.filter((outcome) => outcome.status === 'added' || outcome.status === 'merged').length
    return { results: outcomes, addedCount, rejectedCount: outcomes.length - addedCount }
  },
  buildLog: async ({ result }) => {
    const entries = result.results
      .filter((outcome): outcome is Extract<CartLinesBulkAddEntryOutcome, { status: 'added' | 'merged' }> => outcome.status === 'added' || outcome.status === 'merged')
      .map((outcome) => ({ before: outcome.before, after: outcome.line }))
    if (!entries.length) return null
    const { translate } = await resolveTranslations()
    const first = entries[0].after
    return {
      actionLabel: translate('cart.audit.lines.bulkAdd', 'Add cart lines (bulk)'),
      resourceKind: 'cart.cart_line',
      resourceId: first.cartId,
      tenantId: first.tenantId,
      organizationId: first.organizationId,
      payload: {
        undo: {
          entries,
        } satisfies CartLineBulkAddUndoPayload,
      },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<CartLineBulkAddUndoPayload>(logEntry, { dateFields: ['pricedAt', 'createdAt', 'updatedAt', 'deletedAt'] })
    if (!payload?.entries?.length) return
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    let cartRef: { id: string; tenantId: string; organizationId: string } | null = null
    for (const entry of payload.entries) {
      const line = await em.findOne(CartLine, { id: entry.after.id })
      if (!line) continue
      ensureSameScope(line, entry.after.organizationId, entry.after.tenantId)
      if (entry.before) {
        restoreLineFromSnapshot(line, entry.before)
      } else {
        line.deletedAt = new Date()
      }
      await em.flush()
      await emitCrudSideEffects({ dataEngine, action: entry.before ? 'updated' : 'deleted', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
      cartRef = { id: line.cartId, tenantId: line.tenantId, organizationId: line.organizationId }
    }

    // Step 8.2 (QA F12) — same reasoning as `cart.lines.add`/`.remove`'s own undo: restoring
    // these lines is not the inverse of `Cart.totals`; one `cart.reprice` dispatch after the
    // whole batch is restored recomputes the whole-cart aggregate correctly.
    if (cartRef) await dispatchCartRepriceForUndo(ctx, cartRef)
  },
}

function buildMergeKey(productId: string, variantId: string | null, configuration: Record<string, unknown> | null): string {
  return `${productId}:${variantId ?? ''}:${canonicalJson(configuration ?? null)}`
}

registerCommand(addLineCommand)
registerCommand(updateLineCommand)
registerCommand(removeLineCommand)
registerCommand(bulkAddLinesCommand)

export { addLineCommand, updateLineCommand, removeLineCommand, bulkAddLinesCommand }
