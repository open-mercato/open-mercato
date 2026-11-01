import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { TranslateWithFallbackFn } from '@open-mercato/shared/lib/i18n/translate'
import { availabilityItemKey, resolveAvailability } from '@open-mercato/shared/lib/availability'
import type {
  AvailabilityItemResult,
  AvailabilityModuleConfigReader,
  AvailabilityState,
} from '@open-mercato/shared/lib/availability'
import { formatCurrency } from '@open-mercato/ui/utils/format'
import { CatalogProductPrice } from '@open-mercato/core/modules/catalog/data/entities'
import { buildPriceRowFilter, resolvePriceVariantId } from '@open-mercato/core/modules/catalog/lib/pricing'
import type { PriceRow, PricingContext } from '@open-mercato/core/modules/catalog/lib/pricing'
import type {
  BuyerPricingContext,
  CatalogBuyerPricingService,
  LinePriceTier,
  ResolvedLinePrice,
} from '@open-mercato/core/modules/catalog/services/catalogBuyerPricingService'
import type { SalesDocumentAmounts } from '@open-mercato/core/modules/sales/lib/types'
import { Promotion } from '@open-mercato/core/modules/promotions/data/entities'

import { Cart, CartLine, CartPromotionApplication } from '../data/entities'
import type { CartPromotionScope, CartStatus, CartTaxMode } from '../data/entities'
import { toCartLineSnapshot } from '../commands/lines'
import type { CartLineSnapshot } from '../commands/lines'
import type { CartMergeSummary } from '../commands/merge'
import type { CartPriceChange } from './reprice'
import { resolveCartWarningMessage } from './warningMessages'
import { approvalQualifies, computeGoodsGrossAmount } from './approvalGate'
import { tryResolveCustomerPurchaseApprovalService } from './adminCartScope'

// Step 5.2 — PLAN.md's own plan-correction note: Step 4.5's `commands/cart.ts` deferred
// building "the richer public `CartView` envelope (§10.1 ... that lands with the routes and
// line commands that first need it" and no step between 4.6 and 5.1 picked it up. This file
// is that envelope builder, shared by every `/api/cart/current/*` route file so the mapping
// from a `Cart` + its `CartLine[]` to the wire shape exists exactly once.
//
// Deliberately duplicates `commands/lines.ts`'s small per-line pricing-context/price-row
// helpers (`buildCartPricingRowFilterContext`, `buildBuyerPricingContext`,
// `fetchPriceRowsBatch`, `groupRowsByProduct`, `filterRowsForVariant`) at this file's own
// small scope, rather than exporting and importing lines.ts's private functions — the same
// precedent `lib/reprice.ts` already set for its own near-identical duplication ("keeps the
// dependency direction `lib -> catalog/sales services` only, never `lib -> commands`"). The
// one function this file DOES import from `commands/lines.ts` is the pure `toCartLineSnapshot`
// mapper, newly exported there for this purpose — `lib/currentCartRoute.ts` already imports
// command handlers/types directly from `commands/cart.ts`, so a plain data-mapping import
// here is consistent with this module's existing layering, not a new kind of coupling.
//
// Unlike `lib/reprice.ts`'s `fetchLinePriceRows` (one product/variant at a time — reprice is
// "not a hot path"), this file batches the price-row fetch across every line in ONE query
// (mirroring `commands/lines.ts`'s `bulkAddLinesCommand`) because `nextTier` is computed on
// EVERY `/current/*` response, including the plain `GET` a storefront cart drawer polls.

type CartViewScope = { tenantId: string; organizationId: string }

function buildPricingRowFilterContext(cart: Cart): PricingContext {
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

async function fetchPriceRowsBatch(
  em: EntityManager,
  scope: CartViewScope,
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
    const productId = variantId
      ? variantToProduct.get(variantId) ?? null
      : typeof row.product === 'string'
        ? row.product
        : row.product?.id ?? null
    if (!productId) continue
    const bucket = grouped.get(productId) ?? []
    bucket.push(row)
    grouped.set(productId, bucket)
  }
  return grouped
}

function filterRowsForVariant(rows: PriceRow[], variantId: string | null): PriceRow[] {
  return rows.filter((row) => {
    const rowVariantId = resolvePriceVariantId(row)
    return rowVariantId === null || rowVariantId === variantId
  })
}

