import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import type { CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { E } from '#generated/entities.ids.generated'
import { Cart } from '../data/entities'
import type { ResolvedCartRouteContext } from '../lib/routeContext'
import { resolveCartCurrencyDecimalPlaces } from '../lib/exactPricing'
import { withCartLineMutationLock } from '../lib/lineMutationLock'
import { resolveCartLockTimeoutMs } from '../lib/sweepConfig'
import { assertCartNotLocked } from '../lib/lockGuard'
import { emitCartEvent } from '../events'
import { loadCartRepriceLines, prepareCartReprice, toCartSummary } from './cart'
import type { CartRepriceInput, CartRepricePlan, CartRepriceResult, CartSummary } from './cart'

// Step 7.5 — §9's `active -> locked`, `locked -> active` and `locked -> converted` rows:
// `cart.lock`, `cart.unlock`, `cart.markConverted`. §10 is explicit that none of the three
// has a public route in this release ("`checkout` calls the DI service/command directly,
// in-process") — there is no `checkout` module in this worktree yet, so none of these three
// commands has a real caller today. That is the expected state this step leaves them in,
// not a gap: the DI facade (`cart/di.ts`'s `cartService`) and these commands are the seam
// a future `checkout` module reaches for.
//
// None of the three is in §3.1a's undo table ("a lock is a checkout-session concern, not
// buyer content"; "terminal; the cart becomes read-only history once a `SalesOrder`
// exists") — no `undo` handler, matching this file set's own precedent for a non-undoable
// command (`cart.reprice`, `cart.lines.update`, `cart.promotions.apply`/`.remove`), none of
// which carry a `buildLog` audit entry either. Same choice made here: the significant-event
// trail for these three lives in the `cart.lock.*`/`cart.cart.converted` events below, not
// in `action_logs`.

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

type CartLockScope = { tenantId: string; organizationId: string }

async function loadBasketCart(em: EntityManager, scope: CartLockScope, cartId: string): Promise<Cart | null> {
  return findOneWithDecryption(
    em,
    Cart,
    { id: cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const },
    {},
    scope,
  )
}

// ---------------------------------------------------------------------------
// cart.lock
// ---------------------------------------------------------------------------

export type CartLockInput = {
  cartId: string
  tenantId: string
  organizationId: string
  /** Opaque id supplied by the lock caller (§4.1/§9) — persisted as `Cart.checkoutSessionId`
   * and returned in every subsequent `423 cart_locked` body until the lock clears. */
  checkoutSessionId: string
  /**
   * The route-edge-resolved buyer context, when the caller has one on hand — forwarded
   * verbatim to `cart.reprice`'s own dispatch below, exactly like `cart.merge`'s own
   * `routeContext` field. Optional for the same reason `CartRepriceInput.routeContext` and
   * every non-storefront command input in this module leave it optional (§6a.4: a `pos`/
   * `pay_link`/`agent`/`api` cart never resolves one at all) — there is no real caller yet
   * to enforce "a storefront cart's lock caller must always supply one" against, so this
   * step does not add that assertion speculatively (unlike `commands/lines.ts`'s
   * `assertStorefrontHasRouteContext`, which protects an EXISTING, exercised call path).
   */
  routeContext?: ResolvedCartRouteContext
}

export type CartLockResult = {
  cart: CartSummary
  priceChanges: CartRepriceResult['priceChanges']
  warnings?: CartRepriceResult['warnings']
}

const TERMINAL_LOCK_STATUSES = new Set(['merged', 'expired', 'converted'])

/** §9.1 losing acquisition (rev 10.4 — D-R5-CA17): answered by the row the re-read finds. */
async function refuseLostLockAcquisition(em: EntityManager, cart: Cart): Promise<never> {
  await em.refresh(cart)
  assertCartNotLocked(cart)
  if (TERMINAL_LOCK_STATUSES.has(cart.status)) {
    throw new CrudHttpError(409, { error: '[internal] cart_not_active', code: 'cart_not_active', status: cart.status })
  }
  throw new CrudHttpError(409, { error: '[internal] cart_lock_conflict', code: 'cart_lock_conflict' })
}

const lockCartCommand: CommandHandler<CartLockInput, CartLockResult> = {
  id: 'cart.lock',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartLockScope = { tenantId: input.tenantId, organizationId: input.organizationId }

    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const cart = await loadBasketCart(em, scope, input.cartId)
    if (!cart) throw notFound('[internal] cart not found')
    // §9: a locked cart's own re-lock attempt is itself a "client tries to mutate" case —
    // the blanket 423 rule has no stated carve-out for `cart.lock` calling itself.
    assertCartNotLocked(cart)
    // Every OTHER non-active status (converted/merged/expired/abandoned) collapses to the
    // same generic 404 `commands/lines.ts`'s `loadMutableCart` already uses for a
    // `requireActive` caller — `cart.lock` only ever fires `active -> locked` (§9).
    if (cart.status !== 'active') throw notFound('[internal] cart not found')
    // Resolved before the locked transaction, so it never needs a second pooled connection.
    const currencyDecimalPlaces = await resolveCartCurrencyDecimalPlaces(ctx.container, cart)

    // §9/§6a.2/§6a.5/D-R4-22: forces a whole-cart re-price AND (via `prepareCartReprice`'s
    // `runWholeCartRevisibilityPass`) the whole-cart re-visibility pass, with a
    // freshly-resolved buyer context, BEFORE this command ever checks for a still-flagged line.
    const repriceInput: CartRepriceInput = {
      cartId: input.cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      trigger: 'lock',
      routeContext: input.routeContext,
    }
    const now = new Date()
    const lockExpiresAt = new Date(now.getTime() + resolveCartLockTimeoutMs())
    const locked: { plan?: CartRepricePlan; hasUnavailableLines: boolean } = { hasUnavailableLines: false }

    // §8.1 (rev 10.1 — I1): the re-price, the flagged-line check and the transition all run
    // from one read taken under the `cart:lines:<cartId>` lock every line write, merge and
    // undo takes, so a contender that loses the lock never writes prices, promotions or
    // totals onto a cart another contender has already locked.
    await withCartLineMutationLock(
      em,
      cart.id,
      [
        async () => {
          await em.refresh(cart)
          assertCartNotLocked(cart)
          if (cart.status !== 'active') throw notFound('[internal] cart not found')
          const lines = await loadCartRepriceLines(em, cart)
          const plan = prepareCartReprice({ em, container: ctx.container, cart, lines, input: repriceInput, now, currencyDecimalPlaces })
          locked.plan = plan
          await withAtomicFlush(em, plan.phases, { transaction: true, label: 'cart.lock' })
        },
        async () => {
          // A line the re-visibility pass just flagged keeps its flag: the re-price commits
          // and the lock is refused after it, as when the re-price ran on its own.
          if (locked.plan?.lines.some((line) => line.flagState != null)) {
            locked.hasUnavailableLines = true
            return
          }
          // Compare-and-set on `status = 'active'`: a writer that changes status without this
          // lock (a sweeper, a concurrent unlock/convert path) still cannot be overwritten. A
          // lost race rolls the whole attempt back, re-price included, and emits nothing.
          const affected = await em.nativeUpdate(
            Cart,
            { id: cart.id, tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'active' },
            { status: 'locked', lockedAt: now, lockExpiresAt, checkoutSessionId: input.checkoutSessionId },
          )
          if (affected === 0) await refuseLostLockAcquisition(em, cart)
          await em.refresh(cart)
        },
      ],
      'cart.lock',
    )
    const plan = locked.plan
    if (!plan) throw new Error('[internal] cart.lock finished without a reprice plan')

    await plan.emitSideEffects()
    if (locked.hasUnavailableLines) {
      throw new CrudHttpError(409, { error: '[internal] cart_has_unavailable_lines', code: 'cart_has_unavailable_lines' })
    }
    await emitCartEvent('cart.lock.acquired', {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      checkoutSessionId: cart.checkoutSessionId,
    })

    const repriceResult = plan.buildResult()
    return {
      cart: toCartSummary(cart),
      priceChanges: repriceResult.priceChanges,
      ...(repriceResult.warnings && repriceResult.warnings.length > 0 ? { warnings: repriceResult.warnings } : {}),
    }
  },
}

