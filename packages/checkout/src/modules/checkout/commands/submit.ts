import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue } from 'awilix'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildTrustedCommandContext } from '@open-mercato/shared/lib/commands/trusted-context'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { SalesLineSnapshot } from '@open-mercato/core/modules/sales/lib/types'
import type { SalesCalculationService } from '@open-mercato/core/modules/sales/services/salesCalculationService'
import type { CartService } from '@open-mercato/core/modules/cart/lib/cartService'
import type { CartSalesSnapshot } from '@open-mercato/core/modules/cart/lib/toSalesSnapshots'
import type {
  CustomerCreditService,
  ReserveCreditResult,
} from '@open-mercato/core/modules/customer_groups/services/customerCreditService'
import type { CustomerGroupsService, ResolvedTerms } from '@open-mercato/core/modules/customer_groups/services/customerGroupsService'
import type { AppliedPromotion, PromotionsService } from '@open-mercato/core/modules/promotions/lib/types'
import type { PaymentGatewayService } from '@open-mercato/core/modules/payment_gateways/lib/gateway-service'
import { CheckoutSession, CheckoutTransaction } from '../data/entities'
import {
  assertCartMatchesCheckoutScope,
  resolveRequestStoreIdForConsistencyCheck,
} from '../lib/cartSessionConsistency'
import {
  lookupCartAppliedPromotionEffects,
  lookupCartEnteredCodes,
  lookupCartPeerById,
  lookupPromotionNames,
} from '../lib/cartPeer'
import { lookupCartLinePeers } from '../lib/cartLinesPeer'
import { getOrComputeDeliveryOptions } from '../lib/deliveryRateCache'
import { computeDeliveryOptions } from '../lib/deliveryRateQuote'
import { hashAddressForCache, hashCartLinesForCache, resolveDestinationAddress } from '../lib/deliveryAddress'
import { evaluateDeliveryDiscount } from '../lib/promotionsDeliveryEvaluation'
import { writeSessionEvent } from '../lib/sessionEvents'
import { tryResolve } from '../lib/tryResolve'
import { emitCheckoutEvent } from '../events'
import { mapGatewayStatusToCheckoutStatus } from '../lib/utils'

// Release 5, Step 4.1 (checkout B.4 submit, §7.1/§7.2 steps 1-5, C3/C7/C19, D-R5-24/D-R5-30).
// Builds EXACTLY steps 1-5 of the revised submit sequence — preconditions, `cart.lock`,
// `availability.reserve`, on-account `reserveCredit`, idempotent document creation plus the
// C7 goods-totals equality check — and STOPS there. `availability.commit`, credit linkage,
// code usage, the gateway step and `markConverted`'s `lineMap` are Step 4.2's own scope.
//
// Release 5, Step 5.1 (checkout B.5, §8, C15-C17/D-R5-20/D-R5-23/D-R5-26/D-R5-28): adds the
// B2B preconditions (PO number §8.4, `min_order_value` §8.5) and the quote branch (§8.6) —
// `purpose: 'quote'` when `paymentMethodCode === 'request_quote'` (D-R5-23), which this
// command now honors instead of refusing outright. The quote branch ends submit right after
// document creation (§7.2 step 5's "QUOTE OUTCOME" block) via `completeQuoteOutcome` below —
// it never reaches `continueOrderOutcome`'s steps 6-8 (no commit, no credit, no codes, no
// gateway).
//
// Payment-method-selection question (tracked in NOTIFY.md after Step 2.13): RESOLVED as
// "submit takes the method as a direct input" — `paymentMethodCode` is a required field on
// this command's own input, never read off the session. No `POST /sessions/current/payment`
// selection route is built by this Step (nor by any Step before it); a caller that wants one
// can add it later purely as a convenience that stores the choice ahead of submit — this
// command does not depend on it existing. Step 5.1 follows the SAME resolved shape for the
// PO number (§8.4's own "captured at the payment step" becomes a direct `poNumber` input
// here, for the identical reason).
//
// Each of steps 1-5 is dispatched as its own, separately-committing call (cart.lock,
// availability.reserve, customerCreditService.reserveCredit, sales.quotes.create,
// sales.quotes.convert_to_order) — this orchestrating function is NOT itself wrapped in one
// outer transaction (§7.2's own "each step is a separate transaction"). Idempotency is
// carried by each step's own key (`stock_reservation_key`/`credit_reservation_key`/
// `external_reference`, all derived from `sessionId` + `attempt`), not by this function being
// re-entrant mid-flight — a genuinely crashed process is Step 4.2's `recover-stuck-submits`
// job (C24), not a second client call while `status = 'submitting'` (§7.4: that is the
// uniform `409 submit_in_progress`, never a resume).

const logger = createLogger('checkout')

export type CheckoutSessionSubmitCommandInput = {
  sessionId: string
  tenantId: string
  organizationId: string
  idempotencyKey: string
  paymentMethodCode: string
  // Release 5, Step 5.1 (§8.4/D-R5-28): written to `SalesQuote.customer_reference` at
  // document creation when the resolved `requiresPoNumber` term demands one.
  poNumber?: string | null
  request?: Request | null
}

export type CheckoutSessionSubmitStageResult = {
  session: CheckoutSession
  attempt: number
  stockReservationKey: string | null
  creditReservationKey: string | null
  salesQuoteId: string
  // Release 5, Step 5.1 (§8.6): `null` for the quote outcome — a `request_quote` submit
  // never converts to an order (C16/C17), so there is no order id to report.
  salesOrderId: string | null
}

type SubmitScope = { tenantId: string; organizationId: string }

function buildTrustedCtx(
  container: CommandRuntimeContext['container'],
  scope: SubmitScope,
  reason: string,
): CommandRuntimeContext {
  const { ctx } = buildTrustedCommandContext({
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    actorType: 'system',
    reason,
  })
  return { ...ctx, container }
}

function roundTo2dp(amount: number): string {
  return amount.toFixed(2)
}

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const TOTALS_EPSILON = 0.0005

function amountsEqual(a: number, b: number, epsilon = TOTALS_EPSILON): boolean {
  return Math.abs(a - b) <= epsilon
}

// C7's "goods totals equal the locked cart's totals" — compared on the keys a document's
// own shipping/delivery-discount adjustments can never touch (`taxTotalAmount` only stays
// untouched because this command never puts a tax rate on either of its own shipping/
// discount adjustment drafts, below).
const GOODS_TOTALS_KEYS = [
  'subtotalNetAmount',
  'subtotalGrossAmount',
  'discountTotalAmount',
  'taxTotalAmount',
  'grandTotalNetAmount',
  'grandTotalGrossAmount',
] as const

function findGoodsTotalsMismatch(
  cartTotals: Record<string, unknown>,
  goodsCalcTotals: Record<string, unknown>,
): string | null {
  for (const key of GOODS_TOTALS_KEYS) {
    if (!amountsEqual(toNumber(cartTotals[key]), toNumber(goodsCalcTotals[key]))) return key
  }
  return null
}

// Per-(catalogProductId, catalogVariantId) sum — `availability.reserve`'s own input schema
// refuses a duplicate pair per call ("the caller sums duplicate cart lines").
function buildReservationItems(
  lines: SalesLineSnapshot[],
): Array<{ catalogProductId: string; catalogVariantId: string | null; quantity: number }> {
  const byKey = new Map<string, { catalogProductId: string; catalogVariantId: string | null; quantity: number }>()
  for (const line of lines) {
    if (!line.productId) continue
    const key = `${line.productId}:${line.productVariantId ?? ''}`
    const existing = byKey.get(key)
    if (existing) {
      existing.quantity += line.quantity
    } else {
      byKey.set(key, { catalogProductId: line.productId, catalogVariantId: line.productVariantId ?? null, quantity: line.quantity })
    }
  }
  return Array.from(byKey.values())
}

