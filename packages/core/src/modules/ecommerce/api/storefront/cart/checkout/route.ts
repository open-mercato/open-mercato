import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import { isStorefrontReady, STOREFRONT_NOT_READY_ERROR } from '../../../../lib/storefrontReadiness'
import {
  resolveCartByToken,
  resolveCartToken,
} from '../../../../lib/storefrontCart'
import { emitEcommerceEvent } from '../../../../events'
import {
  createCheckoutSession,
  findActiveCheckoutSessionByCart,
} from '../../../../lib/storefrontCheckoutSessions'
import { placeOrderFromCart } from '../../../../lib/storefrontCheckoutOrder'
import {
  applyCheckoutWorkflowAction,
  ensureCheckoutWorkflowInstance,
  setCheckoutWorkflowTerminalState,
} from '../../../../lib/storefrontCheckoutWorkflow'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const checkoutBodySchema = z.object({
  cartToken: z.string().uuid().optional(),
  customerInfo: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional(),
    address: z.string().optional(),
  }),
})

const checkoutQuerySchema = z.object({
  storeSlug: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  cartToken: z.string().uuid().optional(),
  locale: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const parsedQuery = checkoutQuerySchema.safeParse(
      Object.fromEntries(url.searchParams.entries()),
    )
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parsedQuery.error.issues },
        { status: 400 },
      )
    }
    const tenantId = parsedQuery.data.tenantId ?? null

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }
    if (!isStorefrontReady(storeCtx)) {
      return NextResponse.json({ error: STOREFRONT_NOT_READY_ERROR }, { status: 404 })
    }

    const rawBody = await req.json().catch(() => null)
    const parsed = checkoutBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const bodyToken = parsed.data.cartToken ?? null
    const headerToken = resolveCartToken(req)
    const token = bodyToken ?? headerToken

    if (!token) {
      return NextResponse.json({ error: 'Cart token is required' }, { status: 400 })
    }

    const { organizationId, tenantId: tid } = storeCtx

    const cart = await resolveCartByToken(em, token, organizationId, tid)
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }
    const activeSession =
      (await findActiveCheckoutSessionByCart(em, cart.id, organizationId, tid)) ??
      (await createCheckoutSession(
        em,
        storeCtx,
        cart.id,
        cart.token,
        new Date(Date.now() + 2 * 60 * 60 * 1000),
      ))
    await ensureCheckoutWorkflowInstance(em, activeSession)

    const { customerInfo } = parsed.data
    activeSession.customerInfo = customerInfo
    const customerTransition = await applyCheckoutWorkflowAction(
      em,
      container,
      activeSession,
      'set_customer',
      { customerInfo },
    )
    if (!customerTransition.ok) {
      return NextResponse.json({ error: customerTransition.error }, { status: 409 })
    }
    const reviewTransition = await applyCheckoutWorkflowAction(
      em,
      container,
      activeSession,
      'review',
      { customerInfo, shippingInfo: activeSession.shippingInfo ?? null },
    )
    if (!reviewTransition.ok) {
      return NextResponse.json({ error: reviewTransition.error }, { status: 409 })
    }
    const placingOrderTransition = await applyCheckoutWorkflowAction(
      em,
      container,
      activeSession,
      'place_order',
      { customerInfo, shippingInfo: activeSession.shippingInfo ?? null },
    )
    if (!placingOrderTransition.ok) {
      return NextResponse.json({ error: placingOrderTransition.error }, { status: 409 })
    }
    activeSession.idempotencyKey = req.headers.get('x-idempotency-key') ?? randomUUID()
    activeSession.version += 1
    await em.flush()

    try {
      const commandBus = container.resolve('commandBus')
      const { orderId } = await placeOrderFromCart(
        req,
        em,
        commandBus,
        container,
        storeCtx,
        cart,
        customerInfo,
      )

      activeSession.status = 'completed'
      const completedTransition = await setCheckoutWorkflowTerminalState(
        em,
        container,
        activeSession,
        'completed',
      )
      if (!completedTransition.ok) {
        return NextResponse.json({ error: completedTransition.error }, { status: 409 })
      }
      activeSession.placedOrderId = orderId
      activeSession.version += 1
      await em.flush()

      try {
        await emitEcommerceEvent('ecommerce.cart.converted', {
          id: cart.id,
          organizationId,
          tenantId: tid,
          orderId,
          storeId: storeCtx.store.id,
        })
      } catch (eventErr) {
        // Checkout should succeed even if notification/event side effects fail.
        console.error('[ecommerce:checkout] Failed to emit ecommerce.cart.converted', {
          error: eventErr,
          orderId,
          cartId: cart.id,
        })
      }

      return NextResponse.json({ orderId })
    } catch (err: unknown) {
      activeSession.status = 'failed'
      const failedTransition = await setCheckoutWorkflowTerminalState(
        em,
        container,
        activeSession,
        'failed',
      )
      if (!failedTransition.ok) {
        return NextResponse.json({ error: failedTransition.error }, { status: 409 })
      }
      activeSession.version += 1
      await em.flush()
      throw err
    }
  } catch (err: unknown) {
    if (err instanceof CrudHttpError) {
      return NextResponse.json(
        err.body ?? { error: err.message || 'Request failed' },
        { status: err.status },
      )
    }
    console.error('[ecommerce:checkout] Checkout failed', {
      error: err,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Cart checkout',
  methods: {
    POST: {
      summary: 'Checkout cart',
      description: 'Legacy adapter endpoint for one-shot checkout. Internally creates/updates checkout session and places order.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      requestBody: { schema: checkoutBodySchema },
      responses: [{ status: 200, description: 'Order ID', schema: z.object({ orderId: z.string().uuid() }) }],
      errors: [
        { status: 400, description: 'Missing token, empty cart, invalid body, or no sales channel configured', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Store or cart not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
