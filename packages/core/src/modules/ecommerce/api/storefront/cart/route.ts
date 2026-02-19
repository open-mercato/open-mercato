import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveStoreFromRequest } from '../../../lib/storeContext'
import {
  resolveCartByToken,
  getOrCreateCart,
  formatCartDto,
  loadCartLines,
  resolveCartToken,
} from '../../../lib/storefrontCart'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId') ?? null

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const token = resolveCartToken(req)
    if (!token) {
      return NextResponse.json({ cart: null })
    }

    const cart = await resolveCartByToken(em, token, storeCtx.organizationId, storeCtx.tenantId)
    if (!cart) {
      return NextResponse.json({ cart: null })
    }

    const lines = await loadCartLines(em, cart.id, storeCtx.organizationId, storeCtx.tenantId)
    return NextResponse.json({ cart: formatCartDto(cart, lines) })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId') ?? null

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const token = resolveCartToken(req)
    const cart = await getOrCreateCart(em, storeCtx, token)
    const lines = await loadCartLines(em, cart.id, storeCtx.organizationId, storeCtx.tenantId)

    return NextResponse.json({ token: cart.token, cart: formatCartDto(cart, lines) })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const cartLineSchema = z.object({
  id: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable(),
  quantity: z.number().int(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  currencyCode: z.string().nullable(),
  titleSnapshot: z.string().nullable(),
  skuSnapshot: z.string().nullable(),
  imageUrlSnapshot: z.string().nullable(),
})

const cartDtoSchema = z.object({
  id: z.string().uuid(),
  token: z.string().uuid(),
  status: z.string(),
  currencyCode: z.string(),
  locale: z.string().nullable(),
  lines: z.array(cartLineSchema),
  itemCount: z.number().int(),
  subtotalGross: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront cart',
  methods: {
    GET: {
      summary: 'Get cart',
      description: 'Load the current cart by token. Returns null if not found.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: 'Cart or null', schema: z.object({ cart: cartDtoSchema.nullable() }) }],
      errors: [{ status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) }],
    },
    POST: {
      summary: 'Create or get cart',
      description: 'Create a new cart for the store, or return an existing one if a valid cartToken is provided.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'Cart with token',
          schema: z.object({ token: z.string().uuid(), cart: cartDtoSchema }),
        },
      ],
      errors: [{ status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) }],
    },
  },
}