// ---------------------------------------------------------------------------
// cart.unlock
// ---------------------------------------------------------------------------

export type CartUnlockInput = {
  cartId: string
  tenantId: string
  organizationId: string
}

export type CartUnlockResult = { cart: CartSummary }

const unlockCartCommand: CommandHandler<CartUnlockInput, CartUnlockResult> = {
  id: 'cart.unlock',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartLockScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadBasketCart(em, scope, input.cartId)
    if (!cart) throw notFound('[internal] cart not found')
    // §9: `locked -> active` is the only transition this command fires. A cart that is not
    // currently locked (active already, or any other status) has nothing for `cart.unlock`
    // to do — same uniform no-oracle 404 collapse `commands/lines.ts`'s `loadMutableCart`
    // already uses for a status mismatch, rather than a silent no-op success.
    if (cart.status !== 'locked') throw notFound('[internal] cart not found')

    await withAtomicFlush(
      em,
      [
        () => {
          cart.status = 'active'
          cart.lockedAt = null
          cart.lockExpiresAt = null
          cart.checkoutSessionId = null
        },
      ],
      { transaction: true, label: 'cart.unlock' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: cart,
      identifiers: getCartIdentifiers(cart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })
    // `cart.lock.released` — the EXPLICIT-unlock event. `cart.lock.timed_out` stays the
    // sweeper's own signal (`lib/sweepers.ts`'s `releaseStaleCartLocks`, left untouched by
    // this step per PLAN.md's own note); the two events only ever fire from their own
    // distinct call site, never both for the same transition.
    await emitCartEvent('cart.lock.released', {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
    })

    return { cart: toCartSummary(cart) }
  },
}

