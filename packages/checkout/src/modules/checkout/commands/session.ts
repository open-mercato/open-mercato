import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
// `checkout` and `customer_accounts` are both `packages/core` modules — see
// `lib/currentSessionRoute.ts`'s header note for the same precedent.
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { CheckoutLink, CheckoutSession } from '../data/entities'
import type { CheckoutSessionUpdateInput } from '../data/validators'
import { lookupCartPeerByToken } from '../lib/cartPeer'
import {
  assertCartMatchesCheckoutScope,
  resolveRequestStoreIdForConsistencyCheck,
} from '../lib/cartSessionConsistency'
import { seedCartFromCheckoutLink } from '../lib/payLinkCartSeed'
import { generateCheckoutSessionToken } from '../lib/sessionToken'
import { assertValidCheckoutSessionTransition } from '../lib/session-status-machine'
import { writeSessionEvent } from '../lib/sessionEvents'
import { tryResolve } from '../lib/tryResolve'
import { emitCheckoutEvent } from '../events'

/** §8.1-equivalent for the new aggregate — the `resourceKind` every mutating session
 * command/route pairs with `resourceId: session.id` for the optimistic-lock guard (C20). */
export const CHECKOUT_SESSION_RESOURCE_KIND = 'checkout.session'

// §4.1: no explicit default session TTL is named for the `open` state in this Step's own
// scope (the `expire-checkout-sessions` job that reads it is Step 2.13+ — see NOTIFY.md).
// One hour is a conservative, documented placeholder consistent with the funnel's own
// framing ("abandoned checkouts are the majority", §6) — long enough for a buyer to finish
// a short form, short enough that an abandoned session does not linger indefinitely.
const DEFAULT_SESSION_OPEN_TTL_MS = 60 * 60 * 1000

/** Soft-dependency gate (C10/D-R5-18): `checkout` declares no `requires` on `cart` —
 * every session route/command checks `cartService`'s DI presence itself and answers
 * `503 checkout_sessions_unavailable` when it is absent. */
export function assertCartPeerAvailable(ctx: CommandRuntimeContext): void {
  const resolved = tryResolve<unknown>(ctx.container as { resolve: <R = unknown>(name: string) => R }, 'cartService')
  if (!resolved) {
    throw new CrudHttpError(503, {
      error: '[internal] checkout sessions are unavailable without the cart module',
      code: 'checkout_sessions_unavailable',
    })
  }
}

/**
 * §9.0 "One live session per cart": a new session on a cart cancels an earlier `open` or
 * `awaiting_approval` session for it. An earlier session already `submitting` or
 * `awaiting_payment` refuses the new creation with `409 submit_in_progress` instead.
 */
async function supersedeOpenSessionsForCart(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string; cartId: string },
): Promise<void> {
  const existing = await em.find(CheckoutSession, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cartId: scope.cartId,
    status: { $in: ['open', 'awaiting_approval', 'submitting', 'awaiting_payment'] },
  } as any)

  for (const row of existing) {
    if (row.status === 'submitting' || row.status === 'awaiting_payment') {
      throw new CrudHttpError(409, {
        error: '[internal] a submit attempt is already in flight for this cart',
        code: 'submit_in_progress',
      })
    }
  }

  for (const row of existing) {
    assertValidCheckoutSessionTransition(row.status, 'canceled')
    const affected = await em.nativeUpdate(
      CheckoutSession,
      { id: row.id, tenantId: scope.tenantId, organizationId: scope.organizationId, status: row.status },
      { status: 'canceled', updatedAt: new Date() },
    )
    // A concurrent writer already moved this row out of the status this loop observed —
    // skipped, never reported as an error (same CAS-race tolerance `expireApprovals.ts`
    // and `decideApproval` already establish for this codebase).
    if (affected === 0) continue
    await writeSessionEvent(em, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      sessionId: row.id,
      kind: 'session_canceled',
      actor: 'system',
      payload: { reason: 'superseded' },
    })
    await emitCheckoutEvent('checkout.session.canceled', {
      sessionId: row.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      cartId: scope.cartId,
      reason: 'superseded',
    }).catch(() => undefined)
  }
}

export type CheckoutSessionCreateCommandInput =
  | { source: 'cart'; cartToken: string; request?: Request | null }
  // Release 5, Step 3.5 (B.2, D-R5-19): merchant-initiated, a bare link slug. Only a
  // `checkoutType: 'simple_checkout'` link reaches this branch — a `checkoutType:
  // 'pay_link'` link 404s here (Phase A keeps its own cart-less path end to end, C10).
  | { source: 'link'; slug: string; request?: Request | null }

