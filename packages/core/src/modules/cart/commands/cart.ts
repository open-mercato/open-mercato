import { asValue } from 'awilix'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { badRequest, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { SalesAdjustmentDraft, SalesDocumentAmounts } from '@open-mercato/core/modules/sales/lib/types'
import { E } from '#generated/entities.ids.generated'
import { Cart, CartLine } from '../data/entities'
import type { CartChannel, CartKind, CartStatus, CartTaxMode } from '../data/entities'
import { cartCreateInputSchema, type CartCreateInput as CartCreateTrustedInput } from '../data/validators'
import { generateCartToken, hashCartToken } from '../lib/token'
import { shouldEnforceAssortmentScope } from '../lib/routeContext'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { emitCartEvent } from '../events'
import {
  buildCartLineRepricePhases,
  buildRecomputeCartTotalsPhase,
} from '../lib/reprice'
import type { CartPriceChange, CartPriceChangeReason } from '../lib/reprice'
import { buildPromotionsEffectsPhase } from '../lib/promotionContext'
import type { CartPromotionWarning } from '../lib/promotionContext'
import { detectCartRepriceTrigger } from '../lib/triggers'
import type { CartRepriceTriggerReason } from '../lib/triggers'
import { buildWholeCartRevisibilityPhase } from '../lib/visibility'
import { emitVisibilityRejectedEvent } from './lines'

// Step 4.5 — the first two commands in the §3.1a list: `cart.create` and `cart.get`, the
// route edge's two entry points. Step 5.1 adds `cart.reprice` (§5.2 triggers 2-4) to this
// same file — the file manifest (PLAN.md §15) groups whole-cart operations in `cart.ts`,
// distinct from `lines.ts`'s per-line commands. Every other command in the §3.1a list
// (`.promotions.*`, `.merge`, `.lock`/`.unlock`, `.proposal.*`) is a later phase.

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

function getCartIdentifiers(cart: Cart) {
  return { id: cart.id, organizationId: cart.organizationId, tenantId: cart.tenantId }
}

// ---------------------------------------------------------------------------
// cart.create
// ---------------------------------------------------------------------------

/**
 * §6a.1a public path. The route edge resolves `ResolvedCartRouteContext` via
 * `resolveCartRouteContext` (`lib/routeContext.ts`) and hands it to the command untouched —
 * never a request body. `channel` is always `'storefront'` on this path by construction
 * (the type itself only admits that literal).
 */
export type CartCreateStorefrontInput = {
  routeContext: ResolvedCartRouteContext
}

/**
 * §6a.4 authenticated path — non-storefront channel creation. Reuses `cartCreateInputSchema`
 * (Step 4.2, `data/validators.ts`) verbatim rather than inventing a parallel schema: its shape
 * (`channel`/`storeId`/`salesChannelId`/`currencyCode`/`locale`/`taxMode`/`customerId`/
 * `customerUserId`/`email`) is already exactly what this authenticated, trusted path needs to
 * persist. `channel` is restricted to a non-`storefront` value at RUNTIME below (the schema
 * itself still accepts all five `CartChannel` values, since it is also the shape `cart.create`
 * persists for the storefront path internally — see `execute`).
 *
 * Deliberate deviation from the Step 4.5 task's own illustrative shape
 * (`{ channel, storeId, salesChannelId, requiredFeature }`): this type does NOT include a
 * caller-supplied `requiredFeature` field. Trusting the caller to name its own gating feature
 * would let an authenticated principal that holds an unrelated `cart.channel.*` feature claim
 * it satisfies a different channel's gate. `requireChannelFeature` below derives the required
 * feature deterministically from `channel` via `CART_CHANNEL_FEATURES` instead — there is no
 * feature string for a caller to substitute.
 */
export type { CartCreateTrustedInput }

export type CartCreateCommandInput = CartCreateStorefrontInput | CartCreateTrustedInput

export type CartCreateResult = {
  cartId: string
  /** Plaintext token — appears here, and ONLY here, ever (§8.3, C13). */
  token: string
  channel: CartChannel
  tenantId: string
  organizationId: string
}

function isStorefrontCartCreateInput(input: CartCreateCommandInput): input is CartCreateStorefrontInput {
  return typeof input === 'object' && input !== null && 'routeContext' in input
}

// §6a.4: "requires an authenticated server principal holding a channel-specific feature
// (cart.channel.pos, cart.channel.payLink, cart.channel.agent, cart.channel.api)". The map
// deliberately excludes `storefront` — there is no `cart.channel.storefront` feature, by
// design, so a trusted-path call with `channel: 'storefront'` is rejected explicitly below
// rather than falling through to a lookup miss here.
const CART_CHANNEL_FEATURES: Record<Exclude<CartChannel, 'storefront'>, string> = {
  pos: 'cart.channel.pos',
  pay_link: 'cart.channel.payLink',
  agent: 'cart.channel.agent',
  api: 'cart.channel.api',
}

// These rejection messages are `[internal]`-prefixed (not yet routed through `t(...)`) because
// `cart` has no `i18n/` catalog at all yet (checked — Step 4.1 never added one, and no route
// exists until Step 4.7). Revisit once that catalog exists and a route maps this command's
// errors to an HTTP response a buyer or integration operator actually reads.
async function requireChannelFeature(
  ctx: CommandRuntimeContext,
  channel: Exclude<CartChannel, 'storefront'>,
): Promise<void> {
  const requiredFeature = CART_CHANNEL_FEATURES[channel]
  const auth = ctx.auth
  if (!auth?.sub || !auth.tenantId) {
    throw forbidden(
      `[internal] cart.create for channel "${channel}" requires an authenticated principal holding "${requiredFeature}"`,
    )
  }
  const organizationId = ctx.selectedOrganizationId ?? auth.orgId ?? null
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const granted =
    !!rbac &&
    (await rbac.userHasAllFeatures(auth.sub, [requiredFeature], {
      tenantId: auth.tenantId,
      organizationId,
    }))
  if (!granted) {
    throw forbidden(`[internal] Missing required feature "${requiredFeature}" to create a "${channel}" cart`)
  }
}

function resolveAuthenticatedScope(ctx: CommandRuntimeContext): { tenantId: string; organizationId: string } {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw badRequest('[internal] Tenant and organization scope are required to create a cart')
  }
  return { tenantId, organizationId }
}