// ---------------------------------------------------------------------------
// cart.markConverted
// ---------------------------------------------------------------------------

export type CartMarkConvertedInput = {
  cartId: string
  tenantId: string
  organizationId: string
}

export type CartMarkConvertedResult = { cart: CartSummary }

const markConvertedCommand: CommandHandler<CartMarkConvertedInput, CartMarkConvertedResult> = {
  id: 'cart.markConverted',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: CartLockScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const em = (ctx.container.resolve('em') as EntityManager).fork()

    const cart = await loadBasketCart(em, scope, input.cartId)
    if (!cart) throw notFound('[internal] cart not found')
    // §9: `locked -> converted` only. A cart that is not currently locked — including one
    // ALREADY `converted` (a second `cart.markConverted` call, or any other mutation attempt
    // against an already-terminal cart) — gets the identical generic 404: "terminal; no
    // command mutates a converted cart" (§3.1a) is enforced here by giving a converted cart
    // no distinguishable signal of its own, the same uniform collapse every other non-active,
    // non-locked status already gets throughout this module. There is no dedicated
    // "already converted" error code in §15a's catalogue, so this documented judgment call
    // reuses the existing no-oracle 404 rather than inventing one.
    if (cart.status !== 'locked') throw notFound('[internal] cart not found')

    const now = new Date()
    await withAtomicFlush(
      em,
      [
        () => {
          cart.status = 'converted'
          cart.resolvedAt = now
        },
      ],
      { transaction: true, label: 'cart.markConverted' },
    )

    const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
    await emitCrudSideEffects({
      dataEngine,
      action: 'updated',
      entity: cart,
      identifiers: getCartIdentifiers(cart),
      events: cartCrudEvents,
      indexer: cartCrudIndexer,
    })
    await emitCartEvent('cart.cart.converted', {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
    })

    return { cart: toCartSummary(cart) }
  },
}

registerCommand(lockCartCommand)
registerCommand(unlockCartCommand)
registerCommand(markConvertedCommand)

export { lockCartCommand, unlockCartCommand, markConvertedCommand }
