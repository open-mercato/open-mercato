import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveStoreFromRequest } from '../../../../../lib/storeContext'
import { isStorefrontReady, STOREFRONT_NOT_READY_ERROR } from '../../../../../lib/storefrontReadiness'
import { resolveCartByToken } from '../../../../../lib/storefrontCart'
import {
  checkoutSessionCreateSchema,
} from '../../../../../data/validators'
import {
  createCheckoutSession,
  findActiveCheckoutSessionByCart,
  formatCheckoutSessionDto,
  isSessionExpired,
} from '../../../../../lib/storefrontCheckoutSessions'

export const metadata = {
  POST: { requireAuth: false },
}

const createSessionQuerySchema = z.object({
  storeSlug: z.string().optional(),
  tenantId: z.string().uuid().optional(),
})

const CHECKOUT_SESSION_TTL_MS = 2 * 60 * 60 * 1000

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)

    const parsedQuery = createSessionQuerySchema.safeParse(
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
    const parsedBody = checkoutSessionCreateSchema.safeParse(body)
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsedBody.error.issues },
        { status: 400 },
      )
    }

    const cart = await resolveCartByToken(
      em,
      parsedBody.data.cartToken,
      storeCtx.organizationId,
      storeCtx.tenantId,
    )
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }

    const existing = await findActiveCheckoutSessionByCart(
      em,
      cart.id,
      storeCtx.organizationId,
      storeCtx.tenantId,
    )

    if (existing) {
      if (isSessionExpired(existing)) {
        existing.status = 'expired'
        existing.workflowState = 'expired'
        existing.version += 1
        await em.flush()
      } else {
        return NextResponse.json({ session: formatCheckoutSessionDto(existing) })
      }
    }

    const expiresAt = new Date(Date.now() + CHECKOUT_SESSION_TTL_MS)
    const session = await createCheckoutSession(
      em,
      storeCtx,
      cart.id,
      cart.token,
      expiresAt,
    )

    return NextResponse.json({ session: formatCheckoutSessionDto(session) }, { status: 201 })
  } catch (error) {
    console.error('[ecommerce:checkout-sessions] Failed to create checkout session', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

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

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Checkout sessions',
  methods: {
    POST: {
      summary: 'Create checkout session',
      description: 'Creates (or returns) active checkout session for cart token.',
      query: createSessionQuerySchema,
      requestBody: { schema: checkoutSessionCreateSchema },
      responses: [
        {
          status: 201,
          description: 'Checkout session created',
          schema: z.object({ session: checkoutSessionSchema }),
        },
        {
          status: 200,
          description: 'Active checkout session already exists',
          schema: z.object({ session: checkoutSessionSchema }),
        },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Store or cart not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
