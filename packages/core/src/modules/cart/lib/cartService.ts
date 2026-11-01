import type { EntityManager } from '@mikro-orm/postgresql'
import type { StoredMergeOutcomeEntry } from '../commands/merge'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lockCartCommand, markConvertedCommand, unlockCartCommand } from '../commands/lock'
import type {
  CartLockInput,
  CartLockResult,
  CartMarkConvertedInput,
  CartMarkConvertedResult,
  CartUnlockInput,
  CartUnlockResult,
} from '../commands/lock'
import { toCartSummary, type CartSummary } from '../commands/cart'
import { toCartLineSnapshot, type CartLineSnapshot } from '../commands/lines'
import { Cart, CartLine, CartMergeLog } from '../data/entities'
import { isCartStoreContextUnavailableError, resolveCartRouteContext } from './routeContext'
import { getCartSalesSnapshot, type CartSalesSnapshot, type GetCartSalesSnapshotInput } from './toSalesSnapshots'
import { hashCartToken } from './token'

// Step 7.5 — §9/§3.1a's own prose repeatedly says `cartService.lock`/`.unlock`/
// `.markConverted` ("checkout calls the DI service/command directly, in-process") — but
// this module has never built an actual `cartService` class before this step; every other
// "service-shaped" capability here is a plain command dispatched via
// `commandBus.execute(...)`. Mirrors `promotions/lib/promotions-service.ts`'s
// `PromotionsServiceImpl` (Step 2.6) at this module's own much smaller scale: a thin class
// wrapping `container.resolve('commandBus').execute(...)` per method, so the spec's own
// named call shape is real and callable for whenever `checkout` lands. The commands in
// `commands/lock.ts` remain the actual source of truth — this facade adds no logic of its
// own beyond resolving the command bus and building a minimal `CommandRuntimeContext`.

export type CartServiceContainer = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Release 5 Phase 4 (checkout C2). `cart.lock` itself only ever takes an ALREADY-resolved
 * `ResolvedCartRouteContext` (§6a.1a: "an internal, branded type... the ONLY function
 * permitted to construct one is `resolveCartRouteContext`"), so a cross-module caller like
 * `checkout` cannot build one directly without violating that invariant. `request` is this
 * facade's own additive input — when supplied (and `storeContextService` is available),
 * `lock()` resolves a fresh `ResolvedCartRouteContext` itself, in-module, and forwards it;
 * when absent, or when resolution fails because `ecommerce` is not registered, `routeContext`
 * stays whatever the caller already passed (usually `undefined`) — `cart.lock`'s own
 * storefront assertion (`commands/lock.ts`) is the backstop for a `storefront`-channel cart
 * that still has no context by the time the command runs.
 */
export type CartServiceLockInput = CartLockInput & { request?: Request | null }

/**
 * Step 4.4 (`assisted_selling`, S9/§6.1). `POST /threads` resolves the target basket "through
 * `cart`'s admin detail read — the same read `GET /api/cart/carts/:id` serves (K6), scoped to
 * the caller's `organizationIds`" (§6.1's own text) — a LIST, not the single `organizationId`
 * `cart.get` (the only other by-id read) accepts. No existing primitive supports a multi-org
 * scoped-by-list read without a direct `Cart` entity import, which root AGENTS.md forbids for a
 * cross-module caller. `organizationIds: null` means unrestricted (mirrors
 * `cart/lib/adminCartScope.ts#organizationIdsFromCartScope`'s own "null = unrestricted" contract,
 * reused by name in `assisted_selling`'s own copy of that helper).
 */
export type CartServiceGetForOrganizationsInput = {
  tenantId: string
  organizationIds: string[] | null
  cartId: string
}

/**
 * Step 4.4. `POST /proposals/:id/reauthor` (§6.4) re-authors "from the old one's lines" — a
 * `kind: 'proposal'` cart's own `CartLine` rows, read back into `cart.proposal.create`'s own
 * `CartProposalCreateLineInput` shape. No existing read exposes a proposal cart's lines to an
 * external caller either, for the identical "no direct ORM relationship across modules" reason.
 */
export type CartServiceGetProposalCartLinesInput = {
  tenantId: string
  organizationId: string
  proposalCartId: string
}

export type CartServiceProposalCartLine = {
  productId: string
  variantId: string | null
  quantity: string
  configuration: Record<string, unknown> | null
}

/**
 * Step 4.5 (`assisted_selling` §5.1/§6.2, D-R5-21). A bare `X-Cart-Token` carries no scope —
 * the FIRST of D-R5-21's two steps: "resolves the `X-Cart-Token` header to its basket cart
 * through `cart`'s DI service (`cartService.resolveBasketByToken`)... applies the
 * identified-buyer binding... then finds the thread." `Cart.tokenHash` is globally unique
 * (`@Unique(['tokenHash'])`, `data/entities.ts`), so this never dispatches `cart.get` and
 * never re-prices — it is the smallest possible read that lets a cross-module caller learn a
 * basket's tenant/organization/customerUserId from the token alone, mirroring this file's own
 * `peekCartCustomerUserId`-shaped precedent in `lib/currentCartRoute.ts` (which the SAME
 * identity check already runs once a scope is known).
 */
export type CartServiceResolveBasketByTokenInput = { token: string }

export type CartServiceResolvedBasketIdentity = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  status: Cart['status']
  customerId: string | null
  customerUserId: string | null
}