type CompensationFlags = { releaseCredit: boolean; releaseStock: boolean; unlockCart: boolean }

/**
 * §7.3's compensation table for steps 1-5: release whatever was taken, in reverse order,
 * then return the session to `open` — UNLESS the compensation itself fails, in which case
 * the session is left `submitting` (recoverable by Step 4.2's own job) rather than silently
 * returning to `open` while a reservation may still be live (§7.3: "never swallowed").
 */
export async function compensate(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: SubmitScope,
  flags: CompensationFlags,
  keys: { stockReservationKey: string | null; creditReservationKey: string | null },
): Promise<void> {
  const ctx = buildTrustedCtx(container, scope, `checkout:submit:compensate:${session.id}`)
  const failures: string[] = []

  if (flags.releaseCredit && keys.creditReservationKey) {
    const customerCreditService = tryResolve<CustomerCreditService>(container, 'customerCreditService')
    if (customerCreditService) {
      try {
        await customerCreditService.releaseCredit({
          scope,
          reserveIdempotencyKey: keys.creditReservationKey,
          reason: 'checkout_submit_aborted',
        })
      } catch (err) {
        logger.error('[internal] checkout submit compensation: credit release failed', { err, sessionId: session.id })
        failures.push('credit')
      }
    }
  }

  if (flags.releaseStock && keys.stockReservationKey && tryResolve(container, 'policyResolutionService')) {
    const commandBus = container.resolve('commandBus') as CommandBus
    try {
      await commandBus.execute('availability.release', {
        input: { tenantId: scope.tenantId, organizationId: scope.organizationId, idempotencyKey: keys.stockReservationKey, reason: 'checkout_submit_aborted' },
        ctx,
      })
    } catch (err) {
      logger.error('[internal] checkout submit compensation: stock release failed', { err, sessionId: session.id })
      failures.push('stock')
    }
  }

  if (flags.unlockCart && session.cartId) {
    const cartService = tryResolve<CartService>(container, 'cartService')
    if (cartService) {
      try {
        await cartService.unlock({ cartId: session.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, checkoutSessionId: session.id })
      } catch (err) {
        logger.error('[internal] checkout submit compensation: cart unlock failed', { err, sessionId: session.id })
        failures.push('cart')
      }
    }
  }

  if (failures.length > 0) {
    await writeSessionEvent(em, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sessionId: session.id,
      kind: 'failure',
      actor: 'system',
      payload: { stage: 'compensation', failed: failures },
    })
    await emitCheckoutEvent('checkout.compensation.failed', {
      sessionId: session.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      failed: failures,
    }).catch(() => undefined)
    // Deliberately left `submitting` — a leaked reservation is invisible exposure/inventory
    // and needs a human or Step 4.2's recovery job, not a silent return to `open`.
    return
  }

  const revertedAt = new Date()
  await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, tenantId: scope.tenantId, organizationId: scope.organizationId, status: 'submitting' },
    { status: 'open', updatedAt: revertedAt },
  )
  // `nativeUpdate` bypasses the unit of work, so without this the `session` entity this
  // function was handed stays dirty with its caller's in-memory `status: 'submitting'` —
  // a later `em.flush()` anywhere in this em's lifetime (this function's own em is reused
  // for the session-event write right below) would re-persist that stale value and silently
  // undo the revert this call just made.
  session.status = 'open'
  session.updatedAt = revertedAt
  await writeSessionEvent(em, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    sessionId: session.id,
    kind: 'compensation',
    actor: 'system',
    payload: { released: flags },
  })
  await emitCheckoutEvent('checkout.compensation.executed', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  }).catch(() => undefined)
}