// §9: "expires_at reached (default 30 days for identified buyers, 7 for guests)". "Identified"
// is read as "a winning customer_id resolved" (D3/D3a) — the same signal `Cart.customer_id`
// itself documents as "the identity that wins". A trusted non-storefront cart with no
// customerId supplied is treated as a guest for this purpose; nothing in §6a.4/§9 says a POS/
// agent/API cart gets a different default TTL than a basket would for the same identity state.
const IDENTIFIED_BUYER_EXPIRY_DAYS = 30
const GUEST_EXPIRY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

function resolveCartExpiresAt(now: Date, customerId: string | null): Date {
  const days = customerId ? IDENTIFIED_BUYER_EXPIRY_DAYS : GUEST_EXPIRY_DAYS
  return new Date(now.getTime() + days * DAY_MS)
}

// §4.1: `Cart.totals` is "Verbatim SalesDocumentCalculationResult.totals" — i.e. the `totals`
// FIELD of that result, not the whole result object (which also carries `lines`/`adjustments`/
// `kind`/`currencyCode`/`metadata` — none of that applies to a cart with no lines yet). A
// brand-new cart has nothing to sum, so every amount is zero; optional fields
// (`shippingNetAmount`, `paidTotalAmount`, etc.) are omitted rather than zeroed, matching how
// `salesCalculationService` itself only populates them when applicable.
const EMPTY_CART_TOTALS: SalesDocumentAmounts = {
  subtotalNetAmount: 0,
  subtotalGrossAmount: 0,
  discountTotalAmount: 0,
  taxTotalAmount: 0,
  grandTotalNetAmount: 0,
  grandTotalGrossAmount: 0,
}

type ResolvedCartCreateFields = {
  tenantId: string
  organizationId: string
  channel: CartChannel
  storeId: string | null
  salesChannelId: string | null
  currencyCode: string
  locale: string
  taxMode: CartTaxMode
  customerId: string | null
  customerIds: string[] | null
  customerUserId: string | null
  customerGroupIds: string[]
  priceKindId: string | null
  email: string | null
  buyerDigest: string
}

