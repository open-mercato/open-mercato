import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveStoreFromRequest } from '../../../../../lib/storeContext'
import {
  resolveCartByToken,
  formatCartDto,
  loadCartLines,
  resolveCartToken,
} from '../../../../../lib/storefrontCart'
import { EcommerceCartLine } from '../../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  PUT: { requireAuth: false },
  DELETE: { requireAuth: false },
}

type RouteContext = { params: Promise<{ lineId: string }> }

const updateLineBodySchema = z.object({
  quantity: z.number().int().min(0),
})

export async function PUT(req: Request, { params }: RouteContext) {
  try {
    const { lineId } = await params
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
      return NextResponse.json({ error: 'Cart token is required' }, { status: 400 })
    }

    const cart = await resolveCartByToken(em, token, storeCtx.organizationId, storeCtx.tenantId)
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }

    const rawBody = await req.json().catch(() => null)
    const parsed = updateLineBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const line = await em.findOne(EcommerceCartLine, {
      id: lineId,
      cartId: cart.id,
      organizationId: storeCtx.organizationId,
      tenantId: storeCtx.tenantId,
    })

    if (!line) {
      return NextResponse.json({ error: 'Cart line not found' }, { status: 404 })
    }

    if (parsed.data.quantity <= 0) {
      await em.removeAndFlush(line)
    } else {
      line.quantity = parsed.data.quantity
      await em.flush()
    }

    const updatedLines = await loadCartLines(em, cart.id, storeCtx.organizationId, storeCtx.tenantId)
    return NextResponse.json({ cart: formatCartDto(cart, updatedLines) })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: RouteContext) {
  try {
    const { lineId } = await params
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
      return NextResponse.json({ error: 'Cart token is required' }, { status: 400 })
    }

    const cart = await resolveCartByToken(em, token, storeCtx.organizationId, storeCtx.tenantId)
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }

    const line = await em.findOne(EcommerceCartLine, {
      id: lineId,
      cartId: cart.id,
      organizationId: storeCtx.organizationId,
      tenantId: storeCtx.tenantId,
    })

    if (!line) {
      return NextResponse.json({ error: 'Cart line not found' }, { status: 404 })
    }

    await em.removeAndFlush(line)

    const updatedLines = await loadCartLines(em, cart.id, storeCtx.organizationId, storeCtx.tenantId)
    return NextResponse.json({ cart: formatCartDto(cart, updatedLines) })
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
  summary: 'Cart line operations',
  methods: {
    PUT: {
      summary: 'Update cart line quantity',
      description: 'Update the quantity of a cart line. If quantity is 0 or less, the line is removed.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      requestBody: { schema: updateLineBodySchema },
      responses: [{ status: 200, description: 'Updated cart', schema: z.object({ cart: cartDtoSchema }) }],
      errors: [
        { status: 400, description: 'Missing token or invalid body', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Cart or line not found', schema: z.object({ error: z.string() }) },
      ],
    },
    DELETE: {
      summary: 'Remove cart line',
      description: 'Remove a line from the cart.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      responses: [{ status: 200, description: 'Updated cart', schema: z.object({ cart: cartDtoSchema }) }],
      errors: [
        { status: 400, description: 'Missing token', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Cart or line not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