const submitSessionCommand: CommandHandler<CheckoutSessionSubmitCommandInput, CheckoutSessionSubmitStageResult> = {
  id: 'checkout.session.submit',
  isUndoable: false,
  async execute(input, ctx) {
    const scope: SubmitScope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const container = ctx.container
    const em = (container.resolve('em') as EntityManager).fork()

    const session = await findOneWithDecryption(em, CheckoutSession, { id: input.sessionId, ...scope }, undefined, scope)
    if (!session) throw notFound('[internal] checkout session not found')

    if (session.status === 'submitting') {
      // §7.4: a repeat while an attempt is in flight is a uniform 409, never a resume — a
      // crashed attempt is recovered by Step 4.2's own job (C24), not by calling this
      // command a second time.
      throw new CrudHttpError(409, { error: '[internal] a submit attempt is already in flight for this session', code: 'submit_in_progress' })
    }
    if (session.status !== 'open') {
      throw new CrudHttpError(409, { error: '[internal] checkout session is not open', code: 'session_not_open' })
    }
    if (!session.cartId) {
      throw new CrudHttpError(422, { error: '[internal] no cart is attached to this session', code: 'steps_incomplete' })
    }
    if (!session.shippingMethod) {
      throw new CrudHttpError(422, { error: '[internal] a delivery method must be selected before submit', code: 'steps_incomplete' })
    }
    // Preconditions check 4 (C9, re-verified at submit per the C9 guard's own contract —
    // Step 3.5's cart/session may have drifted since session creation). Three of the four
    // comparisons compare the session's OWN stored fields against the FRESH cart peer read
    // just below; the store comparison re-resolves the request's store context.
    const cartPeer = await lookupCartPeerById(em, session.cartId, scope)
    if (!cartPeer || cartPeer.kind !== 'basket') throw notFound('[internal] cart not found')
    const resolvedStoreId = await resolveRequestStoreIdForConsistencyCheck(container, cartPeer.storeId, input.request)
    assertCartMatchesCheckoutScope({
      cart: {
        storeId: cartPeer.storeId,
        channel: cartPeer.channel,
        currencyCode: cartPeer.currencyCode,
        tenantId: cartPeer.tenantId,
        organizationId: cartPeer.organizationId,
      },
      session: {
        channel: session.channel,
        currencyCode: session.currencyCode,
        tenantId: session.tenantId,
        organizationId: session.organizationId,
      },
      resolvedStoreId,
    })

    // ---------------------------------------------------------------------
    // §7.1 preconditions 6/9 (Step 5.1, B.5, D-R5-20/D-R5-23/D-R5-28): resolved ONCE here,
    // before the CAS — cheap, no side effects, matching the spec's own "preconditions are
    // checked before any side effect" framing as closely as this command's structure
    // allows. Reused below for the §7.1 precondition-8 `min_order_value` check (which
    // cannot run until the cart's locked goods gross is known, Step 3 below) and for the
    // `cart.lock` `purpose` argument (§6).
    // ---------------------------------------------------------------------
    const isQuotePurpose = input.paymentMethodCode === 'request_quote'
    const customerGroupsService = tryResolve<CustomerGroupsService>(container, 'customerGroupsService')
    const terms: ResolvedTerms | null = customerGroupsService
      ? await customerGroupsService.resolveTerms({
          customerId: cartPeer.customerId,
          customerIds: cartPeer.customerIds,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
      : null

    // §5.5/§8.1: `request_quote` is only ever a real option when the resolved terms allow
    // it — entitlement is never trusted from the client (§5.5's own wording), so this is
    // re-checked here even though the payment-methods LISTING route already gates it.
    if (isQuotePurpose && !terms?.allowQuoteRequests) {
      throw new CrudHttpError(422, { error: '[internal] request_quote is not available', code: 'payment_method_unavailable' })
    }

    // §7.1 precondition 9 (D-R5-28): PO number required when the resolved term demands
    // one — applies to BOTH outcomes (order and quote), unlike the approval gate and
    // `min_order_value`, which D-R5-23 exempts only for `purpose: 'quote'`.
    if (terms?.requiresPoNumber && !input.poNumber) {
      throw new CrudHttpError(422, { error: '[internal] a purchase order number is required', code: 'purchase_order_number_required' })
    }

    // §7.2 step 0: CAS open -> submitting, submit_attempt += 1, fresh keys.
    const attempt = session.submitAttempt + 1
    const stockReservationKey = `checkout:${session.id}:${attempt}:stock`
    const creditReservationKey = `checkout:${session.id}:${attempt}:credit`
    const externalReference = `checkout:${session.id}:${attempt}`

    const casAffected = await em.nativeUpdate(
      CheckoutSession,
      { id: session.id, ...scope, status: 'open' },
      {
        status: 'submitting',
        submitAttempt: attempt,
        submitIdempotencyKey: input.idempotencyKey,
        stockReservationKey,
        creditReservationKey,
        // Step 4.2: persisted so `recover-stuck-submits` (C24) and a resumed continuation
        // can read it back off the session — Step 4.1 took it as a direct command input
        // but never wrote it onto the entity.
        paymentMethodCode: input.paymentMethodCode,
        submitStartedAt: new Date(),
        submitProgress: null,
        failureCode: null,
        failureDetail: null,
        updatedAt: new Date(),
      },
    )
    if (casAffected === 0) {
      throw new CrudHttpError(409, { error: '[internal] a submit attempt is already in flight for this session', code: 'submit_in_progress' })
    }
    session.status = 'submitting'
    session.submitAttempt = attempt
    session.stockReservationKey = stockReservationKey
    session.creditReservationKey = creditReservationKey
    session.paymentMethodCode = input.paymentMethodCode

    await emitCheckoutEvent('checkout.session.submitted', {
      sessionId: session.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cartId: session.cartId,
      attempt,
    }).catch(() => undefined)

    const trustedCtx = buildTrustedCtx(container, scope, `checkout:submit:${session.id}:${attempt}`)

    // ---------------------------------------------------------------------
    // Step 1 (§7.2 step 1, C1/C2): cart.lock
    // ---------------------------------------------------------------------
    const cartService = tryResolve<CartService>(container, 'cartService')
    if (!cartService) {
      throw new CrudHttpError(503, { error: '[internal] checkout sessions are unavailable without the cart module', code: 'checkout_sessions_unavailable' })
    }

    let lockResult
    try {
      lockResult = await cartService.lock({
        cartId: session.cartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        checkoutSessionId: session.id,
        // §6/D-R5-23: `'quote'` skips the cart's own approval gate and (together with the
        // explicit skip below) `min_order_value`; the visibility pass, store/channel
        // checks and re-price still run regardless.
        purpose: isQuotePurpose ? 'quote' : 'order',
        request: input.request,
      })
    } catch (err) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: false }, { stockReservationKey, creditReservationKey })
      throw err
    }
    if (lockResult.priceChanges.length > 0) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(409, { error: '[internal] the cart re-priced at submit', code: 'price_changed', priceChanges: lockResult.priceChanges })
    }

    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'cart_locked', actor: 'system', payload: { cartId: session.cartId } })

    // ---------------------------------------------------------------------
    // §7.2 step 2 (delivery re-evaluation, D-R5-17): re-validate the stored shipping rate
    // and delivery promotion against the SAME deliveryMethodCode, closing the §7.2-step-2
    // gap Step 2.13's own NOTIFY entry flagged for this Step to close "for real" — codes are
    // re-derived from the cart's own `cart_promotion_applications` rows, never `codes: []`.
    // ---------------------------------------------------------------------
    const shippingMethod = session.shippingMethod as { deliveryMethodCode: string; price: string } | null
    if (!shippingMethod) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(422, { error: '[internal] a delivery method must be selected before submit', code: 'steps_incomplete' })
    }

    const containerWithRegister = container as unknown as {
      resolve: <T = unknown>(name: string) => T
      register: (registrations: Record<string, unknown>) => unknown
    }
    const destination = resolveDestinationAddress(session.shippingAddress)
    let freshDeliveryCost = shippingMethod.price
    if (destination) {
      const lines = await lookupCartLinePeers(em, session.cartId, scope)
      const addressHash = hashAddressForCache(destination)
      const cartHash = hashCartLinesForCache(lines)
      const options = await getOrComputeDeliveryOptions(
        containerWithRegister,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, sessionId: session.id },
        addressHash,
        cartHash,
        () =>
          computeDeliveryOptions(
            containerWithRegister,
            em,
            {
              id: session.id,
              tenantId: session.tenantId,
              organizationId: session.organizationId,
              cartId: session.cartId ?? null,
              storeId: session.storeId ?? null,
              linkId: session.linkId ?? null,
              channel: session.channel,
              currencyCode: session.currencyCode,
            },
            destination,
          ),
      )
      const stillOffered = options.find((option) => option.deliveryMethodCode === shippingMethod.deliveryMethodCode)
      if (!stillOffered) {
        await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
        throw new CrudHttpError(409, { error: '[internal] the delivery method is no longer available', code: 'price_changed', reason: 'delivery_changed' })
      }
      freshDeliveryCost = stillOffered.cost
    }

    const enteredCodes = await lookupCartEnteredCodes(em, session.cartId, scope)
    const freshDeliveryDiscount = await evaluateDeliveryDiscount(containerWithRegister, em, {
      sessionId: session.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cartId: session.cartId,
      currencyCode: session.currencyCode,
      deliveryMethodCode: shippingMethod.deliveryMethodCode,
      deliveryCost: freshDeliveryCost,
      codes: enteredCodes,
    })

    const storedQuotedTotals = (session.quotedTotals ?? {}) as { deliveryCost?: string; deliveryDiscount?: string | null }
    const freshDeliveryDiscountGross = freshDeliveryDiscount ? freshDeliveryDiscount.amountGross : null
    if (
      storedQuotedTotals.deliveryCost !== undefined &&
      !amountsEqual(toNumber(storedQuotedTotals.deliveryCost), toNumber(freshDeliveryCost))
    ) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(409, { error: '[internal] the delivery cost changed at submit', code: 'price_changed', reason: 'delivery_changed' })
    }
    if (
      storedQuotedTotals.deliveryDiscount !== undefined &&
      !amountsEqual(toNumber(storedQuotedTotals.deliveryDiscount ?? '0'), toNumber(freshDeliveryDiscountGross ?? '0'))
    ) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(409, { error: '[internal] a newly-eligible delivery promotion changed the price', code: 'price_changed', reason: 'promotion_newly_eligible' })
    }

    // ---------------------------------------------------------------------
    // cartService.getSalesSnapshot (C7) — the one source checkout uses to build the quote.
    // ---------------------------------------------------------------------
    let snapshot: CartSalesSnapshot
    try {
      snapshot = await cartService.getSalesSnapshot({
        cartId: session.cartId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        checkoutSessionId: session.id,
      })
    } catch (err) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw err
    }
    // Precondition 3 (§7.1): "Cart non-empty, active..." — checked here, right after the
    // one read that can prove it, rather than a second, earlier cart-lines read of its own.
    if (snapshot.lines.length === 0) {
      await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(409, { error: '[internal] the cart has no lines', code: 'cart_empty' })
    }

    // §7.1 precondition 8 / §8.5 (D-R5-4, D-R5-23): checked on the K1 basis (goods gross
    // after promotions, excluding delivery) in `terms_currency_code`. §8.5's own text is
    // explicit that a cart in another currency is simply NOT checked (never fail-closed —
    // unlike the approval gate's own currency-mismatch rule, D-R5-4 deliberately gives
    // these two fields opposite postures for a mismatch). Skipped entirely for a
    // `request_quote` submit (D-R5-23).
    if (!isQuotePurpose && terms?.minOrderValue != null && terms.termsCurrencyCode === session.currencyCode) {
      const goodsGross = toNumber(snapshot.totals.grandTotalGrossAmount)
      if (goodsGross < terms.minOrderValue) {
        await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: false, unlockCart: true }, { stockReservationKey, creditReservationKey })
        throw new CrudHttpError(409, {
          error: '[internal] the cart total is below the minimum order value',
          code: 'below_min_order_value',
          minOrderValue: terms.minOrderValue,
          currencyCode: terms.termsCurrencyCode,
        })
      }
    }

    // ---------------------------------------------------------------------
    // Step 3 (§7.2 step 3, A6/A15, D-R5-9): availability.reserve
    // ---------------------------------------------------------------------
    const availabilityActive = !!tryResolve(container, 'policyResolutionService')
    if (availabilityActive) {
      const items = buildReservationItems(snapshot.lines.map((line) => line.snapshot))
      if (items.length > 0) {
        const commandBus = container.resolve('commandBus') as CommandBus
        const { result: reserveResult } = await commandBus.execute<unknown, {
          reserved: boolean
          shortfall: Array<{ catalogProductId: string; catalogVariantId: string | null; requested: number; available: number }>
        }>('availability.reserve', {
          input: {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            items,
            sourceType: 'checkout',
            sourceId: session.id,
            idempotencyKey: stockReservationKey,
            ttlSeconds: 900,
          },
          ctx: trustedCtx,
        })
        if (!reserveResult.reserved) {
          await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: true, unlockCart: true }, { stockReservationKey, creditReservationKey })
          throw new CrudHttpError(409, { error: '[internal] one or more lines are out of stock', code: 'stock_shortfall', shortfall: reserveResult.shortfall })
        }
      }
    }
    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'stock_reserved', actor: 'system', payload: { stockReservationKey } })

    // ---------------------------------------------------------------------
    // Step 4 (§7.2 step 4, D-R5-24): on-account reserveCredit, for the FULL PAYABLE amount
    // (goods gross after promotions + delivery cost - delivery discount).
    // ---------------------------------------------------------------------
    const goodsGross = toNumber(snapshot.totals.grandTotalGrossAmount)
    const deliveryDiscountGrossAbs = freshDeliveryDiscount ? Math.abs(toNumber(freshDeliveryDiscount.amountGross)) : 0
    const payableGross = goodsGross + toNumber(freshDeliveryCost) - deliveryDiscountGrossAbs
    const payableAmount = roundTo2dp(payableGross)

    const isOnAccount = input.paymentMethodCode === 'on_account'
    if (isOnAccount) {
      const customerCreditService = tryResolve<CustomerCreditService>(container, 'customerCreditService')
      let reserveResult: ReserveCreditResult | null = null
      if (customerCreditService) {
        reserveResult = await customerCreditService.reserveCredit({
          scope,
          buyer: { customerIds: cartPeer.customerIds },
          currencyCode: session.currencyCode,
          amount: payableAmount,
          sourceType: 'checkout',
          sourceId: session.id,
          idempotencyKey: creditReservationKey,
        })
      }
      if (!reserveResult || !reserveResult.reserved) {
        await compensate(container, em, session, scope, { releaseCredit: false, releaseStock: true, unlockCart: true }, { stockReservationKey, creditReservationKey })
        throw new CrudHttpError(402, { error: '[internal] credit was refused', code: 'credit_refused', reason: reserveResult?.check.reason ?? 'no_account' })
      }
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'credit_reserved', actor: 'system', payload: { creditReservationKey } })
    }

    // ---------------------------------------------------------------------
    // Step 5 (§7.2 step 5, C3/C7/D-R5-24): idempotent document creation.
    // ---------------------------------------------------------------------
    const commandBus = container.resolve('commandBus') as CommandBus
    const salesCalculationService = tryResolve<SalesCalculationService>(container, 'salesCalculationService')
    if (!salesCalculationService) {
      await compensate(container, em, session, scope, { releaseCredit: isOnAccount, releaseStock: true, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(503, { error: '[internal] checkout submit is unavailable without the sales module', code: 'checkout_sessions_unavailable' })
    }

    const existingQuote = await findExistingQuoteByExternalReference(em, scope, externalReference)
    let quoteId: string
    if (existingQuote) {
      quoteId = existingQuote.id
    } else {
      const quoteLines = snapshot.lines.map((line, index) => ({
        ...line.snapshot,
        lineNumber: index + 1,
        metadata: { ...(line.snapshot.metadata ?? {}), cartLineId: line.cartLineId },
      }))
      const { result: createResult } = await commandBus.execute<unknown, { quoteId: string }>('sales.quotes.create', {
        input: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          externalReference,
          currencyCode: session.currencyCode,
          customerEntityId: session.customerId ?? undefined,
          shippingAddressSnapshot: session.shippingAddress ?? undefined,
          billingAddressSnapshot: session.billingSameAsShipping ? session.shippingAddress ?? undefined : session.billingAddress ?? undefined,
          shippingMethodCode: shippingMethod.deliveryMethodCode,
          shippingMethodSnapshot: session.shippingMethod ?? undefined,
          paymentMethodCode: input.paymentMethodCode,
          // §8.4/D-R5-28: written regardless of outcome whenever the buyer supplied one —
          // the resolved `requiresPoNumber` term only gates whether it is REQUIRED
          // (checked above as a precondition), not whether it is recorded when supplied.
          customerReference: input.poNumber ?? undefined,
          lines: quoteLines,
          adjustments: [
            ...snapshot.adjustments,
            {
              scope: 'order' as const,
              kind: 'shipping',
              label: 'Shipping',
              amountNet: toNumber(freshDeliveryCost),
              amountGross: toNumber(freshDeliveryCost),
              currencyCode: session.currencyCode,
            },
            ...(freshDeliveryDiscount
              ? [
                  {
                    scope: 'order' as const,
                    kind: 'discount',
                    label: freshDeliveryDiscount.promotionName,
                    promotionId: freshDeliveryDiscount.promotionId,
                    amountNet: Number(freshDeliveryDiscount.amountNet),
                    amountGross: Number(freshDeliveryDiscount.amountGross),
                    currencyCode: session.currencyCode,
                  },
                ]
              : []),
          ],
          // D-R5-23: `purpose: 'quote'` skipped `cart.lock`'s own approval gate (K2) —
          // `lockResult.cart` carries that gate's own fresh, post-reprice verdict, computed
          // moments ago by the SAME `cart.lock` call this command just dispatched above.
          // Snapshotting it here (FK-id + snapshot, `packages/core/AGENTS.md` § Cross-Module
          // Coupling) lets `sales/api/quotes/accept` re-run the gate before converting an
          // accepted quote to an order — the "approval returns at quote acceptance" half of
          // D-R5-23 that this quote-creation step is the only place positioned to supply.
          metadata: {
            sourceModule: 'checkout',
            checkoutSessionId: session.id,
            pendingApproval: { required: lockResult.cart.requiresApproval, approvalId: lockResult.cart.approvalId },
          },
        },
        ctx: trustedCtx,
      })
      quoteId = createResult.quoteId
    }

    // C7: the goods totals that will land on this quote's LINES must equal the cart's own
    // locked totals — computed independently, via the SAME engine and the SAME lines +
    // (goods-only) adjustments, rather than read off the persisted quote row (which also
    // carries the shipping/delivery-discount adjustments added just above and therefore is
    // not directly comparable key-for-key, since the calculation engine folds a `shipping`
    // adjustment into `subtotalNet/GrossAmount` by design).
    const goodsCalc = await salesCalculationService.calculateDocumentTotals({
      documentKind: 'quote',
      lines: snapshot.lines.map((line) => line.snapshot),
      adjustments: snapshot.adjustments,
      context: { tenantId: scope.tenantId, organizationId: scope.organizationId, currencyCode: session.currencyCode, metadata: { source: 'checkout', sessionId: session.id } },
    })
    const mismatchKey = findGoodsTotalsMismatch(snapshot.totals, goodsCalc.totals as unknown as Record<string, unknown>)
    // `payableAmount` was already rounded to the reservation's own 2dp currency scale above
    // (`roundTo2dp`), so the recomputed side must be rounded the same way before comparing —
    // comparing a rounded cent amount against an unrounded `numeric(16,4)` total with a
    // sub-cent epsilon fails on any gross total that isn't already a whole number of cents
    // (common with gross-inclusive VAT pricing).
    const payableFromGoodsCalc = roundTo2dp(toNumber(goodsCalc.totals.grandTotalGrossAmount) + toNumber(freshDeliveryCost) - deliveryDiscountGrossAbs)
    const payableMismatch = isOnAccount && payableAmount !== payableFromGoodsCalc
    if (mismatchKey || payableMismatch) {
      logger.error('[internal] checkout submit: totals mismatch at document creation, raising an ops notification', {
        sessionId: session.id,
        mismatchKey,
        payableMismatch,
      })
      await compensate(container, em, session, scope, { releaseCredit: isOnAccount, releaseStock: true, unlockCart: true }, { stockReservationKey, creditReservationKey })
      throw new CrudHttpError(500, { error: '[internal] totals did not match at document creation', code: 'totals_mismatch' })
    }

    // ---------------------------------------------------------------------
    // QUOTE OUTCOME (§7.2 step 5's own "after 5a/5b" block, Step 5.1, C16/C17/D-R5-20/
    // D-R5-26): ends submit right here — no order conversion, no commit, no credit, no
    // codes, no gateway. `isOnAccount` is always false when `isQuotePurpose` (the two
    // payment method codes are mutually exclusive), so nothing was ever reserved for
    // credit to release here.
    // ---------------------------------------------------------------------
    if (isQuotePurpose) {
      await em.nativeUpdate(
        CheckoutSession,
        { id: session.id, ...scope },
        { salesQuoteId: quoteId, submitProgress: 'document_created', updatedAt: new Date() },
      )
      session.salesQuoteId = quoteId
      session.submitProgress = 'document_created'
      await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'document_created', actor: 'system', payload: { quoteId } })

      return completeQuoteOutcome(container, em, session, scope, quoteId, { stockReservationKey: availabilityActive ? stockReservationKey : null })
    }

    const existingOrder = await findExistingOrderById(em, scope, quoteId)
    let orderId: string
    if (existingOrder) {
      orderId = existingOrder.id
    } else {
      const { result: convertResult } = await commandBus.execute<unknown, { orderId: string }>('sales.quotes.convert_to_order', {
        input: { quoteId },
        ctx: trustedCtx,
      })
      orderId = convertResult.orderId
    }

    await em.nativeUpdate(
      CheckoutSession,
      { id: session.id, ...scope },
      { salesQuoteId: quoteId, salesOrderId: orderId, submitProgress: 'document_created', updatedAt: new Date() },
    )
    session.salesQuoteId = quoteId
    session.salesOrderId = orderId
    session.submitProgress = 'document_created'

    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'document_created', actor: 'system', payload: { quoteId, orderId } })

    // ---------------------------------------------------------------------
    // Steps 6-8 (Step 4.2, C5/C6/C18/C24): order outcome only — the quote outcome already
    // returned above, before this point is ever reached. `continueOrderOutcome` is a
    // tightly-coupled sibling of this `execute()`, not a
    // parallel reimplementation — `recover-stuck-submits` (workers/recover-stuck-
    // submits.worker.ts) calls the SAME function directly for a session whose
    // `submit_progress` is already `document_created`/`finalized`, re-deriving its inputs
    // from the session's own stored columns instead of local variables this function
    // computed in steps 1-5.
    return continueOrderOutcome(container, {
      session,
      scope,
      attempt,
      paymentMethodCode: input.paymentMethodCode,
      stockReservationKey: availabilityActive ? stockReservationKey : null,
      creditReservationKey: isOnAccount ? creditReservationKey : null,
      quoteId,
      orderId,
      request: input.request,
    })
  },
}