const createCartCommand: CommandHandler<CartCreateCommandInput, CartCreateResult> = {
  id: 'cart.create',
  // Not in the Step 3.1a undo table at all (only `.lines.*`/`.merge` are) — no `undo` handler,
  // consistent with other non-undoable commands in this codebase (e.g.
  // `api_keys.keys.create`), which still log an audit entry via `buildLog` below.
  isUndoable: false,
  async execute(rawInput, ctx) {
    const now = new Date()
    let fields: ResolvedCartCreateFields

    if (isStorefrontCartCreateInput(rawInput)) {
      const { routeContext } = rawInput
      // Defense in depth: a no-op for the typical anonymous buyer (`ctx.auth` is null, so
      // `ensureTenantScope`/`ensureOrganizationScope` short-circuit per their own "Pattern C"),
      // but still correctly rejects a staff `ctx.auth` actor whose own scope does not cover the
      // resolved store's tenant/org.
      ensureTenantScope(ctx, routeContext.tenantId)
      ensureOrganizationScope(ctx, routeContext.organizationId)
      fields = {
        tenantId: routeContext.tenantId,
        organizationId: routeContext.organizationId,
        channel: 'storefront',
        storeId: routeContext.storeId,
        salesChannelId: routeContext.salesChannelId,
        currencyCode: routeContext.currencyCode,
        locale: routeContext.locale,
        taxMode: routeContext.taxMode,
        customerId: routeContext.customerId,
        customerIds: routeContext.customerIds,
        customerUserId: routeContext.customerUserId,
        customerGroupIds: routeContext.customerGroupIds,
        priceKindId: routeContext.priceKindId,
        email: null,
        buyerDigest: routeContext.buyerDigest,
      }
    } else {
      const parsed = cartCreateInputSchema.parse(rawInput)
      if (parsed.channel === 'storefront') {
        throw badRequest(
          '[internal] cart.create\'s authenticated path cannot mint a "storefront" channel cart — ' +
            'storefront carts are created only through the public route (§6a.4)',
        )
      }
      await requireChannelFeature(ctx, parsed.channel)
      const { tenantId, organizationId } = resolveAuthenticatedScope(ctx)
      fields = {
        tenantId,
        organizationId,
        channel: parsed.channel,
        storeId: parsed.storeId ?? null,
        salesChannelId: parsed.salesChannelId ?? null,
        currencyCode: parsed.currencyCode,
        locale: parsed.locale,
        taxMode: parsed.taxMode,
        // No `StoreContext`/`BuyerContext` is resolved on this path at all (§6a.4: "pos, pay_link,
        // agent and api carts have no channel binding and no buyer digest") — `customerGroupIds`
        // stays empty and `priceKindId` stays unresolved; only the single `customerId` the trusted
        // caller supplied is known, so `customerIds` is derived from it rather than copied from a
        // buyer context that was never resolved.
        customerId: parsed.customerId ?? null,
        customerIds: parsed.customerId ? [parsed.customerId] : [],
        customerUserId: parsed.customerUserId ?? null,
        customerGroupIds: [],
        priceKindId: null,
        email: parsed.email ?? null,
        buyerDigest: '',
      }
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const { token, tokenHash } = generateCartToken()

    // Single-entity insert, no query interleaved between the mutation and the flush — matches
    // this codebase's own precedent for a comparably simple create command
    // (`customers.tags.create` in `customers/commands/tags.ts`, which also skips
    // `withAtomicFlush`/`runCrudCommandWrite` for exactly this shape). `withAtomicFlush` is for
    // multi-phase writes that interleave a query between mutation and flush (e.g.
    // `promotions.promotion.create`'s two-entity cycle) — not required here.
    const cart = em.create(Cart, {
      organizationId: fields.organizationId,
      tenantId: fields.tenantId,
      tokenHash,
      storeId: fields.storeId,
      channel: fields.channel,
      kind: 'basket',
      salesChannelId: fields.salesChannelId,
      status: 'active',
      currencyCode: fields.currencyCode,
      locale: fields.locale,
      customerId: fields.customerId,
      customerIds: fields.customerIds,
      customerUserId: fields.customerUserId,
      customerGroupIds: fields.customerGroupIds,
      priceKindId: fields.priceKindId,
      taxMode: fields.taxMode,
      // Buyer-supplied fields a brand-new, lineless cart has none of yet.
      email: fields.email,
      note: null,
      // No visibility/promotion pass has run yet (that is Step 4.6+ territory).
      assortmentScopeHash: null,
      promotionEffects: null,
      metadata: null,
      buyerDigest: fields.buyerDigest,
      totals: { ...EMPTY_CART_TOTALS },
      totalsComputedAt: now,
      requiresApproval: false,
      approvalId: null,
      lastActivityAt: now,
      expiresAt: resolveCartExpiresAt(now, fields.customerId),
    })
    em.persist(cart)
    await em.flush()

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: cart,
      identifiers: getCartIdentifiers(cart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })

    return {
      cartId: cart.id,
      token,
      channel: cart.channel,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.cart.create', 'Create cart'),
      resourceKind: 'cart.cart',
      resourceId: result.cartId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }
  },
}

