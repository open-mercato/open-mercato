import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveStoreFromRequest } from '../../../../../../../lib/storeContext'
import { isStorefrontReady, STOREFRONT_NOT_READY_ERROR } from '../../../../../../../lib/storefrontReadiness'
import {
  checkoutCustomerInfoSchema,
  checkoutShippingInfoSchema,
  checkoutTransitionSchema,
} from '../../../../../../../data/validators'
import {
  findCheckoutSessionById,
  formatCheckoutSessionDto,
  getAllowedCheckoutActions,
  isSessionExpired,
} from '../../../../../../../lib/storefrontCheckoutSessions'
import { resolveCartByToken } from '../../../../../../../lib/storefrontCart'
import { placeOrderFromCart } from '../../../../../../../lib/storefrontCheckoutOrder'

export const metadata = {
  POST: { requireAuth: false },
}

type RouteContext = { params: Promise<{ id: string }> }

const transitionQuerySchema = z.object({
  storeSlug: z.string().optional(),
  tenantId: z.string().uuid().optional(),
})

const checkoutSessionSchema = z.object({
  id: z.string().uuid(),
  cartId: z.string().uuid(),
  cartToken: z.string().uuid(),
  workflowName: z.string(),
  workflowState: z.string(),
  status: z.string(),
  version: z.number().int(),
  customerInfo: z.record(z.string(), z.unknown()).nullable(),
  shippingInfo: z.record(z.string(), z.unknown()).nullable(),
  billingInfo: z.record(z.string(), z.unknown()).nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  placedOrderId: z.string().uuid().nullable(),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  allowedActions: z.array(z.string()),
})

export async function POST(req: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const commandBus = container.resolve('commandBus') as CommandBus
    const url = new URL(req.url)

    const parsedQuery = transitionQuerySchema.safeParse(
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

    const body = await req.json().catch(() => null)
    const parsedTransition = checkoutTransitionSchema.safeParse(body)
    if (!parsedTransition.success) {
      return NextResponse.json(
        { error: 'Invalid transition payload', details: parsedTransition.error.issues },
        { status: 400 },
      )
    }

    const session = await findCheckoutSessionById(
      em,
      id,
      storeCtx.organizationId,
      storeCtx.tenantId,
    )
    if (!session || session.storeId !== storeCtx.store.id) {
      return NextResponse.json({ error: 'Checkout session not found' }, { status: 404 })
    }

    if (session.status === 'active' && isSessionExpired(session)) {
      session.status = 'expired'
      session.workflowState = 'expired'
      session.version += 1
      await em.flush()
    }

    const { action, payload, idempotencyKey } = parsedTransition.data
    const allowedActions = getAllowedCheckoutActions(session)
    if (!allowedActions.includes(action)) {
      return NextResponse.json(
        {
          error: `Action "${action}" is not allowed in state "${session.workflowState}"`,
          allowedActions,
        },
        { status: 409 },
      )
    }

    // NOTE: This route currently applies transitions directly on EcommerceCheckoutSession.
    // It is the integration seam for replacing these branches with workflows.executeTransition.
    if (action === 'set_customer') {
      const parsed = checkoutCustomerInfoSchema.safeParse(payload ?? {})
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid customer payload', details: parsed.error.issues },
          { status: 400 },
        )
      }
      session.customerInfo = parsed.data
      session.workflowState = 'customer'
      session.version += 1
      await em.flush()
      return NextResponse.json({ session: formatCheckoutSessionDto(session) })
    }

    if (action === 'set_shipping') {
      const parsed = checkoutShippingInfoSchema.safeParse(payload ?? {})
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid shipping payload', details: parsed.error.issues },
          { status: 400 },
        )
      }
      session.shippingInfo = parsed.data
      session.workflowState = 'shipping'
      session.version += 1
      await em.flush()
      return NextResponse.json({ session: formatCheckoutSessionDto(session) })
    }

    if (action === 'review') {
      if (!session.customerInfo) {
        return NextResponse.json({ error: 'Customer info is required before review' }, { status: 409 })
      }
      session.workflowState = 'review'
      session.version += 1
      await em.flush()
      return NextResponse.json({ session: formatCheckoutSessionDto(session) })
    }

    if (action === 'cancel') {
      session.status = 'cancelled'
      session.workflowState = 'cancelled'
      session.version += 1
      await em.flush()
      return NextResponse.json({ session: formatCheckoutSessionDto(session) })
    }

    if (!idempotencyKey) {
      return NextResponse.json({ error: 'idempotencyKey is required for place_order' }, { status: 400 })
    }
    if (session.idempotencyKey && session.idempotencyKey !== idempotencyKey) {
      return NextResponse.json(
        { error: 'Checkout session already uses different idempotency key' },
        { status: 409 },
      )
    }
    if (session.placedOrderId) {
      return NextResponse.json({
        session: formatCheckoutSessionDto(session),
        orderId: session.placedOrderId,
      })
    }
    if (!session.customerInfo) {
      return NextResponse.json({ error: 'Customer info is required before place_order' }, { status: 409 })
    }

    const cart = await resolveCartByToken(
      em,
      session.cartToken,
      storeCtx.organizationId,
      storeCtx.tenantId,
    )
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }

    session.workflowState = 'placing_order'
    session.idempotencyKey = idempotencyKey
    session.version += 1
    await em.flush()

    try {
      const customerInfo = checkoutCustomerInfoSchema.parse(session.customerInfo)
      const { orderId } = await placeOrderFromCart(
        req,
        em,
        commandBus,
        container,
        storeCtx,
        cart,
        customerInfo,
      )

      session.status = 'completed'
      session.workflowState = 'completed'
      session.placedOrderId = orderId
      session.version += 1
      await em.flush()

      return NextResponse.json({
        session: formatCheckoutSessionDto(session),
        orderId,
      })
    } catch (error) {
      session.status = 'failed'
      session.workflowState = 'failed'
      session.version += 1
      await em.flush()
      if (error instanceof CrudHttpError) {
        return NextResponse.json(
          error.body ?? { error: error.message || 'Checkout transition failed' },
          { status: error.status },
        )
      }
      console.error('[ecommerce:checkout-sessions] place_order transition failed', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  } catch (error) {
    console.error('[ecommerce:checkout-sessions] Failed to transition checkout session', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Checkout transitions',
  methods: {
    POST: {
      summary: 'Apply checkout transition',
      description: 'Applies transition action to checkout session state machine.',
      query: transitionQuerySchema,
      requestBody: { schema: checkoutTransitionSchema },
      responses: [
        {
          status: 200,
          description: 'Session transitioned',
          schema: z.object({
            session: checkoutSessionSchema,
            orderId: z.string().uuid().optional(),
          }),
        },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
        { status: 409, description: 'Transition conflict', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