/**
 * `moduleConfigService` is an optional soft peer — same `tryResolve*` pattern this module
 * already uses for `storeContextService` (`lib/routeContext.ts`) and `policyResolutionService`
 * (`commands/lines.ts`): absent module, absent service, graceful fallback to `resolveAvailability`'s
 * own `'auto'` provider selection (registry.ts: omitting `moduleConfig` always resolves `'auto'`).
 */
function tryResolveModuleConfigService(container: AppContainer): AvailabilityModuleConfigReader | null {
  try {
    return container.resolve('moduleConfigService') as AvailabilityModuleConfigReader
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// §5.3 / §4.2 `availability_state` row — the computed-per-response availability advisory
// ---------------------------------------------------------------------------

export type CartLineAvailabilityView = {
  state: AvailabilityState
  canFulfil: boolean
  leadTimeDays: number | null
  releaseAt: string | null
}

/**
 * Mirrors `ecommerce/lib/storefrontCatalogSupport.ts`'s `toStorefrontAvailability` shape
 * exactly (`state`/`canFulfil`/`leadTimeDays`/`releaseAt`), so a client reading availability
 * off a cart line and off a storefront PDP/listing sees the same fields — deliberately NOT
 * importing that function, since `cart` has no dependency edge onto `ecommerce` (this
 * module's own soft-peer policy, `lib/routeContext.ts`'s `StoreContextService` is the one
 * exception, gated behind a `tryResolve*`). A plain, pure 6-line mapper duplicated at this
 * file's own small scope is cheaper than inventing a cross-module import for it.
 */
function toCartLineAvailability(result: AvailabilityItemResult | null): CartLineAvailabilityView {
  if (!result) return { state: 'not_tracked', canFulfil: true, leadTimeDays: null, releaseAt: null }
  return {
    state: result.state,
    canFulfil: result.canFulfil,
    leadTimeDays: result.leadTimeDays,
    releaseAt: result.releaseAt,
  }
}

type AvailabilityDemand = { catalogProductId: string; catalogVariantId: string | null; quantity: number }

/**
 * One entry per distinct `(productId, variantId)` pair across the cart's lines, with
 * `quantity` summed across every line sharing that pair (two lines of the same SKU with
 * different `configuration` — engraving, personalization — still draw from one stock pool,
 * so the availability check should ask about their combined demand, not just the first
 * line's). Mirrors the batched, deduped shape `fetchPriceRowsBatch`/`groupRowsByProduct`
 * already use for the price-row fetch in this same function.
 */
function buildAvailabilityDemand(lines: CartLine[]): AvailabilityDemand[] {
  const byKey = new Map<string, AvailabilityDemand>()
  for (const line of lines) {
    const catalogVariantId = line.variantId ?? null
    const key = availabilityItemKey({ catalogProductId: line.productId, catalogVariantId })
    const existing = byKey.get(key)
    if (existing) existing.quantity += Number(line.quantity)
    else byKey.set(key, { catalogProductId: line.productId, catalogVariantId, quantity: Number(line.quantity) })
  }
  return Array.from(byKey.values())
}

/**
 * §10.1/§4.2: a line that went out of stock "must not be silent" (§10.1 prose) and, per R7's
 * own resolution text, `warnings` surfaces it "on any read" — not only on first discovery.
 * Every `out_of_stock` line in the CURRENT response therefore gets a warning entry every
 * time, same as `flag_state`'s persisted-warning treatment just above. Operates on the
 * already-built `lineViews` (needs the computed `availabilityState`), unlike
 * `buildFlaggedLineWarnings` which reads the persisted column off the raw `CartLine[]`.
 */
function buildAvailabilityWarnings(lineViews: CartLineView[], translate: TranslateWithFallbackFn): CartViewWarning[] {
  return lineViews
    .filter((line) => line.availabilityState.state === 'out_of_stock')
    .map((line) => ({
      code: 'out_of_stock',
      lineId: line.id,
      message: resolveCartWarningMessage('out_of_stock', translate),
    }))
}

// ---------------------------------------------------------------------------
// §5.4 B2B quantity tiers — `nextTier`
// ---------------------------------------------------------------------------

export type CartLineNextTierView = {
  minQuantity: number
  unitAmount: number
  formatted: string
  saving: string
}

export type CartLineView = CartLineSnapshot & {
  nextTier: CartLineNextTierView | null
  availabilityState: CartLineAvailabilityView
}

/**
 * Picks the side (`net`/`gross`) matching `Cart.taxMode`, falling back to whichever side a
 * tier actually resolved when the preferred one is unavailable (e.g. no tax rate could be
 * derived for the missing side) — same fallback shape `resolveBothSides` itself uses
 * internally, just applied to a tier's already-resolved pair instead of a raw price row.
 */
function pickTierAmount(tier: LinePriceTier, taxMode: CartTaxMode): number | null {
  return taxMode === 'gross' ? tier.amountGross ?? tier.amountNet : tier.amountNet ?? tier.amountGross
}

/**
 * §5.4: `{ minQuantity, unitAmount, formatted, saving } | null`. `saving` is a percentage
 * string computed from the CURRENT effective unit price (the tier `resolveLinePrice` itself
 * resolved for the line's actual quantity, matching §5.4's own "tier selection is automatic")
 * down to the next tier's unit price — both read off the SAME `resolveLinePrice` call so they
 * share a basis, rather than mixing a freshly-resolved `nextTier` against the line's
 * possibly-stale persisted snapshot. `formatted` reuses `@open-mercato/ui/utils/format`'s
 * `formatCurrency` — the same helper `ecommerce/lib/storefrontPricing.ts` already wraps for
 * its own near-identical per-tier `formatted` field (search "Intl.NumberFormat"/
 * "formatCurrency" under `catalog`/`ecommerce`, per this step's own research note).
 */
function buildNextTierView(resolved: ResolvedLinePrice, cart: Cart): CartLineNextTierView | null {
  const next = resolved.nextTier
  if (!next) return null
  const nextAmount = pickTierAmount(next, cart.taxMode)
  if (nextAmount === null) return null
  const currentAmount = resolved.currentTier
    ? pickTierAmount(resolved.currentTier, cart.taxMode)
    : cart.taxMode === 'gross'
      ? resolved.amountGross ?? resolved.amountNet
      : resolved.amountNet ?? resolved.amountGross
  const savingPercent =
    currentAmount !== null && currentAmount > 0
      ? Math.max(0, Math.round(((currentAmount - nextAmount) / currentAmount) * 100))
      : 0
  return {
    minQuantity: next.minQuantity,
    unitAmount: nextAmount,
    formatted: formatCurrency(nextAmount, cart.currencyCode, cart.locale) ?? String(nextAmount),
    saving: `${savingPercent}%`,
  }
}

// ---------------------------------------------------------------------------
// §10.1 response envelope
// ---------------------------------------------------------------------------

/** §10.1's own shape: `{ id; status; amountGross; currencyCode; qualifies } | null`, read
 * live through `customerPurchaseApprovalService.getApproval` (Step 3.2) — never
 * denormalized onto the cart. See `buildCartResponseEnvelope`'s own call site for the
 * soft-dependency degrade when that service is absent. */
export type CartApprovalView = {
  id: string
  status: string
  amountGross: string
  currencyCode: string
  qualifies: boolean
} | null

/**
 * §10.1's `promotions: AppliedPromotionView[]` — one entry per `CartPromotionApplication`
 * row on this cart (QA F10). `promotionId` is deliberately the ONLY identifier exposed for
 * removal purposes: `DELETE /current/promotions/[id]` (`api/current/promotions/[id]/route.ts`,
 * `commands/promotions.ts`'s `removePromotionCommand`) reads its `[id]` path param as the
 * applied PROMOTION's id and queries `CartPromotionApplication` by `promotionId`, never by
 * the application row's own `id` — so exposing a separate row-id field here would invite a
 * client to pass the wrong value. A promotion applied as a `LINE_DISCOUNT` to several lines
 * produces one entry per line (same `promotionId`, different `cartLineId`); removing by
 * `promotionId` deletes all of them in one call, matching `removePromotionCommand`'s own
 * "removes every application row for this promotion" behavior.
 */
export type AppliedPromotionView = {
  promotionId: string
  promotionName: string
  code: string | null
  scope: CartPromotionScope
  cartLineId: string | null
  amountNet: string | null
  amountGross: string | null
}

export type CartView = {
  token?: string
  updatedAt: Date
  status: CartStatus
  currencyCode: string
  locale: string
  taxMode: CartTaxMode
  lines: CartLineView[]
  totals: SalesDocumentAmounts
  promotions: AppliedPromotionView[]
  requiresApproval: boolean
  approval: CartApprovalView
  awaitingApprovalSince: Date | null
  itemCount: number
  lineCount: number
  expiresAt: Date
}

export type CartViewWarning = { code: string; lineId?: string; message: string }

/** §10.1's `mergeSummary?: MergeSummary` — an alias of `commands/merge.ts`'s own
 * `CartMergeSummary` (lines added, quantities combined, anything capped), present only on
 * a `POST /current/merge` response (§7.2's disclosure requirement). */
export type MergeSummary = CartMergeSummary

export type CartResponseEnvelope = {
  cart: CartView
  priceChanges?: CartPriceChange[]
  versionBumpReason?: 'mutation' | 'repricing' | 'merge'
  warnings?: CartViewWarning[]
  mergeSummary?: MergeSummary
}

/**
 * §4.2: `flag_state` is "shown separately, with a warning" — the only persisted source of a
 * line-level warning today (no command sets it yet; the §6a.2/§6a.5 re-visibility pass is a
 * later step, same as `availability_state`). Folded into the top-level `warnings` array
 * (judgment call, documented on `buildCartResponseEnvelope`) so a client has one place to
 * check "is there anything to tell the buyer" without walking every line.
 */
function buildFlaggedLineWarnings(lines: CartLine[], translate: TranslateWithFallbackFn): CartViewWarning[] {
  return lines
    .filter((line) => line.flagState === 'product_unavailable')
    .map((line) => ({
      code: 'product_unavailable',
      lineId: line.id,
      message: resolveCartWarningMessage('line_unavailable', translate),
    }))
}

/**
 * Resolves `CartPromotionApplication` rows into `AppliedPromotionView`s, batch-fetching
 * `Promotion` names in ONE query across every distinct `promotionId` (never N+1) — the same
 * cross-module FK-id-then-fetch-separately precedent `commands/promotions.ts`'s
 * `resolvePromotionIdsForCode` already set for this exact pair (`cart` has no ORM relation
 * onto `promotions`).
 *
 * An application row whose `Promotion` has since been hard- or soft-deleted degrades by
 * OMITTING that entry (documented judgment call, Step 8.4): a promotion the buyer can no
 * longer be told anything meaningful about is not worth surfacing as a half-populated row,
 * and the entry carries no other display-safe name to fall back to.
 */
async function buildAppliedPromotionViews(
  em: EntityManager,
  scope: CartViewScope,
  applications: CartPromotionApplication[],
): Promise<AppliedPromotionView[]> {
  if (applications.length === 0) return []
  const promotionIds = Array.from(new Set(applications.map((application) => application.promotionId)))
  const promotions = await em.find(Promotion, {
    id: { $in: promotionIds },
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  const promotionNameById = new Map(promotions.map((promotion) => [promotion.id, promotion.name]))

  const views: AppliedPromotionView[] = []
  for (const application of applications) {
    const promotionName = promotionNameById.get(application.promotionId)
    if (!promotionName) continue
    views.push({
      promotionId: application.promotionId,
      promotionName,
      code: application.code ?? null,
      scope: application.scope,
      cartLineId: application.cartLineId ?? null,
      amountNet: application.amountNet ?? null,
      amountGross: application.amountGross ?? null,
    })
  }
  return views
}

export type BuildCartResponseEnvelopeParams = {
  container: AppContainer
  cartId: string
  tenantId: string
  organizationId: string
  /** Present ONLY for the `POST /current` creation response (§8.3, §10.1). */
  token?: string
  priceChanges?: CartPriceChange[]
  versionBumpReason?: 'mutation' | 'repricing' | 'merge'
  /** Extra, route-supplied warnings — e.g. the CURRENT mutation's own `quantity_capped`
   * outcome, which (unlike `flag_state`) is not persisted anywhere a later read could
   * reconstruct it from. Merged with `buildFlaggedLineWarnings`'s own derived entries. */
  warnings?: CartViewWarning[]
  /** (Step 7.3) Present only on the `POST /current/merge` response — `cart.merge`'s own
   * result already carries the derived summary, so this is passed through verbatim rather
   * than re-derived from anything this function would otherwise fetch. */
  mergeSummary?: MergeSummary
}

/**
 * Builds the §10.1 `CartView` envelope for one `/api/cart/current/*` response. ALWAYS
 * re-fetches `Cart` + its non-deleted `CartLine`s fresh (one extra round trip beyond
 * whatever the calling route's own command already did) rather than trusting a summary the
 * route captured earlier in the request: `cart.lines.update`'s own tier-crossing re-price
 * can bump `Cart.updatedAt` as a side effect, so a pre-mutation `CartSummary` captured by
 * `resolveCurrentCart` before the command ran would otherwise hand the client a stale
 * `updatedAt` — exactly the kind of gap that produces a false 409 on the client's next
 * optimistic-lock header. The command handlers in `commands/cart.ts`/`commands/lines.ts`
 * never return a lines array at all today (checked per this step's own brief), so there is
 * no cheaper path that still threads already-loaded data through.
 *
 * Judgment calls (documented here since no later step owns them):
 * - `approval` (Step 3.2 — `customer_groups.CustomerPurchaseApproval` now exists): read
 *   LIVE through `customerPurchaseApprovalService.getApproval`, never denormalized, per
 *   §9a.4's own text ("`CartView.approval` is read live in one batched call per request").
 *   `qualifies` reuses the SAME formula `cart.lock`'s own gate check applies
 *   (`lib/approvalGate.ts#approvalQualifies`) — one implementation, read by both the gate
 *   and this display-only view. `null` with no error when `customer_groups`' approval
 *   service cannot be resolved (soft dependency, same degrade `lib/adminCartScope.ts`'s own
 *   doc comment documents for the admin detail route) — never thrown, since a read-only
 *   envelope must not fail just because an optional peer happened to be unavailable.
 * - `itemCount`/`lineCount`: no storefront cart-like view in this worktree's `ecommerce`
 *   module to borrow a precedent from (checked). The obvious reading: `lineCount` is the
 *   number of non-deleted `CartLine` rows; `itemCount` sums their quantities (a cart with one
 *   line at quantity 5 has `lineCount: 1`, `itemCount: 5`).
 * - top-level `warnings`: FLATTENS, rather than duplicates, the per-line signals a client
 *   would otherwise have to walk every line to find — `flag_state` (persisted), the
 *   `availabilityState` computed below (an `out_of_stock` line, per R7's own resolution text
 *   "`warnings` surfaces a line that went out of stock on any read" — every matching read,
 *   not only first discovery), plus whatever the calling route passes via `params.warnings`
 *   (the current mutation's own transient `quantity_capped` outcome, which nothing
 *   persists). Each entry carries `lineId` when it names a surviving line; a rejection that
 *   created no line (e.g. a visibility-rejected `cart.lines.add`) has no `lineId` to attach.
 * - `availabilityState`: §4.2's own `availability_state` row — computed live via
 *   `resolveAvailability`, never persisted (a persisted field written on every read would
 *   bump `updated_at` on every read, false-409ing the buyer's next write). Batched ONE call
 *   per response across every line's `(productId, variantId)` pair (never once per line),
 *   mirroring this function's own price-row batching. No `policyResolutionService`
 *   hide-policy resolution — see the call site's own comment for why the cart doesn't need it.
 */
export async function buildCartResponseEnvelope(params: BuildCartResponseEnvelopeParams): Promise<CartResponseEnvelope> {
  const scope: CartViewScope = { tenantId: params.tenantId, organizationId: params.organizationId }
  const em = (params.container.resolve('em') as EntityManager).fork()

  const cart = await findOneWithDecryption(
    em,
    Cart,
    { id: params.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
  if (!cart) throw notFound('[internal] cart not found')

  const lines = (await findWithDecryption(
    em,
    CartLine,
    { cartId: cart.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartLine[]

  const buyerPricingService = params.container.resolve<CatalogBuyerPricingService>('catalogBuyerPricingService')

  const productIds = Array.from(new Set(lines.map((line) => line.productId)))
  const variantIds = Array.from(new Set(lines.map((line) => line.variantId).filter((id): id is string => !!id)))
  const variantToProduct = new Map<string, string>()
  for (const line of lines) {
    if (line.variantId) variantToProduct.set(line.variantId, line.productId)
  }
  const pricingRowContext = buildPricingRowFilterContext(cart)
  const priceRows = await fetchPriceRowsBatch(em, scope, pricingRowContext, productIds, variantIds)
  const rowsByProduct = groupRowsByProduct(priceRows, variantToProduct)

  // §5.3/§4.2 `availability_state` row: ONE batched `resolveAvailability` call for every
  // line of this response (never one per line — same batching discipline as the price-row
  // fetch above), computed live on every read and never persisted. No `policyResolutionService`
  // hide-policy resolution here (unlike `ecommerce`'s `resolveStorefrontAvailability`, which
  // also resolves `hideWhenOutOfStock` for its own listing/PDP "should this even render"
  // decision) — the cart never hides an unavailable line, it surfaces a warning on it
  // (§10.1), so that policy field has no cart-side consumer.
  const availabilityDemand = buildAvailabilityDemand(lines)
  const availabilityModuleConfig = tryResolveModuleConfigService(params.container)
  const availabilityResult = availabilityDemand.length
    ? await resolveAvailability(
        {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          storeId: cart.storeId ?? null,
          channelId: cart.salesChannelId ?? null,
          items: availabilityDemand.map((item) => ({
            catalogProductId: item.catalogProductId,
            catalogVariantId: item.catalogVariantId,
            quantity: item.quantity,
          })),
        },
        availabilityModuleConfig ? { moduleConfig: availabilityModuleConfig, container: params.container } : { container: params.container },
      )
    : { byItem: {} }

  const now = new Date()
  const lineViews: CartLineView[] = []
  // Sequential, not `Promise.all` — `resolveLinePrice` may itself run an `EntityManager`
  // read (the `SalesTaxRate` fallback lookup) on this SAME forked `em`; concurrent calls
  // sharing one `em` is the exact hazard SPEC-018 exists to avoid, even though this file
  // never mutates anything on it.
  for (const line of lines) {
    const rows = filterRowsForVariant(rowsByProduct.get(line.productId) ?? [], line.variantId ?? null)
    let nextTier: CartLineNextTierView | null = null
    if (rows.length) {
      const context = buildBuyerPricingContext(cart, Number(line.quantity), now)
      const resolved = await buyerPricingService.resolveLinePrice(em, rows, context, scope)
      nextTier = buildNextTierView(resolved, cart)
    }
    const availabilityKey = availabilityItemKey({ catalogProductId: line.productId, catalogVariantId: line.variantId ?? null })
    const availabilityState = toCartLineAvailability(availabilityResult.byItem[availabilityKey] ?? null)
    lineViews.push({ ...toCartLineSnapshot(line), nextTier, availabilityState })
  }

  const lineCount = lineViews.length
  const itemCount = lines.reduce((sum, line) => sum + Number(line.quantity), 0)

  const approvalService = tryResolveCustomerPurchaseApprovalService(params.container)
  const approvalRecord = cart.approvalId && approvalService
    ? await approvalService.getApproval({ scope, approvalId: cart.approvalId })
    : null
  const goodsGrossAmount = computeGoodsGrossAmount(cart.totals)
  const approval: CartApprovalView = approvalRecord
    ? {
        id: approvalRecord.id,
        status: approvalRecord.status,
        amountGross: approvalRecord.amountGross,
        currencyCode: approvalRecord.currencyCode,
        qualifies: approvalQualifies({ approval: approvalRecord, cartCurrencyCode: cart.currencyCode, goodsGrossAmount }),
      }
    : null

  const promotionApplications = (await findWithDecryption(
    em,
    CartPromotionApplication,
    { cartId: cart.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartPromotionApplication[]
  const promotions = await buildAppliedPromotionViews(em, scope, promotionApplications)

  const view: CartView = {
    ...(params.token ? { token: params.token } : {}),
    updatedAt: cart.updatedAt,
    status: cart.status,
    currencyCode: cart.currencyCode,
    locale: cart.locale,
    taxMode: cart.taxMode,
    lines: lineViews,
    totals: cart.totals as unknown as SalesDocumentAmounts,
    promotions,
    requiresApproval: cart.requiresApproval,
    approval,
    awaitingApprovalSince: cart.awaitingApprovalSince ?? null,
    itemCount,
    lineCount,
    expiresAt: cart.expiresAt,
  }

  const { translate } = await resolveTranslations()
  const warnings = [
    ...buildFlaggedLineWarnings(lines, translate),
    ...buildAvailabilityWarnings(lineViews, translate),
    ...(params.warnings ?? []),
  ]

  const envelope: CartResponseEnvelope = { cart: view }
  if (params.priceChanges && params.priceChanges.length > 0) envelope.priceChanges = params.priceChanges
  if (params.versionBumpReason) envelope.versionBumpReason = params.versionBumpReason
  if (warnings.length > 0) envelope.warnings = warnings
  if (params.mergeSummary) envelope.mergeSummary = params.mergeSummary
  return envelope
}