// ---------------------------------------------------------------------------
// cart.get
// ---------------------------------------------------------------------------

export type CartGetByIdInput = {
  tenantId: string
  organizationId: string
  cartId: string
  /**
   * (Step 5.1) When supplied, §5.2 triggers 2-4 are evaluated against the stored cart and,
   * if any fired, `cart.reprice` runs internally before this command returns — "GET writes
   * only when a trigger fires" (PLAN.md Step 5.1). Every `/current/*` route supplies this
   * via `resolveCurrentCart` (`lib/currentCartRoute.ts`), since all four resolve a
   * `ResolvedCartRouteContext` at the route edge before calling `cart.get`. An internal
   * by-id caller with no fresh buyer context to compare against (e.g. a future admin
   * inspection route, §10.2) omits this and never triggers a re-price.
   */
  freshContext?: ResolvedCartRouteContext
}

export type CartGetByTokenInput = {
  tenantId: string
  organizationId: string
  token: string
  freshContext?: ResolvedCartRouteContext
}

export type CartGetInput = CartGetByIdInput | CartGetByTokenInput

/**
 * The full `Cart` row minus `tokenHash` — never returned by any command result (§8.3). This
 * step does not build the richer public `CartView` envelope (§10.1, with lines/warnings/
 * priceChanges); that lands with the routes and line commands that first need it.
 */
export type CartSummary = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  channel: CartChannel
  kind: CartKind
  status: CartStatus
  currencyCode: string
  locale: string
  taxMode: CartTaxMode
  customerId: string | null
  customerIds: string[] | null
  customerUserId: string | null
  customerGroupIds: string[]
  priceKindId: string | null
  email: string | null
  note: string | null
  buyerDigest: string
  totals: Record<string, unknown>
  totalsComputedAt: Date
  promotionEffects: unknown
  requiresApproval: boolean
  approvalId: string | null
  metadata: Record<string, unknown> | null
  salesChannelId: string | null
  lastActivityAt: Date
  lastPriceChangeAt: Date | null
  lockedAt: Date | null
  lockExpiresAt: Date | null
  checkoutSessionId: string | null
  resolvedAt: Date | null
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

export type CartGetResult =
  | { found: true; cart: CartSummary; priceChanges?: CartPriceChange[]; versionBumpReason?: 'repricing' }
  | { found: false }

function isCartGetByIdInput(input: CartGetInput): input is CartGetByIdInput {
  return 'cartId' in input
}

// Exported (Step 7.5) so `commands/lock.ts`'s `cart.lock`/`.unlock`/`.markConverted` can
// build the same `CartSummary` shape after their own writes, instead of duplicating this
// ~20-field mapping a third time — mirrors `commands/lines.ts`'s `toCartLineSnapshot`,
// exported for the identical reason at Step 5.2.
export function toCartSummary(cart: Cart): CartSummary {
  return {
    id: cart.id,
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
    storeId: cart.storeId ?? null,
    channel: cart.channel,
    kind: cart.kind,
    status: cart.status,
    currencyCode: cart.currencyCode,
    locale: cart.locale,
    taxMode: cart.taxMode,
    customerId: cart.customerId ?? null,
    customerIds: cart.customerIds ?? null,
    customerUserId: cart.customerUserId ?? null,
    customerGroupIds: cart.customerGroupIds,
    priceKindId: cart.priceKindId ?? null,
    email: cart.email ?? null,
    note: cart.note ?? null,
    buyerDigest: cart.buyerDigest,
    totals: cart.totals,
    totalsComputedAt: cart.totalsComputedAt,
    promotionEffects: cart.promotionEffects ?? null,
    requiresApproval: cart.requiresApproval,
    approvalId: cart.approvalId ?? null,
    metadata: cart.metadata ?? null,
    salesChannelId: cart.salesChannelId ?? null,
    lastActivityAt: cart.lastActivityAt,
    lastPriceChangeAt: cart.lastPriceChangeAt ?? null,
    lockedAt: cart.lockedAt ?? null,
    lockExpiresAt: cart.lockExpiresAt ?? null,
    checkoutSessionId: cart.checkoutSessionId ?? null,
    resolvedAt: cart.resolvedAt ?? null,
    expiresAt: cart.expiresAt,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  }
}

