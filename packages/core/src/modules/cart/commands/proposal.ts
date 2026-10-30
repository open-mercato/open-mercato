import { randomUUID } from 'crypto'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { badRequest, CrudHttpError, forbidden, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { E } from '#generated/entities.ids.generated'

import { CatalogProduct, CatalogProductVariant } from '@open-mercato/core/modules/catalog/data/entities'
import { filterRowsForVariant } from '@open-mercato/core/modules/catalog/lib/pricing'

import { Cart, CartLine, CartPromotionApplication } from '../data/entities'
import type { CartLineActorType, CartStatus } from '../data/entities'
import {
  CART_PROPOSAL_DEFAULT_TTL_SECONDS,
  cartProposalCreateLinesSchema,
  cartProposalCreateTtlSecondsSchema,
} from '../data/validators'
import { generateCartToken } from '../lib/token'
import { assertCartNotLocked } from '../lib/lockGuard'
import { shouldEnforceAssortmentScope } from '../lib/routeContext'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { cartVisibilityKey, evaluateCartVisibility, isVisible } from '../lib/visibility'
import type { CartVisibilityLineRef } from '../lib/visibility'
import type { CartPromotionWarning } from '../lib/promotionContext'
import { emitCartEvent } from '../events'
import { isAcceptanceTokenFresh, signAcceptanceToken, verifyAcceptanceToken } from '../lib/acceptanceToken'
import { buildProposalAcceptancePreview } from '../lib/proposalPreview'
import type { ProposalAcceptancePreview } from '../lib/proposalPreview'
import { mergeCartCommand } from './merge'
import type { CartMergeInput, CartMergeResult } from './merge'
import {
  applyPriceSnapshot,
  buildCartPricingRowFilterContext,
  buildCartPromotionsAndTotalsPhases,
  checkQuantityRule,
  computeLineTotals,
  emitCartPromotionsAndTotalsSideEffects,
  emitVisibilityRejectedEvent,
  fetchPriceRowsBatch,
  groupRowsByProduct,
  resolveLinePricing,
  resolveQuantityRulesForProduct,
  resolveSnapshotFields,
  toCartLineSnapshot,
} from './lines'
import type { CartLineSnapshot } from './lines'

// Step 3.3 (rev 10 §7a — S5/S11/S13/S14/D-R5-14) — the proposal seam's first two COMMANDS,
// `cart.proposal.create` (§7a.2) and `cart.proposal.reject` (§7a.5).
//
// Step 3.4 adds the third, `cart.proposal.accept` (§7a.4), plus the HTTP routes under
// `/api/cart/proposals/*` (`lib/currentCartRoute.ts#resolveIdentifiedBasketByToken`,
// D-R5-13/D-R5-21) and the sweeper branches for `kind = 'proposal'` (`lib/sweepers.ts`,
// K15/S15) — none of which live in this file. `cart.proposal.accept` is a thin wrapper per
// §3.1a's own text ("`cart.proposal.accept` delegates to `cart.merge`; it is not a second
// merge implementation") — the actual per-line acceptance mechanics (visibility re-check,
// `CartMergeLog`, the mandatory whole-cart re-price) live in `commands/merge.ts`'s own
// `proposalCartId`/`lines` input variant, reusing the SAME `buildMergeOutcome` helper the
// ordinary guest-merge path already uses and tests.
//
// §7a.5's own text: "The author's side ends a proposal in-process: `assisted_selling`
// withdraw, supersede and re-author call `cart.proposal.reject`... There is no separate
// `cart.proposal.withdraw`/`.supersede` command — every author-side ending of a proposal IS
// a call to THIS `reject` command, distinguished only by `rejectedBy`. See NOTIFY.md's Step
// 3.3 entry for the full reasoning behind this (the task brief's own "withdraw" language is
// the spec's `reject(rejectedBy: 'author')`, not a fourth command).

const CART_ENTITY_ID = E.cart.cart
const CART_LINE_ENTITY_ID = E.cart.cart_line

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

type ProposalScope = { tenantId: string; organizationId: string }

function getCartIdentifiers(cart: Cart) {
  return { id: cart.id, organizationId: cart.organizationId, tenantId: cart.tenantId }
}

function getCartLineIdentifiers(line: CartLine) {
  return { id: line.id, organizationId: line.organizationId, tenantId: line.tenantId }
}

/**
 * §10.3: "`cart.proposals.author` gates the write and nothing else" — the one ACL feature
 * both commands in this file check, mirroring `commands/cart.ts`'s own `requireChannelFeature`
 * (wildcard-aware via `rbacService.userHasAllFeatures`, never a plain array `includes`, per
 * the lesson `feature-gated-runtime-helpers-must-use-wildcard-aware`).
 */
async function requireProposalAuthorFeature(ctx: CommandRuntimeContext, scope: ProposalScope): Promise<void> {
  const auth = ctx.auth
  if (!auth?.sub || !auth.tenantId) {
    throw forbidden('[internal] this action requires an authenticated principal holding "cart.proposals.author"')
  }
  const rbac = ctx.container.resolve('rbacService') as RbacService | null
  const granted =
    !!rbac &&
    (await rbac.userHasAllFeatures(auth.sub, ['cart.proposals.author'], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }))
  if (!granted) {
    throw forbidden('[internal] Missing required feature "cart.proposals.author"')
  }
}