async function findExistingQuoteByExternalReference(
  em: EntityManager,
  scope: SubmitScope,
  externalReference: string,
): Promise<{ id: string } | null> {
  const row = await em
    .getKysely<{
      sales_quotes: { id: string; tenant_id: string; organization_id: string; external_reference: string | null; deleted_at: Date | null }
    }>()
    .selectFrom('sales_quotes')
    .select(['id'])
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('external_reference', '=', externalReference)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return row ? { id: row.id } : null
}

async function findExistingOrderById(
  em: EntityManager,
  scope: SubmitScope,
  orderId: string,
): Promise<{ id: string } | null> {
  const row = await em
    .getKysely<{ sales_orders: { id: string; tenant_id: string; organization_id: string; deleted_at: Date | null } }>()
    .selectFrom('sales_orders')
    .select(['id'])
    .where('id', '=', orderId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst()
  return row ? { id: row.id } : null
}

// ===========================================================================
// Step 4.2 (C5/C6/C18/C24): steps 6-8 of §7.2 — order outcome: commit, credit link,
// codes/usage, gateway, lineMap, completion/compensation. A tightly-coupled sibling of
// `submitSessionCommand.execute` above, called from exactly one place there AND from
// `workers/recover-stuck-submits.worker.ts` (C24's "resume forward... each sub-step is
// idempotent under its key" — the SAME function, not a parallel reimplementation).
// ===========================================================================

export type ContinueOrderOutcomeInput = {
  session: CheckoutSession
  scope: SubmitScope
  attempt: number
  paymentMethodCode: string
  stockReservationKey: string | null
  creditReservationKey: string | null
  quoteId: string
  orderId: string
  request?: Request | null
}

// §12.1/C24: the order-status dictionary (`sales.order_status`) is a per-tenant,
// per-organization DICTIONARY — `sales` has no plain `status` input on its own update
// schema (only `statusEntryId`, resolved server-side to a value), so transitioning an
// order to `confirmed`/`canceled` needs this id first. Read via the SAME "FK-id +
// snapshot" raw read every other cross-module lookup in this file already uses — never an
// import of `sales/lib/dictionaries.ts` or the `dictionaries` module's own entities, which
// would turn `sales`'s soft D-R5-18 peer dependency into a hard one.
async function resolveSalesOrderStatusEntryId(
  em: EntityManager,
  scope: SubmitScope,
  value: 'confirmed' | 'canceled',
): Promise<string> {
  const candidates = value === 'canceled' ? ['canceled', 'cancelled'] : ['confirmed']
  const row = await em
    .getKysely<{
      dictionaries: { id: string; tenant_id: string; organization_id: string; key: string; deleted_at: Date | null }
      dictionary_entries: { id: string; dictionary_id: string; tenant_id: string; organization_id: string; normalized_value: string }
    }>()
    .selectFrom('dictionary_entries')
    .innerJoin('dictionaries', 'dictionaries.id', 'dictionary_entries.dictionary_id')
    .select(['dictionary_entries.id as id'])
    .where('dictionaries.tenant_id', '=', scope.tenantId)
    .where('dictionaries.organization_id', '=', scope.organizationId)
    .where('dictionaries.key', '=', 'sales.order_status')
    .where('dictionaries.deleted_at', 'is', null)
    .where('dictionary_entries.tenant_id', '=', scope.tenantId)
    .where('dictionary_entries.organization_id', '=', scope.organizationId)
    .where('dictionary_entries.normalized_value', 'in', candidates)
    .executeTakeFirst()
  if (!row) {
    throw new CrudHttpError(503, {
      error: '[internal] the sales order-status dictionary is not provisioned for this organization',
      code: 'checkout_sessions_unavailable',
    })
  }
  return row.id
}

async function findCheckoutTransactionBySession(
  em: EntityManager,
  scope: SubmitScope,
  sessionId: string,
): Promise<CheckoutTransaction | null> {
  return em.findOne(CheckoutTransaction, { sessionId, tenantId: scope.tenantId, organizationId: scope.organizationId })
}

async function loadOrderGrandTotalGross(
  em: EntityManager,
  scope: SubmitScope,
  orderId: string,
): Promise<{ amount: string; currencyCode: string }> {
  const row = await em
    .getKysely<{
      sales_orders: { id: string; tenant_id: string; organization_id: string; grand_total_gross_amount: string; currency_code: string }
    }>()
    .selectFrom('sales_orders')
    .select(['grand_total_gross_amount', 'currency_code'])
    .where('id', '=', orderId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .executeTakeFirst()
  if (!row) throw notFound('[internal] sales order not found')
  return { amount: row.grand_total_gross_amount, currencyCode: row.currency_code }
}

// C18: `convert_to_order` copies each quote line's `metadata` (incl. `cartLineId`, set by
// this command's own step 5) onto its order line verbatim — so the bijection
// `cart.markConverted` needs is read straight off the order's own live lines, never
// re-derived from the quote.
async function buildOrderLineMap(
  em: EntityManager,
  scope: SubmitScope,
  orderId: string,
): Promise<Array<{ cartLineId: string; salesOrderLineId: string }>> {
  const rows = await em
    .getKysely<{
      sales_order_lines: { id: string; order_id: string; tenant_id: string; organization_id: string; metadata: Record<string, unknown> | null; deleted_at: Date | null }
    }>()
    .selectFrom('sales_order_lines')
    .select(['id', 'metadata'])
    .where('order_id', '=', orderId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()
  const lineMap: Array<{ cartLineId: string; salesOrderLineId: string }> = []
  for (const row of rows) {
    const cartLineId = typeof row.metadata?.cartLineId === 'string' ? (row.metadata.cartLineId as string) : null
    if (!cartLineId) continue
    lineMap.push({ cartLineId, salesOrderLineId: row.id })
  }
  return lineMap
}

// §7.2's quote-outcome block / D-R5-26: the quote's OWN lines, read directly (never
// converted to an order) — `metadata.cartLineId` was set at step 5a, identically to the
// order branch's own quote lines, so this is `buildOrderLineMap`'s exact sibling against
// `sales_quote_lines` instead of `sales_order_lines`.
async function buildQuoteLineMap(
  em: EntityManager,
  scope: SubmitScope,
  quoteId: string,
): Promise<Array<{ cartLineId: string; salesQuoteLineId: string }>> {
  const rows = await em
    .getKysely<{
      sales_quote_lines: { id: string; quote_id: string; tenant_id: string; organization_id: string; metadata: Record<string, unknown> | null; deleted_at: Date | null }
    }>()
    .selectFrom('sales_quote_lines')
    .select(['id', 'metadata'])
    .where('quote_id', '=', quoteId)
    .where('tenant_id', '=', scope.tenantId)
    .where('organization_id', '=', scope.organizationId)
    .where('deleted_at', 'is', null)
    .execute()
  const lineMap: Array<{ cartLineId: string; salesQuoteLineId: string }> = []
  for (const row of rows) {
    const cartLineId = typeof row.metadata?.cartLineId === 'string' ? (row.metadata.cartLineId as string) : null
    if (!cartLineId) continue
    lineMap.push({ cartLineId, salesQuoteLineId: row.id })
  }
  return lineMap
}

/**
 * §7.3's "5c-8" row: once the order exists, EVERY later failure compensates by
 * cancelling it — never a hand-rolled parallel release. `sales.order.cancelled`'s own
 * subscribers (already shipped: `wms`'s order-hold release, `customer_groups`'s
 * `order-cancelled-credit-release` via C6's `linkedOrderId`, `promotions`'s
 * `order-cancelled-usage-revert` via `CodeUsage.orderId`) release whatever was linked to
 * this order; this helper additionally unlocks the cart (no subscriber does that) and
 * moves the session to `failed`.
 */
// Release 5, Step 4.2-fix (C1/§12, `expire-awaiting-payment`): exported so the job can
// reuse the SAME cancel-order compensation `recover-stuck-submits`'s own `continueOrderOutcome`
// calls internally — never a parallel reimplementation of "cancel the order, release
// everything via `sales.order.cancelled`'s subscribers, fail the session".
export async function compensateByCancellingOrder(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: SubmitScope,
  orderId: string,
  failureCode: string,
): Promise<void> {
  const trustedCtx = buildTrustedCtx(container, scope, `checkout:submit:compensate-cancel:${session.id}`)
  const commandBus = container.resolve('commandBus') as CommandBus
  try {
    const canceledEntryId = await resolveSalesOrderStatusEntryId(em, scope, 'canceled')
    await commandBus.execute('sales.orders.update', {
      input: { id: orderId, statusEntryId: canceledEntryId },
      ctx: trustedCtx,
    })
  } catch (err) {
    logger.error('[internal] checkout submit compensation: order cancellation failed', { err, sessionId: session.id, orderId })
  }

  const cartService = tryResolve<CartService>(container, 'cartService')
  if (cartService && session.cartId) {
    try {
      await cartService.unlock({ cartId: session.cartId, tenantId: scope.tenantId, organizationId: scope.organizationId, checkoutSessionId: session.id })
    } catch (err) {
      logger.error('[internal] checkout submit compensation: cart unlock failed', { err, sessionId: session.id })
    }
  }

  await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, ...scope },
    { status: 'failed', failureCode, failureDetail: null, updatedAt: new Date() },
  )
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'compensation', actor: 'system', payload: { stage: 'order_cancelled', orderId, failureCode } })
  await emitCheckoutEvent('checkout.session.failed', { sessionId: session.id, tenantId: scope.tenantId, organizationId: scope.organizationId, cartId: session.cartId ?? null, attempt: session.submitAttempt, failureCode }).catch(() => undefined)
}