// §8.3 / §7a.1: "`cartService.resolveBasketByToken` resolves `kind = 'basket'` only" — a
// proposal cart's token is never issued and never resolves; by-id lookups get the identical
// restriction so an internal caller cannot reach a proposal cart through this command either.
// §6a.3's "no write-side enumeration oracle" extends naturally to this READ: a wrong id, a
// wrong token, a cross-tenant id/token and a real `kind = 'proposal'` cart id all produce the
// exact same `{ found: false }` — never a distinguishable reason.
const getCartCommand: CommandHandler<CartGetInput, CartGetResult> = {
  id: 'cart.get',
  isUndoable: false,
  async execute(input, ctx) {
    // Defense in depth, same reasoning as `cart.create`'s storefront path: a no-op for the
    // common anonymous-caller case, a real check for a staff `ctx.auth` actor.
    ensureTenantScope(ctx, input.tenantId)
    ensureOrganizationScope(ctx, input.organizationId)

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const where = isCartGetByIdInput(input)
      ? { id: input.cartId, tenantId: input.tenantId, organizationId: input.organizationId, kind: 'basket' as const }
      : {
          tokenHash: hashCartToken(input.token),
          tenantId: input.tenantId,
          organizationId: input.organizationId,
          kind: 'basket' as const,
        }

    const cart = await findOneWithDecryption(
      em,
      Cart,
      where,
      {},
      { tenantId: input.tenantId, organizationId: input.organizationId },
    )
    if (!cart) return { found: false }

    // §5.2 triggers 2-4 — see `lib/triggers.ts`'s own doc comment for the storefront-only
    // caveat on triggers 2/3 and the `totalsComputedAt`-as-staleness-proxy judgment call.
    // Only an `active` cart re-prices: a `locked`/`converted`/`abandoned`/`expired`/`merged`
    // cart reached via this command (e.g. a stale token still presented after expiry) has
    // no business re-pricing itself on a read.
    if (input.freshContext && cart.status === 'active') {
      const trigger = detectCartRepriceTrigger(
        {
          channel: cart.channel,
          buyerDigest: cart.buyerDigest,
          currencyCode: cart.currencyCode,
          locale: cart.locale,
          totalsComputedAt: cart.totalsComputedAt,
        },
        input.freshContext,
        new Date(),
      )
      if (trigger) {
        const commandBus = ctx.container.resolve('commandBus') as CommandBus
        const repriceInput = buildCartRepriceInputForTrigger(cart, input.freshContext, trigger.reason)
        const { result } = await commandBus.execute<CartRepriceInput, CartRepriceResult>(repriceCartCommand.id, {
          input: repriceInput,
          ctx,
        })
        return { found: true, cart: result.cart, priceChanges: result.priceChanges, versionBumpReason: 'repricing' }
      }
    }

    return { found: true, cart: toCartSummary(cart) }
  },
}

/**
 * Maps a detected §5.2 trigger onto `cart.reprice`'s own input shape — only the fields the
 * specific trigger actually changed travel along (buyer identity for trigger 2, currency
 * for trigger 3's currency half, locale for trigger 3's locale half); trigger 4 (staleness)
 * carries no field update at all, just the re-price itself.
 */
function buildCartRepriceInputForTrigger(
  cart: Cart,
  freshContext: ResolvedCartRouteContext,
  reason: CartRepriceTriggerReason,
): CartRepriceInput {
  const base: CartRepriceInput = {
    cartId: cart.id,
    tenantId: cart.tenantId,
    organizationId: cart.organizationId,
    trigger: reason,
    routeContext: freshContext,
  }
  if (reason === 'buyer_context_changed') {
    return {
      ...base,
      buyerDigest: freshContext.buyerDigest,
      customerId: freshContext.customerId,
      customerIds: freshContext.customerIds,
      customerUserId: freshContext.customerUserId,
      customerGroupIds: freshContext.customerGroupIds,
      priceKindId: freshContext.priceKindId,
    }
  }
  if (reason === 'currency_changed') return { ...base, currencyCode: freshContext.currencyCode }
  if (reason === 'locale_changed') return { ...base, locale: freshContext.locale }
  return base
}

// ---------------------------------------------------------------------------
// cart.reprice (Step 5.1, §5.2 triggers 2-4 + trigger 7's narrow admin seam — see this
// step's own report for the trigger-7 investigation)
// ---------------------------------------------------------------------------