/** Mirrors `commands/cart.ts`'s identically-named helper — duplicated at this file's own
 * small scope per this module's established precedent (`lib/reprice.ts`'s own header
 * comment: "Deliberately duplicates... rather than exporting and importing"). */
function resolveAuthenticatedScope(ctx: CommandRuntimeContext): ProposalScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId || !organizationId) {
    throw badRequest('[internal] Tenant and organization scope are required to author a proposal')
  }
  return { tenantId, organizationId }
}

// ---------------------------------------------------------------------------
// cart.proposal.create (§7a.2)
// ---------------------------------------------------------------------------

export type CartProposalCreateLineInput = {
  productId: string
  variantId?: string | null
  quantity: string
  configuration?: Record<string, unknown> | null
}

/**
 * Step 4.4 (`assisted_selling`, §6.3 step 2): the ONE field of `ResolvedCartRouteContext` this
 * command actually reads (`input.routeContext?.assortmentScope`, below) — `target.channel` is
 * read off the TARGET `Cart` itself, never off this input. Narrowed from the full branded
 * `ResolvedCartRouteContext` (Step 3.3's own original typing) to the shape its real trusted
 * caller, `storeContextService.resolveForBuyer` (SPEC-029 §6.3), actually produces:
 * `ResolveForBuyerResult` has no `channel`/`currencyCode`(required)/`locale`/`salesChannelId`
 * fields shaped like the HTTP-route-edge-only `ResolvedCartRouteContext` (`cart/lib/
 * routeContext.ts`, built exclusively by `resolveCartRouteContext(request, …)`), so a trusted,
 * non-HTTP caller could never literally construct one. Backward compatible: any existing
 * caller that already builds a full `ResolvedCartRouteContext` (there are none yet — `commands/
 * proposal.ts`'s own header comment and `api/proposals/route.ts` both omit `routeContext`
 * entirely) still satisfies this narrower structural type unchanged.
 */
export type CartProposalRouteContext = Pick<ResolvedCartRouteContext, 'assortmentScope'>

export type CartProposalCreateInput = {
  targetCartId: string
  lines: CartProposalCreateLineInput[]
  /** Bounded 3600..1_209_600, default 259_200 (72h) — §7a.3/S5. `cart` reads no store
   * setting; the caller (in Release 5, nothing yet — `assisted_selling` Phase 1) owns it. */
  ttlSeconds?: number
  /** The TARGET buyer's scope, resolved server-side by the trusted caller
   * (`storeContextService.resolveForBuyer`) — required when the target cart's channel is
   * `storefront` (§7a.2). Never constructed from request input (§6a.1a's branding rule). */
  routeContext?: CartProposalRouteContext
}

export type CartProposalRejectedLine = {
  productId: string
  variantId: string | null
  reason: 'product_unavailable'
}

export type CartProposalCreateResult = {
  proposalCartId: string
  tenantId: string
  organizationId: string
  lines: CartLineSnapshot[]
  totals: Record<string, unknown>
  warnings?: Array<{ code: string; message: string }>
  /** Reported to the author, never silently dropped (S13/K13). */
  rejectedLines: CartProposalRejectedLine[]
}

const EMPTY_PROPOSAL_TOTALS: Record<string, unknown> = {
  subtotalNetAmount: 0,
  subtotalGrossAmount: 0,
  discountTotalAmount: 0,
  taxTotalAmount: 0,
  grandTotalNetAmount: 0,
  grandTotalGrossAmount: 0,
}

