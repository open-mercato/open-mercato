import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveStoreFromRequest } from '../../../../../lib/storeContext'
import { isStorefrontReady, STOREFRONT_NOT_READY_ERROR } from '../../../../../lib/storefrontReadiness'
import {
  findCheckoutSessionById,
  formatCheckoutSessionDto,
  isSessionExpired,
} from '../../../../../lib/storefrontCheckoutSessions'
import { ensureCheckoutWorkflowInstance } from '../../../../../lib/storefrontCheckoutWorkflow'

export const metadata = {
  GET: { requireAuth: false },
}

type RouteContext = { params: Promise<{ id: string }> }

const sessionQuerySchema = z.object({
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

export async function GET(req: Request, { params }: RouteContext) {
  try {
    const { id } = await params
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)

    const parsedQuery = sessionQuerySchema.safeParse(
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
    } else if (session.status === 'active') {
      await ensureCheckoutWorkflowInstance(em, session)
    }

    return NextResponse.json({ session: formatCheckoutSessionDto(session) })
  } catch (error) {
    console.error('[ecommerce:checkout-sessions] Failed to fetch checkout session', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Checkout session details',
  methods: {
    GET: {
      summary: 'Get checkout session',
      description: 'Returns checkout session by id for current store scope.',
      query: sessionQuerySchema,
      responses: [
        { status: 200, description: 'Checkout session', schema: z.object({ session: checkoutSessionSchema }) },
      ],
      errors: [
        { status: 400, description: 'Validation error', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