export type CartRepriceInput = {
  cartId: string
  tenantId: string
  organizationId: string
  trigger: CartRepriceTriggerReason
  /** Present only when `trigger === 'buyer_context_changed'`. */
  buyerDigest?: string
  customerId?: string | null
  customerIds?: string[] | null
  customerUserId?: string | null
  customerGroupIds?: string[]
  priceKindId?: string | null
  /** Present only when `trigger === 'currency_changed'`. */
  currencyCode?: string
  /** Present only when `trigger === 'locale_changed'`. */
  locale?: string
  /**
   * (Step 7.1) The route-edge-resolved context, when the caller has one on hand —
   * `cart.get`'s own trigger dispatch always supplies it (`buildCartRepriceInputForTrigger`
   * below). Used ONLY to resolve `routeContext.assortmentScope` for the promotions phase's
   * `ADD_FREE_ITEM` gift-line visibility check (§6a.1b/§6a.1c, mirroring `cart.lines.add`'s
   * own per-line check) — never re-derives channel/store/buyer fields onto `cart` itself
   * (that is `applyCartRepriceTriggerFields`'s job for trigger 2 specifically). A direct,
   * non-trigger caller that omits this gets no assortment enforcement on a NEW gift line for
   * this call (scope `undefined` reads as "nothing to check against", same as every other
   * exempt-by-construction path in this module) — the whole-cart re-visibility PASS (§6a.2)
   * is Step 7.4's job, not this one's.
   */
  routeContext?: ResolvedCartRouteContext
}

export type CartRepriceResult = {
  cart: CartSummary
  priceChanges: CartPriceChange[]
  /** (Step 7.1) A gift effect this reprice could not materialize into a line — e.g. an
   * `ADD_FREE_ITEM` effect whose product failed the buyer's assortment scope. Mirrors
   * `priceChanges`: present only when non-empty. */
  warnings?: CartPromotionWarning[]
}

function applyCartRepriceTriggerFields(cart: Cart, input: CartRepriceInput): void {
  if (input.trigger === 'buyer_context_changed') {
    if (input.buyerDigest !== undefined) cart.buyerDigest = input.buyerDigest
    cart.customerId = input.customerId ?? null
    cart.customerIds = input.customerIds ?? null
    cart.customerUserId = input.customerUserId ?? null
    cart.customerGroupIds = input.customerGroupIds ?? []
    cart.priceKindId = input.priceKindId ?? null
  } else if (input.trigger === 'currency_changed' && input.currencyCode) {
    cart.currencyCode = input.currencyCode
  } else if (input.trigger === 'locale_changed' && input.locale) {
    cart.locale = input.locale
  }
}

const cartLineRepriceIndexer: CrudIndexerConfig<CartLine> = { entityType: E.cart.cart_line }

/**
 * Re-snapshots every non-deleted `CartLine` and recomputes `Cart.totals` as a real
 * whole-cart aggregate (§3.2) — closing the gap flagged in NOTIFY.md since Step 4.7/4.9.
 *
 * Per §3.1a's command-undo table: **not undoable**. Re-pricing to a stale price is never a
 * state a client would want restored — no `undo` handler and, consistent with
 * `commands/lines.ts`'s identical treatment of `cart.lines.update` (also non-undoable, also
 * no `buildLog`), no audit log entry either.
 */