function buildProposalLineMergeKey(productId: string, variantId: string | null, configuration: Record<string, unknown> | null): string {
  return `${productId}:${variantId ?? ''}:${JSON.stringify(configuration ?? null)}`
}

const createProposalCommand: CommandHandler<CartProposalCreateInput, CartProposalCreateResult> = {
  id: 'cart.proposal.create',
  // Authoring a proposal is not a buyer-visible content change on any cart a buyer owns
  // (the proposal cart is unaddressable, §7a.1) — no `undo` handler, same treatment as
  // `cart.create` in `commands/cart.ts`.
  isUndoable: false,
  async execute(input, ctx) {
    // R15/§10: "a valid cart token with no authenticated principal returns 401; with a
    // principal lacking `cart.proposals.author`, 403" — the ROUTE (Step 3.4) answers the
    // former; this command answers the latter, but refuses the "no principal at all" case
    // the same way (403) rather than letting it fall through to `resolveAuthenticatedScope`'s
    // generic 400 (missing scope), which would hide the real reason.
    const authorActorId = ctx.auth?.sub
    if (!authorActorId) {
      throw forbidden('[internal] this action requires an authenticated principal holding "cart.proposals.author"')
    }
    const scope = resolveAuthenticatedScope(ctx)
    await requireProposalAuthorFeature(ctx, scope)
    // Release 5 (S10): `mode: rep | off` only, no AI agent participant is ever created, so
    // the one real actor type a staff `auth.User` principal ever writes here is `'rep'`.
    const authorActorType: CartLineActorType = 'rep'

    const lines = cartProposalCreateLinesSchema.parse(input.lines)
    const ttlSecondsInput = cartProposalCreateTtlSecondsSchema.parse(input.ttlSeconds)
    const ttlSeconds = ttlSecondsInput ?? CART_PROPOSAL_DEFAULT_TTL_SECONDS

    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const target = await findOneWithDecryption(
      em,
      Cart,
      { id: input.targetCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
      {},
      scope,
    )
    if (!target) throw notFound('[internal] target cart not found')
    // §7a.2: "A `locked` target refuses with `423 cart_locked`" — checked before the
    // generic status gate, same ordering every other mutating command in this module uses.
    assertCartNotLocked(target)
    // "a `merged`, `expired` or `converted` target with `409 cart_not_active`. Proposing
    // into an `abandoned` basket does not reactivate it: authoring is not buyer activity" —
    // unlike every ordinary basket mutation, this never calls `recordBasketMutationActivity`.
    if (target.status !== 'active' && target.status !== 'abandoned') {
      throw new CrudHttpError(409, { error: '[internal] cart_not_active', code: 'cart_not_active', status: target.status })
    }

    if (target.channel === 'storefront' && !input.routeContext) {
      throw new CrudHttpError(400, {
        error: '[internal] assortment_scope_required_for_storefront_channel',
        code: 'assortment_scope_required_for_storefront_channel',
      })
    }
    const assortmentScope = shouldEnforceAssortmentScope(target.channel, input.routeContext?.assortmentScope)
      ? input.routeContext?.assortmentScope
      : undefined

    // ---- §6a.1b visibility pass against the TARGET buyer's scope (S13/K13) — one batched
    // call, never one-at-a-time ----
    const visibilityRefs: CartVisibilityLineRef[] = lines.map((entry) => ({
      productId: entry.productId,
      variantId: entry.variantId ?? null,
    }))
    const visibility = await evaluateCartVisibility({
      lines: visibilityRefs,
      scope: assortmentScope,
      tenantScope: scope,
      em,
      container: ctx.container,
    })

    const rejectedLines: CartProposalRejectedLine[] = []
    const admissible: Array<{ entry: CartProposalCreateLineInput; quantity: number }> = []
    for (const entry of lines) {
      const variantId = entry.variantId ?? null
      const quantity = Number(entry.quantity)
      const visible =
        Number.isFinite(quantity) &&
        quantity > 0 &&
        isVisible(visibility.get(cartVisibilityKey({ productId: entry.productId, variantId })) ?? 'unavailable')
      if (!visible) {
        rejectedLines.push({ productId: entry.productId, variantId, reason: 'product_unavailable' })
        continue
      }
      admissible.push({ entry, quantity })
    }

    // D-R4-23/S13: emitted once per REQUEST, counting ONLY the visibility rejections above
    // — never the quantity-rule/not-priceable rejections the second pass below may still add
    // to `rejectedLines`. `cartId` is the TARGET basket: "since no proposal cart may exist
    // yet" (§11), true whether or not one ends up created by the end of this call.
    await emitVisibilityRejectedEvent(target, rejectedLines.length, 'proposal_create')

    if (admissible.length === 0) {
      throw new CrudHttpError(422, { error: '[internal] proposal_empty', code: 'proposal_empty', rejectedLines })
    }

    // ---- within-this-call merge: two input entries for the same (product, variant,
    // configuration) must not collide on `cart_lines_unique_line_key` ----
    const mergedByKey = new Map<string, { entry: CartProposalCreateLineInput; quantity: number }>()
    for (const item of admissible) {
      const key = buildProposalLineMergeKey(item.entry.productId, item.entry.variantId ?? null, item.entry.configuration ?? null)
      const existing = mergedByKey.get(key)
      if (existing) existing.quantity += item.quantity
      else mergedByKey.set(key, { ...item })
    }

    // ---- batched product/variant reads (never one-at-a-time, same discipline as
    // `cart.lines.bulkAdd`) ----
    const productIds = Array.from(new Set(Array.from(mergedByKey.values()).map((item) => item.entry.productId)))
    const products = (await findWithDecryption(
      em,
      CatalogProduct,
      { id: { $in: productIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, isActive: true },
      {},
      scope,
    )) as CatalogProduct[]
    const productsById = new Map(products.map((product) => [product.id, product]))

    const variantIds = Array.from(
      new Set(Array.from(mergedByKey.values()).map((item) => item.entry.variantId).filter((id): id is string => !!id)),
    )
    const variants = variantIds.length
      ? ((await findWithDecryption(
          em,
          CatalogProductVariant,
          { id: { $in: variantIds }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, isActive: true },
          {},
          scope,
        )) as CatalogProductVariant[])
      : []
    const variantsById = new Map(variants.map((variant) => [variant.id, variant]))

    const now = new Date()
    const { tokenHash } = generateCartToken()
    // §7a.1: "A proposal cart holds a `token_hash` only to satisfy the unique column; it is
    // never returned by any route, command result or event" — the plaintext is discarded.
    // `Cart.id` is a DB-side `gen_random_uuid()` default (never assigned client-side by
    // `em.create`), but the lines built below need `proposalCart.id` as their `cartId` FK
    // before this cart is ever flushed (both are persisted together in the single
    // `withAtomicFlush` transaction further down). Assign it explicitly so it exists now —
    // same house pattern as `warranty_claims/commands/claims.ts`'s parent+child creates.
    const proposalCart = em.create(Cart, {
      id: randomUUID(),
      organizationId: target.organizationId,
      tenantId: target.tenantId,
      tokenHash,
      storeId: target.storeId,
      channel: target.channel,
      kind: 'proposal' as const,
      proposedToCartId: target.id,
      salesChannelId: target.salesChannelId,
      status: 'active' as const,
      // §7a.2: "the proposal cart is created carrying the target's `customer_id`,
      // `customer_user_id`, `customer_group_ids`, `price_kind_id`, `currency_code`,
      // `locale`, `tax_mode`... copied at creation and re-derived from the target on every
      // re-price. The author's own identity, group membership and price kind never enter
      // pricing at any point."
      currencyCode: target.currencyCode,
      locale: target.locale,
      customerId: target.customerId ?? null,
      customerIds: target.customerIds ?? null,
      customerUserId: target.customerUserId ?? null,
      customerGroupIds: target.customerGroupIds,
      priceKindId: target.priceKindId ?? null,
      taxMode: target.taxMode,
      email: null,
      note: null,
      assortmentScopeHash: null,
      promotionEffects: null,
      metadata: null,
      buyerDigest: target.buyerDigest,
      totals: { ...EMPTY_PROPOSAL_TOTALS },
      totalsComputedAt: now,
      requiresApproval: false,
      approvalId: null,
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    })

    const pricingContext = buildCartPricingRowFilterContext(proposalCart)
    const priceRows = await fetchPriceRowsBatch(em, scope, pricingContext, productIds, variantIds)
    const variantToProduct = new Map<string, string>()
    for (const item of mergedByKey.values()) {
      if (item.entry.variantId) variantToProduct.set(item.entry.variantId, item.entry.productId)
    }
    const rowsByProduct = groupRowsByProduct(priceRows, variantToProduct)

    const newLines: CartLine[] = []
    let nextLineNumber = 1
    for (const { entry, quantity } of mergedByKey.values()) {
      const variantId = entry.variantId ?? null
      const product = productsById.get(entry.productId)
      if (!product) {
        rejectedLines.push({ productId: entry.productId, variantId, reason: 'product_unavailable' })
        continue
      }
      const variant = variantId ? variantsById.get(variantId) ?? null : null
      if (variantId && !variant) {
        rejectedLines.push({ productId: entry.productId, variantId, reason: 'product_unavailable' })
        continue
      }
      const rules = await resolveQuantityRulesForProduct(em, ctx.container, scope, proposalCart.storeId ?? null, product, variantId)
      const check = checkQuantityRule(rules, quantity)
      if (check.status === 'rejected') {
        rejectedLines.push({ productId: entry.productId, variantId, reason: 'product_unavailable' })
        continue
      }
      const acceptedQuantity = check.quantity
      const rows = filterRowsForVariant(rowsByProduct.get(entry.productId) ?? [], variantId)
      const resolved = await resolveLinePricing(em, ctx.container, proposalCart, rows, acceptedQuantity, now)
      if (!resolved.priceRow) {
        rejectedLines.push({ productId: entry.productId, variantId, reason: 'product_unavailable' })
        continue
      }

      const fields = resolveSnapshotFields(product, variant, entry.configuration ?? null, null)
      const newLine = em.create(CartLine, {
        organizationId: proposalCart.organizationId,
        tenantId: proposalCart.tenantId,
        cartId: proposalCart.id,
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
        // R16: the authenticated principal, never the request body (`addedByActorId` on
        // any input would be ignored — this input type carries no such field at all).
        addedByActorType: authorActorType,
        addedByActorId: authorActorId,
        metadata: fields.metadata,
        pricedAt: now,
        lineTotals: {},
      })
      applyPriceSnapshot(newLine, resolved, now)
      newLine.lineTotals = await computeLineTotals(ctx.container, proposalCart, {
        productId: fields.productId,
        variantId: fields.variantId,
        name: fields.name,
        quantity: acceptedQuantity,
        unitPriceNet: resolved.amountNet,
        unitPriceGross: resolved.amountGross,
        taxRate: resolved.taxRatePercent,
        configuration: fields.configuration,
      })
      newLines.push(newLine)
    }

    // The quantity-rule/not-priceable/missing-product pass above can itself exhaust every
    // admissible line (e.g. every surviving product is un-priceable for this buyer) — same
    // "no admissible line, no cart" refusal as the visibility-only case above.
    if (newLines.length === 0) {
      throw new CrudHttpError(422, { error: '[internal] proposal_empty', code: 'proposal_empty', rejectedLines })
    }

    const createdGiftLines: CartLine[] = []
    const removedGiftLines: CartLine[] = []
    const promotionWarnings: CartPromotionWarning[] = []

    await withAtomicFlush(
      em,
      [
        async () => {
          em.persist(proposalCart)
          for (const line of newLines) em.persist(line)
        },
        // S14/K14: "No promotion codes... Automatic promotions are evaluated as for any
        // cart" — the SAME phase builder every other cart write uses, never a parallel
        // re-implementation. A brand-new proposal cart has no `CartPromotionApplication`
        // rows to read, so only automatic (non-code) promotions can ever apply here.
        ...buildCartPromotionsAndTotalsPhases({
          em,
          container: ctx.container,
          cart: proposalCart,
          scope,
          assortmentScope,
          now,
          createdGiftLines,
          removedGiftLines,
          promotionWarnings,
        }),
      ],
      { transaction: true, label: 'cart.proposal.create' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: proposalCart,
      identifiers: getCartIdentifiers(proposalCart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })
    for (const line of newLines) {
      await emitCrudSideEffects({ dataEngine, action: 'created', entity: line, identifiers: getCartLineIdentifiers(line), indexer: cartLineCrudIndexer })
      await emitCartEvent('cart.line.added', { id: line.id, cartId: line.cartId, organizationId: line.organizationId, tenantId: line.tenantId })
    }
    await emitCartPromotionsAndTotalsSideEffects(dataEngine, proposalCart, { createdGiftLines, removedGiftLines, promotionWarnings })

    // §11: `{ proposalCartId, targetCartId, tenantId, organizationId, authoredByActorType,
    // authoredByActorId, lineCount }` — the author read from the lines just written, not a
    // separate stored field (§4.1: "`Cart` has no `authored_by_*` column").
    await emitCartEvent('cart.proposal.created', {
      proposalCartId: proposalCart.id,
      targetCartId: target.id,
      tenantId: proposalCart.tenantId,
      organizationId: proposalCart.organizationId,
      authoredByActorType: authorActorType,
      authoredByActorId: authorActorId,
      lineCount: newLines.length,
    })

    const warnings =
      rejectedLines.length > 0
        ? rejectedLines.map((line) => ({
            code: 'product_unavailable',
            message: `[internal] product ${line.productId}${line.variantId ? `/${line.variantId}` : ''} is not available to this buyer`,
          }))
        : undefined

    return {
      proposalCartId: proposalCart.id,
      tenantId: proposalCart.tenantId,
      organizationId: proposalCart.organizationId,
      lines: newLines.map(toCartLineSnapshot),
      totals: proposalCart.totals,
      ...(warnings ? { warnings } : {}),
      rejectedLines,
    }
  },
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.proposal.create', 'Author proposal cart'),
      resourceKind: 'cart.cart',
      resourceId: result.proposalCartId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
    }
  },
}

// ---------------------------------------------------------------------------
// cart.proposal.reject (§7a.5)
// ---------------------------------------------------------------------------

export type CartProposalRejectInput = {
  proposalCartId: string
  tenantId: string
  organizationId: string
  /** Who ended it — read live off the caller, never inferred: the buyer-facing route
   * (Step 3.4, token-bound) passes `'buyer'`; every author-side ending (withdraw, supersede,
   * re-author — §7a.5's "two callers") passes `'author'`. */
  rejectedBy: 'buyer' | 'author'
}

export type CartProposalRejectResult = {
  proposalCartId: string
  status: CartStatus
  /** `true` when this call found the proposal already non-`active` (a no-op per §7a.5:
   * "Rejecting a proposal that is not active is a no-op that returns its current status"). */
  alreadyResolved: boolean
}

/** `promotions/lib/code-service.ts#PromotionCodeService.releaseCode`'s own surface,
 * duck-typed exactly like `lib/sweepers.ts#CartCodeServiceLike` (K11's precedent) — never a
 * static `promotions` entity import. */
export type CartProposalCodeServiceLike = {
  releaseCode(em: EntityManager, codeId: string, cartId: string, scope: ProposalScope): Promise<void>
}

function tryResolveCodeService(container: { resolve: <T = unknown>(name: string) => T }): CartProposalCodeServiceLike | null {
  try {
    return container.resolve<CartProposalCodeServiceLike>('promotionCodeService') ?? null
  } catch {
    return null
  }
}

/** §4.1: the author is read off the proposal's own lines (`addedByActorType`/`_id`), never
 * a stored `Cart` column — same lookup `cart.proposal.created`'s payload needs at creation
 * time, re-derived here since `reject` does not have it on hand otherwise. Exported (Step
 * 3.4) — `cart.proposal.accept`'s own `cart.proposal.accepted` event needs the identical
 * lookup. */
export async function resolveProposalAuthor(
  em: EntityManager,
  scope: ProposalScope,
  proposalCartId: string,
): Promise<{ actorType: CartLineActorType | null; actorId: string | null; lineCount: number }> {
  const proposalLines = (await findWithDecryption(
    em,
    CartLine,
    { cartId: proposalCartId, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )) as CartLine[]
  const first = proposalLines[0] ?? null
  return {
    actorType: first?.addedByActorType ?? null,
    actorId: first?.addedByActorId ?? null,
    lineCount: proposalLines.length,
  }
}

const rejectProposalCommand: CommandHandler<CartProposalRejectInput, CartProposalRejectResult> = {
  id: 'cart.proposal.reject',
  // §7a.5: "It touches the target cart not at all — there is nothing to undo, because
  // nothing was ever merged." A terminal transition on a cart nobody else can address — no
  // `undo` handler, matching `cart.proposal.create`'s own treatment.
  isUndoable: false,
  async execute(input, ctx) {
    const scope: ProposalScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    // Defense in depth, same reasoning `cart.proposal.create` applies: re-checked whenever
    // the caller actually presents a real principal. A pure system actor (no `ctx.auth` at
    // all — `assisted_selling`'s own withdraw/reauthor-supersede and merge-retarget-supersede
    // paths, `assisted_selling/commands/proposals.ts` and `assisted_selling/lib/
    // reauthorOnMerge.ts`) is trusted by construction, the same trust model
    // `withdrawPendingCartApproval`'s `actor: { actorType: 'system' }` shape already uses for
    // a cart-initiated withdrawal.
    if (input.rejectedBy === 'author' && ctx.auth?.sub) {
      await requireProposalAuthorFeature(ctx, scope)
    }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const proposal = await findOneWithDecryption(
      em,
      Cart,
      { id: input.proposalCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'proposal' as const },
      {},
      scope,
    )
    if (!proposal) throw notFound('[internal] proposal cart not found')

    if (proposal.status !== 'active') {
      return { proposalCartId: proposal.id, status: proposal.status, alreadyResolved: true }
    }

    const author = await resolveProposalAuthor(em, scope, proposal.id)
    const now = new Date()
    proposal.status = 'abandoned'
    proposal.resolvedAt = now
    await em.flush()

    // S14/K14: release code reservations by `cartId` for every `CartPromotionApplication`
    // row — a proposal holds no codes in Release 5 (S14), so this finds nothing, but the
    // rule stays correct if codes are added later. Best-effort, same reasoning as
    // `lib/sweepers.ts#releaseCartCodeReservations`: the status transition already
    // committed, so a failed release here must not roll it back or fail this command.
    const codeService = tryResolveCodeService(ctx.container)
    if (codeService) {
      const applications = await em.find(
        CartPromotionApplication,
        { cartId: proposal.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
        { fields: ['codeId'] },
      )
      const codeIds = Array.from(
        new Set(applications.map((application) => application.codeId).filter((id): id is string => !!id)),
      )
      for (const codeId of codeIds) {
        try {
          await codeService.releaseCode(em, codeId, proposal.id, scope)
        } catch {
          // Best-effort — `promotions`' own TTL-based code-reservation sweeper is the
          // independent safety net, same precedent K11's sweeper wiring already set.
        }
      }
    }

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: proposal,
      identifiers: getCartIdentifiers(proposal),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })
    await emitCartEvent('cart.proposal.rejected', {
      proposalCartId: proposal.id,
      targetCartId: proposal.proposedToCartId ?? null,
      tenantId: proposal.tenantId,
      organizationId: proposal.organizationId,
      authoredByActorType: author.actorType,
      authoredByActorId: author.actorId,
      lineCount: author.lineCount,
      rejectedBy: input.rejectedBy,
    })

    return { proposalCartId: proposal.id, status: 'abandoned', alreadyResolved: false }
  },
  buildLog: async ({ result, input }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.proposal.reject', 'Reject proposal cart'),
      resourceKind: 'cart.cart',
      resourceId: result.proposalCartId,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { rejectedBy: input.rejectedBy },
    }
  },
}