export type CheckoutSessionCreateResult = {
  token: string
  session: CheckoutSession
}

/** Common shape both `source` branches resolve into before the shared session-persist
 * tail below — a cart peer read for `'cart'`, a freshly-seeded cart for `'link'`. */
type ResolvedSessionCart = {
  id: string
  tenantId: string
  organizationId: string
  storeId: string | null
  channel: string
  currencyCode: string
  locale: string
  customerId: string | null
  customerUserId: string | null
}

/**
 * `POST /api/checkout/sessions` — `{ source: 'cart' }` (§9.0, B.1) or `{ source: 'link' }`
 * (merchant-initiated simple-checkout links, B.2, Step 3.5).
 */
const createSessionCommand: CommandHandler<CheckoutSessionCreateCommandInput, CheckoutSessionCreateResult> = {
  id: 'checkout.session.create',
  isUndoable: false,
  async execute(input, ctx) {
    assertCartPeerAvailable(ctx)
    const em = ctx.container.resolve('em') as EntityManager

    let cart: ResolvedSessionCart
    let linkId: string | null = null

    if (input.source === 'cart') {
      // Scope-free, FK-id + snapshot read (`lib/cartPeer.ts`) — a bare cart token is the
      // only credential a guest buyer holds (§9.0), so there is no tenant/organization to
      // filter by until AFTER this resolves. The found row's own scope becomes the new
      // session's ground truth.
      const found = await lookupCartPeerByToken(em, input.cartToken)
      if (!found || found.kind !== 'basket') {
        throw new CrudHttpError(404, { error: '[internal] cart not found' })
      }
      if (found.status !== 'active') {
        throw new CrudHttpError(409, { error: '[internal] cart is not active', code: 'cart_not_active' })
      }

      // D-R5-21-style identity binding, applied at session CREATION too — §9.0's own text:
      // "When the cart has customer_user_id, the request must also carry the matching
      // customer session ... otherwise 404 with the unknown-cart body (D-R5-21)."
      if (found.customerUserId) {
        const auth = input.request ? await getCustomerAuthFromRequest(input.request) : null
        if (!auth || auth.sub !== found.customerUserId) {
          throw new CrudHttpError(404, { error: '[internal] cart not found' })
        }
      }
      cart = found
    } else {
      const link = await findOneWithDecryption(em, CheckoutLink, { slug: input.slug, deletedAt: null })
      // A `checkoutType: 'pay_link'` link (Phase A) never passes through `CheckoutSession`
      // at all (§3.2) — the identical not-found body a nonexistent slug gets, so this
      // branch discloses nothing about which case is true.
      if (!link || link.checkoutType !== 'simple_checkout') {
        throw new CrudHttpError(404, { error: '[internal] checkout link not found' })
      }
      const commandBus = ctx.container.resolve('commandBus') as CommandBus
      const seeded = await seedCartFromCheckoutLink({
        em,
        container: ctx.container,
        commandBus,
        link,
        request: input.request,
      })
      linkId = link.id
      cart = {
        id: seeded.cartId,
        tenantId: seeded.tenantId,
        organizationId: seeded.organizationId,
        storeId: seeded.storeId,
        channel: seeded.channel,
        currencyCode: seeded.currencyCode,
        locale: seeded.locale,
        customerId: seeded.customerId,
        customerUserId: seeded.customerUserId,
      }
    }

    // C9 (D-R5-19, X13). The session about to be persisted copies the cart's own
    // channel/currency/tenant/organization VERBATIM, so those four comparisons are
    // tautological by construction on this path — the one check with real teeth here is
    // the store comparison, against a FRESH request-resolved store (a storefront cart
    // token presented on the wrong store's host). Running the full, reusable guard here
    // (not a narrowed one) means Step 4.1's submit-time call exercises the IDENTICAL
    // function, never a second implementation of the same four comparisons.
    const resolvedStoreId = await resolveRequestStoreIdForConsistencyCheck(ctx.container, cart.storeId, input.request)
    assertCartMatchesCheckoutScope({
      cart: {
        storeId: cart.storeId,
        channel: cart.channel,
        currencyCode: cart.currencyCode,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
      },
      session: {
        channel: cart.channel,
        currencyCode: cart.currencyCode,
        tenantId: cart.tenantId,
        organizationId: cart.organizationId,
      },
      resolvedStoreId,
    })

    await supersedeOpenSessionsForCart(em, {
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      cartId: cart.id,
    })

    const { token, tokenHash } = generateCheckoutSessionToken()
    const now = new Date()
    const session = em.create(CheckoutSession, {
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      tokenHash,
      cartId: cart.id,
      storeId: cart.storeId,
      linkId,
      channel: cart.channel as CheckoutSession['channel'],
      status: 'open',
      step: 'contact',
      currencyCode: cart.currencyCode,
      locale: cart.locale,
      customerId: cart.customerId,
      customerUserId: cart.customerUserId,
      expiresAt: new Date(now.getTime() + DEFAULT_SESSION_OPEN_TTL_MS),
    } as any)
    em.persist(session)
    await em.flush()

    await writeSessionEvent(em, {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      sessionId: session.id,
      kind: 'session_created',
      actor: 'buyer',
      payload: { cartId: session.cartId, channel: session.channel, status: session.status },
    })

    await emitCheckoutEvent('checkout.session.created', {
      sessionId: session.id,
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      cartId: session.cartId,
      channel: session.channel,
      storeId: session.storeId,
      linkId: session.linkId,
      customerId: session.customerId,
    }).catch(() => undefined)

    return { token, session }
  },
}