const repriceCartCommand: CommandHandler<CartRepriceInput, CartRepriceResult> = {
  id: 'cart.reprice',
  isUndoable: false,
  async execute(input, ctx) {
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await findOneWithDecryption(
      em,
      Cart,
      { id: input.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
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

    const now = new Date()
    const changes: CartPriceChange[] = []
    const touched: CartLine[] = []
    const adjustments: SalesAdjustmentDraft[] = []
    const promotionWarnings: CartPromotionWarning[] = []
    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    // Step 7.4 — §6a.2's whole-cart re-visibility pass accumulators.
    const revisibilityFlagged: CartLine[] = []
    const revisibilityCleared: CartLine[] = []

    const applyTriggerFieldsPhase = async () => {
      applyCartRepriceTriggerFields(cart, input)
    }

    // Step 7.1 — §6/§6a: `promotionsService.evaluate()` resolves tenant/org scope from
    // whatever is registered under the `auth` DI token on ITS OWN container
    // (`promotions/lib/promotions-service.ts`'s `resolvePromotionsServiceScope`), the same
    // convention that module's own HTTP routes already follow (`api/evaluate/route.ts`).
    // `cart.reprice` is the one internal caller that mirrors it: register BEFORE resolving
    // the service, inside the command rather than at a route edge, since this command runs
    // from multiple entry points (`cart.get`'s internal dispatch today, `cart.lock` in a
    // later step) and an internal caller should not have to remember to do it itself.
    //
    // Moved ahead of `linePhases`/`promotionsPhase` at Step 7.4: §6a.2's whole-cart
    // re-visibility pass below needs this SAME resolved scope — reused, never re-derived.
    ctx.container.register({ auth: asValue({ tenantId: cart.tenantId, orgId: cart.organizationId }) })
    const rawAssortmentScope = input.routeContext?.assortmentScope
    const assortmentScope = shouldEnforceAssortmentScope(cart.channel, rawAssortmentScope) ? rawAssortmentScope : undefined

    // Step 7.4 — §6a.2: gated to trigger 2 (`buyer_context_changed`) and the mandatory
    // post-merge reprice (`trigger: 'merge'`, §7.3's own "this is exactly the case trigger 2
    // exists for"). The `'merge'` half closes a real residual R13 bypass found during this
    // step's own review: §6a.5's pass in `commands/merge.ts` only re-checks INCOMING lines
    // during a `sum`/`union`/`conflict` merge (rows 3-5) — it is never reached at all for
    // an ADOPT (row 1, target empty) merge, where the SURVIVOR is the source cart itself and
    // its pre-existing lines are carried over untouched. An `agent`/`api`-channel cart's
    // lines never passed the add-time per-line check (§6a.4's exemption) — if such a cart's
    // token were ever presented as `cart.merge`'s `sourceToken` against an empty session
    // cart, adoption would make it the live, scope-enforced cart with its own unchecked
    // lines still in it, exactly R13's attack shape via a different row of the policy table.
    // Running this phase on every `'merge'`-triggered reprice closes that gap for free: a
    // rejected-row-3-5 incoming line was never added to `lines` in the first place (nothing
    // to double-process), rows 1/2's survivor lines ARE now re-checked, and §6a.2's own
    // "whole-cart" framing is honored literally (every line, not just the ones a particular
    // merge happened to add this cycle) as a bonus defense-in-depth property.
    // §6a.2 also names trigger 5 (checkout requests a lock) as a third call site — Step 7.5
    // closes it: `commands/lock.ts`'s `cart.lock` dispatches this command with
    // `trigger: 'lock'` specifically so this SAME pass runs with a freshly-resolved buyer
    // context (§9, D-R4-22) before `cart.lock` ever checks for a still-flagged line.
    const runWholeCartRevisibilityPass =
      (input.trigger === 'buyer_context_changed' || input.trigger === 'merge' || input.trigger === 'lock') &&
      assortmentScope !== undefined
    const wholeCartRevisibilityPhases: Array<() => Promise<void>> = runWholeCartRevisibilityPass
      ? [
          buildWholeCartRevisibilityPhase({
            em,
            container: ctx.container,
            lines,
            scope: assortmentScope,
            tenantScope: scope,
            flagged: revisibilityFlagged,
            cleared: revisibilityCleared,
          }),
        ]
      : []

    // Runs AFTER the re-visibility pass above (array order) so a line this cycle just
    // flagged is excluded from its own re-pricing (§4.2/§6a.2) — `buildCartLineRepricePhases`
    // checks `flagState` again at each line's own EXECUTION time (not only via its eager
    // `origin` filter), so this composes correctly regardless of whether the re-visibility
    // phase actually ran for this call.
    const linePhases = buildCartLineRepricePhases(em, ctx.container, cart, lines, input.trigger, now, changes, touched)

    // Step 7.4 — trigger 6 (§5.2: "a promotion is applied or removed — effects only, not
    // unit prices"): `linePhases` re-resolves every line's CATALOG unit price via
    // `catalogBuyerPricingService.resolveLinePrice`, which is exactly what trigger 6 says
    // must NOT happen. The promotions phase (discount/effects) and the totals phase still
    // run unconditionally below — only this catalog-price re-resolution phase is skipped.
    const effectiveLinePhases: Array<() => Promise<void>> =
      input.trigger === 'promotion_applied' || input.trigger === 'promotion_removed' ? [] : linePhases

    const promotionsPhase = buildPromotionsEffectsPhase({
      em,
      container: ctx.container,
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

    // `lines` is mutated in place by `promotionsPhase` (gift lines pushed/removed) — the
    // totals phase closes over the SAME array reference and filters/maps it at its own
    // execution time (after `promotionsPhase` has already run), so it always sees the
    // current set without a second DB round trip.
    const totalsPhase = buildRecomputeCartTotalsPhase(ctx.container, cart, lines, now, changes, adjustments)

    // §3.1a: "mutates Cart/CartLine/CartPromotionApplication inside
    // withAtomicFlush(em, phases, { transaction: true, label: 'cart.<op>' })" — one
    // transaction spanning the buyer-context field update, the re-visibility pass, every
    // line's re-price, the promotions phase, and the final totals recompute, so a partial
    // re-price (some lines priced, the totals pass never ran) can never persist.
    await withAtomicFlush(
      em,
      [applyTriggerFieldsPhase, ...wholeCartRevisibilityPhases, ...effectiveLinePhases, promotionsPhase, totalsPhase],
      {
        transaction: true,
        label: 'cart.reprice',
      },
    )

    // Side effects fire after the atomic flush commits, never inside it.
    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: cart,
      identifiers: getCartIdentifiers(cart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })
    for (const line of touched) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: line,
        identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
        indexer: cartLineRepriceIndexer,
      })
      await emitCartEvent('cart.line.updated', {
        id: line.id,
        cartId: line.cartId,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      })
    }
    // Step 7.4 — §6a.2: a newly-flagged or newly-cleared line's own `flag_state` changed,
    // independently of whether `touched` (above) also covers it (a cleared line becomes
    // eligible for `linePhases` again THIS same cycle and may land in `touched` too — a
    // harmless, redundant re-index/re-emit for that one line, not a correctness issue).
    for (const line of [...revisibilityFlagged, ...revisibilityCleared]) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'updated',
        entity: line,
        identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
        indexer: cartLineRepriceIndexer,
      })
      await emitCartEvent('cart.line.updated', {
        id: line.id,
        cartId: line.cartId,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      })
    }
    if (revisibilityFlagged.length > 0) {
      // D-R4-23 — the operator-facing signal, `triggeredBy: 'reprice'`. The buyer-facing
      // `product_unavailable` warning itself is NOT re-emitted here on `CartRepriceResult`:
      // `lib/cartView.ts`'s `buildFlaggedLineWarnings` already derives it LIVE from
      // `CartLine.flagState` on every `/current/*` read, regardless of which pass set the
      // flag — a second, duplicate warning entry from this specific pass would be redundant.
      await emitVisibilityRejectedEvent(cart, revisibilityFlagged.length, 'reprice')
    }
    for (const line of createdGiftLines) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'created',
        entity: line,
        identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
        indexer: cartLineRepriceIndexer,
      })
      await emitCartEvent('cart.line.added', {
        id: line.id,
        cartId: line.cartId,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      })
    }
    for (const line of removedGiftLines) {
      await emitCrudSideEffects({
        dataEngine,
        action: 'deleted',
        entity: line,
        identifiers: { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId },
        indexer: cartLineRepriceIndexer,
      })
      await emitCartEvent('cart.line.removed', {
        id: line.id,
        cartId: line.cartId,
        organizationId: line.organizationId,
        tenantId: line.tenantId,
      })
    }
    if (changes.length > 0) {
      await emitCartEvent('cart.price.changed', {
        cartId: cart.id,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        changes,
      })
    }
    // Step 7.2 — D-R4-8: a lapsed code reservation surfaces as a `promotion_no_longer_valid`
    // warning (already in `promotionWarnings`, merged below) AND this event, emitted after
    // the atomic flush commits — never inside `buildPromotionsEffectsPhase` itself, same
    // "side effects fire after commit" rule the gift-line events above already follow.
    for (const warning of promotionWarnings) {
      if (warning.code !== 'promotion_no_longer_valid') continue
      await emitCartEvent('cart.promotion.no_longer_valid', {
        cartId: cart.id,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
        promotionId: warning.promotionId,
      })
    }

    return {
      cart: toCartSummary(cart),
      priceChanges: changes,
      ...(promotionWarnings.length > 0 ? { warnings: promotionWarnings } : {}),
    }
  },
}

registerCommand(createCartCommand)
registerCommand(getCartCommand)
registerCommand(repriceCartCommand)

export { createCartCommand, getCartCommand, repriceCartCommand }
export type { CartPriceChange, CartPriceChangeReason }
