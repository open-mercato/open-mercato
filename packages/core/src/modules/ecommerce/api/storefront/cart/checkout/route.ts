import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesOrderLine } from '@open-mercato/core/modules/sales/data/entities'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import {
  resolveCartByToken,
  loadCartLines,
  resolveCartToken,
} from '../../../../lib/storefrontCart'
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

    const cartLines = await loadCartLines(em, cart.id, organizationId, tid)
    if (cartLines.length === 0) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 })
    }

    // Generate order number
    let orderNumber: string
    try {
      const generator = container.resolve('salesDocumentNumberGenerator') as {
        generate: (opts: { kind: string; organizationId: string; tenantId: string }) => Promise<{ number: string }>
      }
      const generated = await generator.generate({ kind: 'order', organizationId, tenantId: tid })
      orderNumber = generated.number
    } catch {
      // Fallback: timestamp-based order number
      orderNumber = `SF-${Date.now()}`
    }

    const { customerInfo } = parsed.data

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const order = em.create(SalesOrder, {
      organizationId,
      tenantId: tid,
      orderNumber,
      currencyCode: cart.currencyCode,
      channelId: storeCtx.channelBinding?.salesChannelId ?? null,
      customerSnapshot: {
        name: customerInfo.name,
        email: customerInfo.email,
        phone: customerInfo.phone ?? null,
        address: customerInfo.address ?? null,
      },
      metadata: {
        sourceCartId: cart.id,
        sourceStoreId: storeCtx.store.id,
      },
      placedAt: new Date(),
    } as Record<string, unknown> as any)

    let lineNumber = 1
    for (const line of cartLines) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      em.create(SalesOrderLine, {
        organizationId,
        tenantId: tid,
        order,
        kind: 'product',
        productId: line.productId,
        productVariantId: line.variantId ?? null,
        name: line.titleSnapshot ?? null,
        quantity: String(line.quantity),
        unitPriceGross: line.unitPriceGross ?? '0',
        unitPriceNet: line.unitPriceNet ?? '0',
        currencyCode: line.currencyCode ?? cart.currencyCode,
        lineNumber: lineNumber++,
        catalogSnapshot: {
          sku: line.skuSnapshot ?? null,
          imageUrl: line.imageUrlSnapshot ?? null,
        },
      } as Record<string, unknown> as any)
    }

    cart.status = 'converted'
    cart.convertedOrderId = order.id

    await em.flush()

    return NextResponse.json({ orderId: order.id })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Cart checkout',
  methods: {
    POST: {
      summary: 'Checkout cart',
      description: 'Convert the cart to a SalesOrder. Creates order lines from cart lines and marks the cart as converted.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        cartToken: z.string().uuid().optional(),
      }),
      requestBody: { schema: checkoutBodySchema },
      responses: [{ status: 200, description: 'Order ID', schema: z.object({ orderId: z.string().uuid() }) }],
      errors: [
        { status: 400, description: 'Missing token, empty cart, or invalid body', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Store or cart not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