/**
 * §7.2 steps 7 (on-account branch)/8: the order already exists and every pre-payment
 * step (commit, credit link, codes/usage) is done — confirm it, build the C18 `lineMap`,
 * `cart.markConverted`, and move the session to `completed`.
 */
// Release 5, Step 4.2-fix (C1/§12, `expire-awaiting-payment`): exported for the SAME reason
// as `compensateByCancellingOrder` above — the job that resolves a session left in
// `awaiting_payment` by a gateway that answered asynchronously resumes through this EXACT
// function on a gateway-confirmed success, never a duplicate order-confirm/markConverted path.
export async function confirmOrderAndComplete(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: SubmitScope,
  orderId: string,
  quoteId: string,
  reservationKeys: { stockReservationKey: string | null; creditReservationKey: string | null },
): Promise<CheckoutSessionSubmitStageResult> {
  const trustedCtx = buildTrustedCtx(container, scope, `checkout:submit:complete:${session.id}`)
  const commandBus = container.resolve('commandBus') as CommandBus

  const confirmedEntryId = await resolveSalesOrderStatusEntryId(em, scope, 'confirmed')
  await commandBus.execute('sales.orders.update', {
    input: { id: orderId, statusEntryId: confirmedEntryId },
    ctx: trustedCtx,
  })

  const lineMap = await buildOrderLineMap(em, scope, orderId)
  const cartService = tryResolve<CartService>(container, 'cartService')
  if (cartService && session.cartId) {
    await cartService.markConverted({
      cartId: session.cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      checkoutSessionId: session.id,
      salesOrderId: orderId,
      lineMap,
    })
  }

  await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, ...scope },
    { status: 'completed', outcomeKind: 'order', completedAt: new Date(), updatedAt: new Date() },
  )
  session.status = 'completed'
  session.outcomeKind = 'order'

  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_result', actor: 'system', payload: { orderId, outcome: 'completed' } })
  await emitCheckoutEvent('checkout.session.completed', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cartId: session.cartId ?? null,
    outcomeKind: 'order',
    salesOrderId: orderId,
    salesQuoteId: quoteId,
    paymentMethodCode: session.paymentMethodCode ?? null,
  }).catch(() => undefined)

  return {
    session,
    attempt: session.submitAttempt,
    stockReservationKey: reservationKeys.stockReservationKey,
    creditReservationKey: reservationKeys.creditReservationKey,
    salesQuoteId: quoteId,
    salesOrderId: orderId,
  }
}