// ---------------------------------------------------------------------------
// cart.proposal.accept (§7a.4) — Step 3.4
// ---------------------------------------------------------------------------
//
// §3.1a: "`cart.proposal.accept` delegates to `cart.merge`; it is not a second merge
// implementation." This command owns exactly the proposal-specific pieces §7a.4 names
// (resolving target+proposal, verifying the `acceptanceToken`'s freshness against BOTH
// carts' current `updatedAt`, re-minting a fresh preview+token on a mismatch) and hands the
// actual line selection off to `cart.merge`'s own `proposalCartId`/`lines` input variant
// (`commands/merge.ts`), which owns the merge mechanics (visibility re-check, outcome
// building, `CartMergeLog`, the mandatory whole-cart re-price) exactly as it already does
// for the ordinary guest-merge path.

export type CartProposalAcceptLineSelection = { proposalLineId: string; accepted: boolean }

export type CartProposalAcceptInput = {
  proposalCartId: string
  targetCartId: string
  tenantId: string
  organizationId: string
  /** Minted by `preview` (§7a.4) — "the token binds the target cart's `updatedAt` AND the
   * proposal cart's `updatedAt`. Either moving invalidates it." */
  acceptanceToken: string
  lines: CartProposalAcceptLineSelection[]
  routeContext: ResolvedCartRouteContext
}