/**
 * Step 5.3 (`assisted_selling` §7.1/§7.2, S22). The rep console's proposal builder and thread
 * page must show "the buyer's resolved unit price with the `price_row_id` explanation... each
 * proposal line renders the buyer's resolved unit price... labelled as the buyer's" — the exact
 * `CartLine` columns `cart.proposal.create` already wrote when it priced the proposal cart AS
 * THE BUYER (§7a.2 there, R1). Reading those columns back (never recomputing) is what makes S22's
 * "byte-identical to the buyer's own `GET /api/cart/current` pricing" true by construction: it is
 * the same stored row, not an independent calculation that could drift from it.
 */
export type CartServiceGetProposalCartPricedLinesInput = {
  tenantId: string
  organizationId: string
  proposalCartId: string
}

export type CartServiceProposalCartPricedLine = Pick<
  CartLineSnapshot,
  | 'id'
  | 'productId'
  | 'variantId'
  | 'sku'
  | 'name'
  | 'quantity'
  | 'unitPriceNet'
  | 'unitPriceGross'
  | 'taxRate'
  | 'priceKindId'
  | 'priceRowId'
  | 'lineTotals'
>

export type CartServiceProposalCartPricedDetail = {
  currencyCode: string
  status: Cart['status']
  expiresAt: Date
  lines: CartServiceProposalCartPricedLine[]
} | null

/**
 * Step 5.4 (`assisted_selling` §5.5/§6.7, S18/D-R5-16/D-R5-26). The `cart.cart.converted`
 * attribution subscriber needs, per converted BASKET cart, every live line's provenance
 * (`added_by_actor_type`/`_id`, which `cart` §14 asserts survives a merge unrewritten) and
 * its snapshot amounts — plus, for a line that arrived via an accepted proposal, the
 * `proposal_cart_id` it came from, resolved through `CartMergeLog.outcome`'s own
 * source→target line mapping (§6.7's own "the path is target cart line → outcome entry →
 * proposal_cart_id"). All of this is `cart`-internal (`CartLine`, `CartMergeLog`), so it is
 * exposed as one more additive `cartService` read rather than a cross-module entity import.
 */
export type CartServiceGetAttributionLinesInput = {
  tenantId: string
  organizationId: string
  cartId: string
}

export type CartServiceAttributionLine = {
  id: string
  addedByActorType: CartLine['addedByActorType']
  addedByActorId: string | null
  /** Decimal string, numeric(16,4)-shaped — `CartLine.lineTotals.netAmount` snapshotted. */
  netAmount: string
  /** Decimal string, numeric(16,4)-shaped — `CartLine.lineTotals.grossAmount` snapshotted. */
  grossAmount: string
  /** The `cart.Cart` (`kind: 'proposal'`) this line's CURRENT target line was merged from,
   * resolved via `CartMergeLog.outcome`, or `null` for a line the buyer added themselves
   * (no merge log entry at all — correct, not degraded, per §6.7). */
  proposalCartId: string | null
  /** The units each accepted proposal contributed to this line, oldest first. A proposal
   * line that summed into a line the buyer already held cannot become its own line (the
   * `cart_lines_unique_line_key` index), so the split the commission report needs is
   * recovered here from `CartMergeLog.outcome` instead of being overwritten. */
  proposalContributions: Array<{ proposalCartId: string; quantity: string }>
  quantity: string
}