/**
 * §7.2's "QUOTE OUTCOME (request_quote)" block / §8.6 (C16/C17, D-R5-20/D-R5-26): the
 * quote already exists (document creation, step 5a/5b) — release the stock hold
 * immediately (C16, never `availability.commit`), build the quote `lineMap` (D-R5-26),
 * `cart.markConverted` with `salesQuoteId`, and move the session straight to `completed`
 * with `outcomeKind: 'quote'`. No credit was ever reserved for `request_quote` (`isOnAccount`
 * is always false for this payment method, Step 4.1's own mutual-exclusion), no codes are
 * consumed, no gateway is ever involved — this is a terminal state on its own, not a
 * waypoint `continueOrderOutcome` is reached from.
 */
// Exported for the SAME reason `confirmOrderAndComplete`/`compensateByCancellingOrder` are:
// a session that crashes in the narrow window between document creation and this
// function's own completion is resumed by `recover-stuck-submits` through this EXACT
// function, re-derived from the session's own stored `paymentMethodCode`/`salesQuoteId` —
// never a parallel reimplementation.
export async function completeQuoteOutcome(
  container: CommandRuntimeContext['container'],
  em: EntityManager,
  session: CheckoutSession,
  scope: SubmitScope,
  quoteId: string,
  reservationKeys: { stockReservationKey: string | null },
): Promise<CheckoutSessionSubmitStageResult> {
  const trustedCtx = buildTrustedCtx(container, scope, `checkout:submit:complete-quote:${session.id}`)
  const commandBus = container.resolve('commandBus') as CommandBus

  if (reservationKeys.stockReservationKey) {
    try {
      await commandBus.execute('availability.release', {
        input: { tenantId: scope.tenantId, organizationId: scope.organizationId, idempotencyKey: reservationKeys.stockReservationKey, reason: 'quote' },
        ctx: trustedCtx,
      })
    } catch (err) {
      if (err instanceof CrudHttpError && err.status === 404) {
        // Nothing was ever reserved under this key — a no-op, matching every other
        // `availability.release`-after-a-maybe-reserve call site in this file.
      } else {
        throw err
      }
    }
  }
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'stock_released', actor: 'system', payload: { quoteId } })

  const lineMap = await buildQuoteLineMap(em, scope, quoteId)
  const cartService = tryResolve<CartService>(container, 'cartService')
  if (cartService && session.cartId) {
    await cartService.markConverted({
      cartId: session.cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      checkoutSessionId: session.id,
      salesQuoteId: quoteId,
      lineMap,
    })
  }

  await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, ...scope },
    { status: 'completed', outcomeKind: 'quote', completedAt: new Date(), updatedAt: new Date() },
  )
  session.status = 'completed'
  session.outcomeKind = 'quote'

  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'quote_completed', actor: 'system', payload: { quoteId, outcome: 'completed' } })
  await emitCheckoutEvent('checkout.session.completed', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cartId: session.cartId ?? null,
    outcomeKind: 'quote',
    salesOrderId: null,
    salesQuoteId: quoteId,
    paymentMethodCode: session.paymentMethodCode ?? null,
  }).catch(() => undefined)

  return {
    session,
    attempt: session.submitAttempt,
    stockReservationKey: reservationKeys.stockReservationKey,
    creditReservationKey: null,
    salesQuoteId: quoteId,
    salesOrderId: null,
  }
}