export type CartProposalAcceptResult = {
  cart: CartMergeResult['cart']
  token: CartMergeResult['token']
  mergeSummary: CartMergeResult['mergeSummary']
  priceChanges: CartMergeResult['priceChanges']
  warnings?: CartMergeResult['warnings']
  acceptedLineCount: number
}

async function buildFreshAcceptanceChallenge(
  em: EntityManager,
  container: { resolve: <T = unknown>(name: string) => T },
  scope: ProposalScope,
  target: Cart,
  proposal: Cart,
  assortmentScope: ResolvedCartRouteContext['assortmentScope'] | undefined,
): Promise<{ acceptancePreview: ProposalAcceptancePreview; acceptanceToken: string }> {
  const acceptancePreview = await buildProposalAcceptancePreview({ em, container, scope, target, proposal, assortmentScope })
  const acceptanceToken = signAcceptanceToken({
    proposalCartId: proposal.id,
    targetCartId: target.id,
    proposalUpdatedAt: proposal.updatedAt.toISOString(),
    targetUpdatedAt: target.updatedAt.toISOString(),
  })
  return { acceptancePreview, acceptanceToken }
}

const acceptProposalCommand: CommandHandler<CartProposalAcceptInput, CartProposalAcceptResult> = {
  id: 'cart.proposal.accept',
  // Acceptance delegates to `cart.merge`, which already carries its own `isUndoable: true`
  // / `cart.mergeUndo` entry — this wrapper command adds no undo semantics of its own, and
  // §7a.7 (D-R5-25) refuses `cart.mergeUndo` for a proposal-sourced merge regardless of
  // which command initiated it.
  isUndoable: false,
  async execute(input, ctx) {
    const scope: ProposalScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const target = await findOneWithDecryption(
      em,
      Cart,
      { id: input.targetCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
      {},
      scope,
    )
    if (!target) throw notFound('[internal] cart not found')

    // §7a.4: "the route answers 404 unless that proposal's `proposed_to_cart_id` is the
    // presented token's basket — the same 404 a nonexistent id gets" (K10).
    const proposal = await findOneWithDecryption(
      em,
      Cart,
      { id: input.proposalCartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'proposal' as const, proposedToCartId: target.id },
      {},
      scope,
    )
    if (!proposal) throw notFound('[internal] proposal cart not found')

    const assortmentScope = shouldEnforceAssortmentScope(target.channel, input.routeContext.assortmentScope)
      ? input.routeContext.assortmentScope
      : undefined

    const payload = verifyAcceptanceToken(input.acceptanceToken)
    if (!payload || !isAcceptanceTokenFresh(payload, proposal, target)) {
      const fresh = await buildFreshAcceptanceChallenge(em, ctx.container, scope, target, proposal, assortmentScope)
      throw new CrudHttpError(409, { error: '[internal] proposal_changed', code: 'proposal_changed', ...fresh })
    }

    const author = await resolveProposalAuthor(em, scope, proposal.id)

    const commandBus = ctx.container.resolve('commandBus') as CommandBus
    const mergeInput = {
      targetCartId: target.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      proposalCartId: proposal.id,
      lines: input.lines,
      routeContext: input.routeContext,
    } as CartMergeInput
    const { result: mergeResult } = await commandBus.execute<CartMergeInput, CartMergeResult>(mergeCartCommand.id, {
      input: mergeInput,
      ctx,
    })

    const acceptedLineCount = input.lines.filter((entry) => entry.accepted).length

    // §11: "`.accepted` additionally carries `mergeLogId` and `acceptedLineCount`."
    await emitCartEvent('cart.proposal.accepted', {
      proposalCartId: proposal.id,
      targetCartId: target.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      authoredByActorType: author.actorType,
      authoredByActorId: author.actorId,
      lineCount: author.lineCount,
      mergeLogId: mergeResult.mergeSummary.mergeLogId,
      acceptedLineCount,
    })

    return {
      cart: mergeResult.cart,
      token: mergeResult.token,
      mergeSummary: mergeResult.mergeSummary,
      priceChanges: mergeResult.priceChanges,
      ...(mergeResult.warnings && mergeResult.warnings.length > 0 ? { warnings: mergeResult.warnings } : {}),
      acceptedLineCount,
    }
  },
  buildLog: async ({ result, input }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('cart.audit.proposal.accept', 'Accept proposal cart'),
      resourceKind: 'cart.cart',
      resourceId: result.cart.id,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { mergeLogId: result.mergeSummary.mergeLogId, acceptedLineCount: result.acceptedLineCount },
    }
  },
}

registerCommand(createProposalCommand)
registerCommand(rejectProposalCommand)
registerCommand(acceptProposalCommand)

export { createProposalCommand, rejectProposalCommand, acceptProposalCommand }