export type CartServiceAttributionDetail = {
  currencyCode: string
  lines: CartServiceAttributionLine[]
} | null

function toDecimalString(value: unknown): string {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n)) return '0.0000'
  return (Math.round((n + Number.EPSILON) * 10000) / 10000).toFixed(4)
}

export type CartService = {
  lock(input: CartServiceLockInput): Promise<CartLockResult>
  unlock(input: CartUnlockInput): Promise<CartUnlockResult>
  markConverted(input: CartMarkConvertedInput): Promise<CartMarkConvertedResult>
  /** (C7, `.ai/specs/2026-08-14-cart-module.md` §3.1a/§9.1 rev 10) The only source checkout
   * uses to build its quote — see `lib/toSalesSnapshots.ts`'s own header comment. */
  getSalesSnapshot(input: GetCartSalesSnapshotInput): Promise<CartSalesSnapshot>
  /** Step 4.4 (S9). A `kind: 'basket'` cart scoped to a LIST of organization ids, `null`
   * list restriction (`organizationIds: null`) means unrestricted — never a direct `Cart`
   * entity import outside this module. */
  getForOrganizations(input: CartServiceGetForOrganizationsInput): Promise<CartSummary | null>
  /** Step 4.4 (§6.4). A `kind: 'proposal'` cart's own lines, mapped to
   * `cart.proposal.create`'s own line-input shape. */
  getProposalCartLines(input: CartServiceGetProposalCartLinesInput): Promise<CartServiceProposalCartLine[]>
  /** Step 4.5 (§5.1/§6.2, D-R5-21). Scope-free `kind: 'basket'` resolution by token hash —
   * returns `null` for an unknown token, a `kind: 'proposal'` cart's id/token, or no match at
   * all (same no-enumeration-oracle collapse `cart`'s own `/current/*` routes apply). */
  resolveBasketByToken(input: CartServiceResolveBasketByTokenInput): Promise<CartServiceResolvedBasketIdentity | null>
  /** Step 5.3 (§7.2, S22). A `kind: 'proposal'` cart's own lines, WITH the pricing columns
   * `cart.proposal.create` already wrote — `null` when the proposal cart no longer exists
   * (purged, §10.3's "renders as purged rather than failing to load"). */
  getProposalCartPricedLines(
    input: CartServiceGetProposalCartPricedLinesInput,
  ): Promise<CartServiceProposalCartPricedDetail>
  /** Step 5.4 (§5.5/§6.7, S18). A `kind: 'basket'` cart's own live lines, with provenance
   * (actor, snapshot amounts, originating proposal cart) for the attribution subscriber —
   * `null` when the basket no longer exists. */
  getAttributionLines(input: CartServiceGetAttributionLinesInput): Promise<CartServiceAttributionDetail>
}

type CartServiceAuthContext = CommandRuntimeContext['auth']

// Same "resolve `auth` off whatever is registered on the container, tolerate it being
// absent" convention `promotions-service.ts`'s `resolvePromotionsServiceScope` documents at
// length — unlike that facade, none of `cart.lock`/`.unlock`/`.markConverted` read
// `ctx.auth` themselves (every scope field they need arrives explicitly on the command
// input, since `checkout`, the only intended caller, already has its own resolved
// tenant/organization by the time it reaches this facade), so a missing `auth` token is not
// a failure here — it only affects the command bus's own interceptor/audit attribution.
function resolveCartServiceAuth(container: CartServiceContainer): CartServiceAuthContext {
  try {
    return (container.resolve<CartServiceAuthContext>('auth') ?? null) as CartServiceAuthContext
  } catch {
    return null
  }
}

function buildCartServiceCommandContext(
  container: CartServiceContainer,
  input: { tenantId: string; organizationId: string },
): CommandRuntimeContext {
  return {
    container: container as unknown as CommandRuntimeContext['container'],
    auth: resolveCartServiceAuth(container),
    organizationScope: null,
    selectedOrganizationId: input.organizationId,
    organizationIds: [input.organizationId],
  }
}