export async function continueOrderOutcome(
  container: CommandRuntimeContext['container'],
  input: ContinueOrderOutcomeInput,
): Promise<CheckoutSessionSubmitStageResult> {
  const { session, scope, orderId, quoteId } = input
  const em = (container.resolve('em') as EntityManager).fork()
  const isOnAccount = input.paymentMethodCode === 'on_account'
  const trustedCtx = buildTrustedCtx(container, scope, `checkout:submit:continue:${session.id}:${input.attempt}`)
  const commandBus = container.resolve('commandBus') as CommandBus

  if (!session.cartId) throw new CrudHttpError(500, { error: '[internal] checkout session has no cart to continue from', code: 'totals_mismatch' })

  // ---------------------------------------------------------------------
  // Step 6a (§7.2 step 6a, D-R5-8): availability.commit, right after document creation,
  // before payment. A 404 `reservation_not_found` means nothing was ever reserved (every
  // line was `not_tracked`, or availability is absent) — a no-op, not a failure.
  // ---------------------------------------------------------------------
  if (input.stockReservationKey) {
    try {
      const { result: commitResult } = await commandBus.execute<unknown, { reservationId: string; status: 'committed' | 'recovered' | 'stock_lost'; shortfall: Array<{ catalogProductId: string; catalogVariantId: string | null; requested: number; available: number }> }>(
        'availability.commit',
        { input: { tenantId: scope.tenantId, organizationId: scope.organizationId, idempotencyKey: input.stockReservationKey, orderId }, ctx: trustedCtx },
      )
      if (commitResult.status === 'stock_lost') {
        logger.error('[internal] checkout submit: stock_lost_after_payment, raising an ops notification', { sessionId: session.id, orderId })
        await compensateByCancellingOrder(container, em, session, scope, orderId, 'stock_lost_after_payment')
        throw new CrudHttpError(409, { error: '[internal] stock could not be committed', code: 'stock_shortfall', shortfall: commitResult.shortfall })
      }
    } catch (err) {
      if (err instanceof CrudHttpError && err.status === 404) {
        // Nothing was ever reserved under this key — treat as no-op, matching
        // `availability.release`'s own "not_found" result shape for the same case.
      } else {
        throw err
      }
    }
  }
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'stock_committed', actor: 'system', payload: { orderId } })

  // ---------------------------------------------------------------------
  // Step 6b (§7.2 step 6b, C6): link the credit reservation to the order, on-account only.
  // ---------------------------------------------------------------------
  if (isOnAccount && input.creditReservationKey) {
    const customerCreditService = tryResolve<CustomerCreditService>(container, 'customerCreditService')
    if (customerCreditService) {
      await customerCreditService.linkCreditReservationToOrder({ scope, idempotencyKey: input.creditReservationKey, orderId })
    }
  }

  // ---------------------------------------------------------------------
  // Step 6c (§7.2 step 6c, C5): useCode per applied code, then registerUsage for every
  // promotion that discounted this cart — before payment. A refusal or non-empty
  // `budgetExceeded` compensates by cancelling the order and aborts `409
  // promotion_unavailable`.
  // ---------------------------------------------------------------------
  const promotionsService = tryResolve<PromotionsService>(container, 'promotionsService')
  if (promotionsService) {
    const containerWithRegister = container as unknown as { register: (regs: Record<string, unknown>) => unknown }
    // `promotionsService.useCode`/`.registerUsage` resolve their own scope off the
    // container's `auth` registration (`lib/promotions-service.ts`), never off the
    // command context — this is checkout's own system-initiated, in-process call, so it
    // registers a minimal scope-only `auth` on the SAME per-request container, the exact
    // pattern `api/codes/use/route.ts` already uses for its (human, authenticated) caller.
    containerWithRegister.register({ auth: asValue({ tenantId: scope.tenantId, orgId: scope.organizationId }) })

    const cartPeer = await lookupCartPeerById(em, session.cartId, scope)
    const customerId = cartPeer?.customerId ?? null

    const enteredCodes = await lookupCartEnteredCodes(em, session.cartId, scope)
    for (const code of enteredCodes) {
      try {
        await promotionsService.useCode({
          codeId: code.id,
          codeString: code.codeString ?? '',
          cartId: session.cartId,
          orderId,
          customerId,
          type: code.type,
        })
      } catch (err) {
        logger.error('[internal] checkout submit: a promotion code could not be redeemed before payment', { err, sessionId: session.id, codeId: code.id })
        await compensateByCancellingOrder(container, em, session, scope, orderId, 'promotion_unavailable')
        throw new CrudHttpError(409, { error: '[internal] a promotion code is no longer available', code: 'promotion_unavailable' })
      }
    }

    const appliedEffects = await lookupCartAppliedPromotionEffects(em, session.cartId, scope)
    if (appliedEffects.length > 0) {
      const names = await lookupPromotionNames(em, appliedEffects.map((entry) => entry.promotionId), scope)
      const appliedPromotions: AppliedPromotion[] = appliedEffects.map((entry) => ({
        promotionId: entry.promotionId,
        promotionName: names.get(entry.promotionId) ?? entry.promotionId,
        effects: entry.effects as unknown as AppliedPromotion['effects'],
      }))
      let registerResult: { ok: true; budgetExceeded: string[] }
      try {
        registerResult = await promotionsService.registerUsage({
          orderId,
          orderType: 'order',
          customerId,
          currency: session.currencyCode,
          appliedPromotions,
        })
      } catch (err) {
        logger.error('[internal] checkout submit: registerUsage failed before payment', { err, sessionId: session.id, orderId })
        await compensateByCancellingOrder(container, em, session, scope, orderId, 'promotion_unavailable')
        throw new CrudHttpError(409, { error: '[internal] a promotion budget could not be registered', code: 'promotion_unavailable' })
      }
      if (registerResult.budgetExceeded.length > 0) {
        logger.error('[internal] checkout submit: a promotion budget was exceeded before payment', { sessionId: session.id, orderId, budgetExceeded: registerResult.budgetExceeded })
        await compensateByCancellingOrder(container, em, session, scope, orderId, 'promotion_unavailable')
        throw new CrudHttpError(409, { error: '[internal] a promotion budget is exhausted', code: 'promotion_unavailable', budgetExceeded: registerResult.budgetExceeded })
      }
    }
  }

  await em.nativeUpdate(CheckoutSession, { id: session.id, ...scope }, { submitProgress: 'finalized', updatedAt: new Date() })
  session.submitProgress = 'finalized'
  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'promotions_registered', actor: 'system', payload: { orderId } })

  // ---------------------------------------------------------------------
  // Step 8 (§7.2 step 8): on-account has no gateway wait — confirm and complete directly.
  // ---------------------------------------------------------------------
  if (isOnAccount) {
    return confirmOrderAndComplete(container, em, session, scope, orderId, quoteId, {
      stockReservationKey: input.stockReservationKey,
      creditReservationKey: input.creditReservationKey,
    })
  }

  // ---------------------------------------------------------------------
  // Step 7 (§7.2 step 7, C1): gateway. Extend the cart lock through the payment window,
  // create (or reuse, idempotent-by-session) one `CheckoutTransaction`, call the gateway.
  // ---------------------------------------------------------------------
  const paymentGatewayService = tryResolve<PaymentGatewayService>(container, 'paymentGatewayService')
  if (!paymentGatewayService) {
    await compensateByCancellingOrder(container, em, session, scope, orderId, 'payment_unavailable')
    throw new CrudHttpError(502, { error: '[internal] no payment gateway is available for this method', code: 'payment_unavailable' })
  }

  const cartService = tryResolve<CartService>(container, 'cartService')
  const paymentWindowMs = 60 * 60 * 1000 + 15 * 60 * 1000
  if (cartService) {
    await cartService.lock({
      cartId: session.cartId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      checkoutSessionId: session.id,
      lockTtlMs: paymentWindowMs,
      request: input.request,
    })
  }

  let transaction = await findCheckoutTransactionBySession(em, scope, session.id)
  if (!transaction) {
    const { amount, currencyCode } = await loadOrderGrandTotalGross(em, scope, orderId)
    transaction = em.create(CheckoutTransaction, {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      linkId: session.linkId ?? null,
      sessionId: session.id,
      orderId,
      quoteId,
      status: 'processing',
      amount,
      currencyCode,
      idempotencyKey: `checkout:${session.id}:${input.attempt}:payment`,
    })
    em.persist(transaction)
    await em.flush()
  }

  let sessionResult: Awaited<ReturnType<PaymentGatewayService['createPaymentSession']>>
  try {
    sessionResult = await paymentGatewayService.createPaymentSession({
      providerKey: input.paymentMethodCode,
      paymentId: transaction.id,
      idempotencyKey: `checkout:${session.id}:${input.attempt}:payment`,
      orderId,
      amount: Number(transaction.amount),
      currencyCode: transaction.currencyCode,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    })
  } catch (err) {
    logger.error('[internal] checkout submit: payment session creation failed', { err, sessionId: session.id, orderId })
    await compensateByCancellingOrder(container, em, session, scope, orderId, 'payment_unavailable')
    throw new CrudHttpError(502, { error: '[internal] the payment gateway could not start a session', code: 'payment_unavailable' })
  }

  const mappedStatus = mapGatewayStatusToCheckoutStatus(sessionResult.transaction.unifiedStatus)
  const paymentExpiresAt = sessionResult.transaction.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000)

  await em.nativeUpdate(
    CheckoutSession,
    { id: session.id, ...scope },
    {
      status: 'awaiting_payment',
      submitProgress: 'payment_initiated',
      paymentIntentRef: sessionResult.session.sessionId,
      paymentExpiresAt,
      updatedAt: new Date(),
    },
  )
  session.status = 'awaiting_payment'
  session.submitProgress = 'payment_initiated'
  session.paymentIntentRef = sessionResult.session.sessionId
  session.paymentExpiresAt = paymentExpiresAt

  await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_initiated', actor: 'system', payload: { orderId, transactionId: transaction.id } })
  await emitCheckoutEvent('checkout.payment.initiated', {
    sessionId: session.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    orderId,
    transactionId: transaction.id,
    providerKey: input.paymentMethodCode,
  }).catch(() => undefined)

  if (mappedStatus === 'completed') {
    const result = await confirmOrderAndComplete(container, em, session, scope, orderId, quoteId, {
      stockReservationKey: input.stockReservationKey,
      creditReservationKey: input.creditReservationKey,
    })
    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_result', actor: 'system', payload: { orderId, outcome: 'succeeded' } })
    await emitCheckoutEvent('checkout.payment.succeeded', { sessionId: session.id, tenantId: scope.tenantId, organizationId: scope.organizationId, orderId, transactionId: transaction.id }).catch(() => undefined)
    return result
  }
  if (mappedStatus === 'failed' || mappedStatus === 'cancelled' || mappedStatus === 'expired') {
    await compensateByCancellingOrder(container, em, session, scope, orderId, 'payment_failed')
    await writeSessionEvent(em, { ...scope, sessionId: session.id, kind: 'payment_result', actor: 'system', payload: { orderId, outcome: 'failed' } })
    await emitCheckoutEvent('checkout.payment.failed', { sessionId: session.id, tenantId: scope.tenantId, organizationId: scope.organizationId, orderId, transactionId: transaction.id, failureCode: 'payment_failed' }).catch(() => undefined)
    throw new CrudHttpError(402, { error: '[internal] the payment was not successful', code: 'payment_failed' })
  }

  // Still pending/processing — the gateway hands the buyer off to complete payment
  // asynchronously (webhook or polling, Phase A's own pattern); this call ends at
  // `awaiting_payment`, matching §7.2 step 7's own two-part shape ("status =
  // awaiting_payment" is this synchronous call's own terminal state; "Payment result" is
  // a SEPARATE, later event).
  return {
    session,
    attempt: input.attempt,
    stockReservationKey: input.stockReservationKey,
    creditReservationKey: input.creditReservationKey,
    salesQuoteId: quoteId,
    salesOrderId: orderId,
  }
}

registerCommand(submitSessionCommand)

export { submitSessionCommand }
