import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandHandler } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CheckoutSession } from '../data/entities'
import { resolveDestinationAddress, hashAddressForCache, hashCartLinesForCache } from '../lib/deliveryAddress'
import { getOrComputeDeliveryOptions } from '../lib/deliveryRateCache'
import { computeDeliveryOptions } from '../lib/deliveryRateQuote'
import { lookupCartLinePeers } from '../lib/cartLinesPeer'
import { evaluateDeliveryDiscount } from '../lib/promotionsDeliveryEvaluation'
import { writeSessionEvent } from '../lib/sessionEvents'
import { CHECKOUT_SESSION_RESOURCE_KIND } from './session'

// Release 5, Step 2.13 (B.3, §5.3/§5.4, §9's own route table: `POST /sessions/current/
// delivery`). The buyer sends back only a `deliveryMethodCode` from the options
// `GET .../delivery-options` just offered — the command RE-resolves the real rate
// server-side (same cache, so this is cheap) rather than trusting a client-supplied
// price (§13 Entitlement).

export type CheckoutSessionSelectDeliveryCommandInput = {
  sessionId: string
  tenantId: string
  organizationId: string
  deliveryMethodCode: string
}

export type CheckoutSessionSelectDeliveryResult = {
  session: CheckoutSession
  deliveryDiscount: {
    promotionId: string
    promotionName: string
    amountNet: string
    amountGross: string
  } | null
}

const selectDeliveryCommand: CommandHandler<
  CheckoutSessionSelectDeliveryCommandInput,
  CheckoutSessionSelectDeliveryResult
> = {
  id: 'checkout.session.selectDelivery',
  isUndoable: false,
  async execute(input, ctx) {
    const em = ctx.container.resolve('em') as EntityManager
    // `ctx.container` is an `AwilixContainer` — structurally compatible with the narrow
    // `{ resolve, register, hasRegistration? }` shapes `lib/tryResolve.ts` and friends
    // declare for themselves, but TypeScript's generic-method variance needs a nudge.
    const container = ctx.container as unknown as {
      resolve: <T = unknown>(name: string) => T
      register: (registrations: Record<string, unknown>) => unknown
      hasRegistration?: (name: string) => boolean
    }
    const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
    const session = await findOneWithDecryption(em, CheckoutSession, { id: input.sessionId, ...scope }, undefined, scope)
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

    const destination = resolveDestinationAddress(session.shippingAddress)
    if (!destination) {
      throw new CrudHttpError(422, {
        error: '[internal] a shipping address is required before selecting a delivery method',
        code: 'delivery_unavailable',
      })
    }

    const lines = session.cartId ? await lookupCartLinePeers(em, session.cartId, scope) : []
    const addressHash = hashAddressForCache(destination)
    const cartHash = hashCartLinesForCache(lines)

    const options = await getOrComputeDeliveryOptions(
      container,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, sessionId: session.id },
      addressHash,
      cartHash,
      () =>
        computeDeliveryOptions(
          container,
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

    const selected = options.find((option) => option.deliveryMethodCode === input.deliveryMethodCode)
    if (!selected) {
      throw new CrudHttpError(422, {
        error: '[internal] the selected delivery method is not currently available',
        code: 'delivery_unavailable',
      })
    }

    const deliveryDiscount = await evaluateDeliveryDiscount(
      container,
      em,
      {
        sessionId: session.id,
        tenantId: session.tenantId,
        organizationId: session.organizationId,
        cartId: session.cartId ?? null,
        currencyCode: session.currencyCode,
        deliveryMethodCode: selected.deliveryMethodCode,
        deliveryCost: selected.cost,
      },
    )

    const now = new Date()
    session.shippingMethod = {
      providerKey: selected.providerKey,
      serviceCode: selected.serviceCode,
      deliveryMethodCode: selected.deliveryMethodCode,
      price: selected.cost,
      currencyCode: selected.currencyCode,
      estimatedDays: selected.estimatedDays,
      source: selected.source,
      quotedAt: now.toISOString(),
    }
    // Partial §4.1 `quoted_totals` — only the delivery-specific keys this Step owns.
    // `goodsGross`/`payableGross` are submit's own concern (Step 4.1) and are deliberately
    // not written here; see `NOTIFY.md`.
    session.quotedTotals = {
      ...(session.quotedTotals ?? {}),
      deliveryMethodCode: selected.deliveryMethodCode,
      deliveryCost: selected.cost,
      deliveryDiscount: deliveryDiscount ? deliveryDiscount.amountGross : null,
      currencyCode: selected.currencyCode,
      evaluatedAt: now.toISOString(),
    }
    await em.flush()

    await writeSessionEvent(em, {
      tenantId: session.tenantId,
      organizationId: session.organizationId,
      sessionId: session.id,
      kind: 'rate_quoted',
      actor: 'buyer',
      payload: { deliveryMethodCode: selected.deliveryMethodCode, source: selected.source },
    })
    if (deliveryDiscount) {
      await writeSessionEvent(em, {
        tenantId: session.tenantId,
        organizationId: session.organizationId,
        sessionId: session.id,
        kind: 'promotions_evaluated',
        actor: 'system',
        payload: { promotionId: deliveryDiscount.promotionId },
      })
    }

    return {
      session,
      deliveryDiscount: deliveryDiscount
        ? {
            promotionId: deliveryDiscount.promotionId,
            promotionName: deliveryDiscount.promotionName,
            amountNet: deliveryDiscount.amountNet,
            amountGross: deliveryDiscount.amountGross,
          }
        : null,
    }
  },
}

registerCommand(selectDeliveryCommand)

export { selectDeliveryCommand }