function resolveCartServiceCommandBus(container: CartServiceContainer): CommandBus {
  return container.resolve<CommandBus>('commandBus')
}

export class CartServiceImpl implements CartService {
  constructor(private readonly container: CartServiceContainer) {}

  async lock(input: CartServiceLockInput): Promise<CartLockResult> {
    const { request, ...commandInput } = input
    let routeContext = commandInput.routeContext
    if (!routeContext && request) {
      try {
        routeContext = await resolveCartRouteContext(request, this.container as unknown as {
          resolve: <T = unknown>(name: string) => T
        }, { fresh: true })
      } catch (err) {
        if (!isCartStoreContextUnavailableError(err)) throw err
        // No `ecommerce` peer registered — leave `routeContext` unset; a storefront-channel
        // cart will then correctly hit `cart.lock`'s own `assortment_scope_required_for_
        // storefront_channel` refusal rather than this facade silently swallowing the gap.
      }
    }
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, commandInput)
    const { result } = await commandBus.execute<CartLockInput, CartLockResult>(lockCartCommand.id, {
      input: { ...commandInput, routeContext },
      ctx,
    })
    return result
  }

  async getSalesSnapshot(input: GetCartSalesSnapshotInput): Promise<CartSalesSnapshot> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    return getCartSalesSnapshot(em, input)
  }

  async unlock(input: CartUnlockInput): Promise<CartUnlockResult> {
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, input)
    const { result } = await commandBus.execute<CartUnlockInput, CartUnlockResult>(unlockCartCommand.id, { input, ctx })
    return result
  }

  async markConverted(input: CartMarkConvertedInput): Promise<CartMarkConvertedResult> {
    const commandBus = resolveCartServiceCommandBus(this.container)
    const ctx = buildCartServiceCommandContext(this.container, input)
    const { result } = await commandBus.execute<CartMarkConvertedInput, CartMarkConvertedResult>(
      markConvertedCommand.id,
      { input, ctx },
    )
    return result
  }

  async getForOrganizations(input: CartServiceGetForOrganizationsInput): Promise<CartSummary | null> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId }
    const where: Record<string, unknown> = {
      id: input.cartId,
      tenantId: input.tenantId,
      kind: 'basket' as const,
    }
    if (Array.isArray(input.organizationIds)) {
      if (input.organizationIds.length === 0) return null
      where.organizationId = { $in: input.organizationIds }
    }
    const cart = (await findOneWithDecryption(em, Cart, where as Parameters<typeof findOneWithDecryption>[2], {}, scope)) as Cart | null
    return cart ? toCartSummary(cart) : null
  }

  async getProposalCartLines(input: CartServiceGetProposalCartLinesInput): Promise<CartServiceProposalCartLine[]> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const lines = (await findWithDecryption(
      em,
      CartLine,
      { cartId: input.proposalCartId, deletedAt: null, tenantId: input.tenantId, organizationId: input.organizationId },
      { orderBy: { lineNumber: 'ASC' } },
      scope,
    )) as CartLine[]
    return lines.map((line) => ({
      productId: line.productId,
      variantId: line.variantId ?? null,
      quantity: line.quantity,
      configuration: line.configuration ?? null,
    }))
  }

  async getProposalCartPricedLines(
    input: CartServiceGetProposalCartPricedLinesInput,
  ): Promise<CartServiceProposalCartPricedDetail> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const cart = (await findOneWithDecryption(
      em,
      Cart,
      { id: input.proposalCartId, tenantId: input.tenantId, organizationId: input.organizationId, kind: 'proposal' as const },
      {},
      scope,
    )) as Cart | null
    if (!cart) return null
    const lines = (await findWithDecryption(
      em,
      CartLine,
      { cartId: input.proposalCartId, deletedAt: null, tenantId: input.tenantId, organizationId: input.organizationId },
      { orderBy: { lineNumber: 'ASC' } },
      scope,
    )) as CartLine[]
    return {
      currencyCode: cart.currencyCode,
      status: cart.status,
      expiresAt: cart.expiresAt,
      lines: lines.map((line) => {
        const snapshot = toCartLineSnapshot(line)
        return {
          id: snapshot.id,
          productId: snapshot.productId,
          variantId: snapshot.variantId,
          sku: snapshot.sku,
          name: snapshot.name,
          quantity: snapshot.quantity,
          unitPriceNet: snapshot.unitPriceNet,
          unitPriceGross: snapshot.unitPriceGross,
          taxRate: snapshot.taxRate,
          priceKindId: snapshot.priceKindId,
          priceRowId: snapshot.priceRowId,
          lineTotals: snapshot.lineTotals,
        }
      }),
    }
  }

  async getAttributionLines(input: CartServiceGetAttributionLinesInput): Promise<CartServiceAttributionDetail> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const cart = (await findOneWithDecryption(
      em,
      Cart,
      { id: input.cartId, tenantId: input.tenantId, organizationId: input.organizationId, kind: 'basket' as const },
      {},
      scope,
    )) as Cart | null
    if (!cart) return null

    const lines = (await findWithDecryption(
      em,
      CartLine,
      { cartId: input.cartId, deletedAt: null, tenantId: input.tenantId, organizationId: input.organizationId },
      { orderBy: { lineNumber: 'ASC' } },
      scope,
    )) as CartLine[]

    // §6.7: "the path is target cart line -> outcome entry -> proposal_cart_id" — every
    // merge log that ever targeted THIS cart and carries a `proposal_cart_id` (a proposal
    // acceptance, §4.4), mapped from its own `outcome` entries' `targetLineId`.
    const mergeLogs = (await findWithDecryption(
      em,
      CartMergeLog,
      { targetCartId: input.cartId, tenantId: input.tenantId, organizationId: input.organizationId, proposalCartId: { $ne: null } },
      {},
      scope,
    )) as CartMergeLog[]
    const orderedLogs = [...mergeLogs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const mergedEntriesByLineId = new Map<string, Array<{ proposalCartId: string; previousQuantity: number }>>()
    for (const log of orderedLogs) {
      if (!log.proposalCartId) continue
      for (const entry of log.outcome as StoredMergeOutcomeEntry[]) {
        if (!entry.targetLineId) continue
        const entries = mergedEntriesByLineId.get(entry.targetLineId) ?? []
        entries.push({ proposalCartId: log.proposalCartId, previousQuantity: Number(entry.previousTargetQuantity ?? 0) || 0 })
        mergedEntriesByLineId.set(entry.targetLineId, entries)
      }
    }

    return {
      currencyCode: cart.currencyCode,
      lines: lines.map((line) => {
        const totals = (line.lineTotals ?? {}) as Record<string, unknown>
        const entries = mergedEntriesByLineId.get(line.id) ?? []
        let remaining = Number(line.quantity)
        const proposalContributions = entries.flatMap((entry, index) => {
          const quantityAfter = index + 1 < entries.length ? entries[index + 1].previousQuantity : Number(line.quantity)
          const contributed = Math.min(Math.max(quantityAfter - entry.previousQuantity, 0), remaining)
          remaining -= contributed
          return contributed > 0 ? [{ proposalCartId: entry.proposalCartId, quantity: String(contributed) }] : []
        })
        return {
          id: line.id,
          addedByActorType: line.addedByActorType,
          addedByActorId: line.addedByActorId ?? null,
          netAmount: toDecimalString(totals.netAmount),
          grossAmount: toDecimalString(totals.grossAmount),
          proposalCartId: entries.length > 0 ? entries[entries.length - 1].proposalCartId : null,
          proposalContributions,
          quantity: String(line.quantity),
        }
      }),
    }
  }

  async resolveBasketByToken(input: CartServiceResolveBasketByTokenInput): Promise<CartServiceResolvedBasketIdentity | null> {
    const em = (this.container.resolve('em') as EntityManager).fork()
    const cart = (await findOneWithDecryption(
      em,
      Cart,
      { tokenHash: hashCartToken(input.token), kind: 'basket' as const },
      {},
    )) as Cart | null
    if (!cart) return null
    return {
      id: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      storeId: cart.storeId ?? null,
      status: cart.status,
      customerId: cart.customerId ?? null,
      customerUserId: cart.customerUserId ?? null,
    }
  }
}