export type CheckoutSessionUpdateCommandInput = {
  sessionId: string
  tenantId: string
  organizationId: string
  patch: CheckoutSessionUpdateInput
}

export type CheckoutSessionUpdateResult = { session: CheckoutSession }

/**
 * `PATCH /api/checkout/sessions/current` (§9's route table: "Contact, addresses, consent,
 * terms acceptance"). Binding (D-R5-33) and token resolution already ran at the route
 * layer (`lib/currentSessionRoute.ts#resolveCurrentSession`) before this command is ever
 * dispatched — mirrors `cart.get`'s own division of labor with `resolveCurrentCart`.
 */
const updateSessionCommand: CommandHandler<CheckoutSessionUpdateCommandInput, CheckoutSessionUpdateResult> = {
  id: 'checkout.session.update',
  isUndoable: false,
  async execute(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const session = await findOneWithDecryption(
      em,
      CheckoutSession,
      { id: input.sessionId, ...scope },
      undefined,
      scope,
    )
    if (!session) throw new CrudHttpError(404, { error: '[internal] checkout session not found' })
    if (session.status !== 'open') {
      throw new CrudHttpError(409, { error: '[internal] checkout session is not open', code: 'session_not_open' })
    }

    await enforceCommandOptimisticLockWithGuards(ctx.container, {
      resourceKind: CHECKOUT_SESSION_RESOURCE_KIND,
      resourceId: session.id,
      current: session.updatedAt ?? null,
      request: ctx.request ?? null,
    })

    const patch = input.patch
    const changedKeys: string[] = []
    if (patch.email !== undefined) {
      session.email = patch.email ?? null
      changedKeys.push('email')
    }
    if (patch.phone !== undefined) {
      session.phone = patch.phone ?? null
      changedKeys.push('phone')
    }
    if (patch.shippingAddress !== undefined) {
      session.shippingAddress = (patch.shippingAddress as Record<string, unknown> | null) ?? null
      changedKeys.push('shippingAddress')
    }
    if (patch.billingAddress !== undefined) {
      session.billingAddress = (patch.billingAddress as Record<string, unknown> | null) ?? null
      changedKeys.push('billingAddress')
    }
    if (patch.billingSameAsShipping !== undefined) {
      session.billingSameAsShipping = patch.billingSameAsShipping
      changedKeys.push('billingSameAsShipping')
    }
    if (patch.locale !== undefined && patch.locale != null) {
      session.locale = patch.locale
      changedKeys.push('locale')
    }
    if (patch.consentFlags !== undefined) {
      session.consentFlags = (patch.consentFlags as Record<string, unknown> | null) ?? null
      changedKeys.push('consentFlags')
    }
    if (patch.termsAccepted !== undefined) {
      session.termsAcceptedAt = patch.termsAccepted ? new Date() : null
      changedKeys.push('termsAcceptedAt')
    }

    await em.flush()

    if (changedKeys.length) {
      await writeSessionEvent(em, {
        tenantId: session.tenantId,
        organizationId: session.organizationId,
        sessionId: session.id,
        kind: 'field_updated',
        actor: 'buyer',
        payload: { changedKeys },
      })
    }

    return { session }
  },
}

registerCommand(createSessionCommand)
registerCommand(updateSessionCommand)

export { createSessionCommand, updateSessionCommand }
