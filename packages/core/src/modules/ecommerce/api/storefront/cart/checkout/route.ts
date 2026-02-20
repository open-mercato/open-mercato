import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import {
  resolveCartByToken,
  loadCartLines,
  resolveCartToken,
} from '../../../../lib/storefrontCart'
import { emitEcommerceEvent } from '../../../../events'
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

const createOrderResultSchema = z.object({
  orderId: z.string().uuid(),
})

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { message: 'Invalid currency code' })

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const parsed = currencyCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : null
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

    const salesChannelId = storeCtx.channelBinding?.salesChannelId ?? null
    if (!salesChannelId) {
      return NextResponse.json(
        { error: 'Store has no sales channel configured' },
        { status: 400 },
      )
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

    const orderCurrencyCode = normalizeCurrencyCode(cart.currencyCode)
    if (!orderCurrencyCode) {
      return NextResponse.json(
        { error: 'Invalid cart currency code configuration' },
        { status: 400 },
      )
    }
    const lineCurrencyCodes = cartLines.map((line) =>
      normalizeCurrencyCode(line.currencyCode ?? orderCurrencyCode),
    )
    const invalidCurrencyIndex = lineCurrencyCodes.findIndex((value) => value === null)
    if (invalidCurrencyIndex >= 0) {
      return NextResponse.json(
        { error: `Invalid currency code on cart line ${invalidCurrencyIndex + 1}` },
        { status: 400 },
      )
    }
    const resolvedLineCurrencyCodes = lineCurrencyCodes as string[]

    const { customerInfo } = parsed.data

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx: CommandRuntimeContext = {
      container,
      auth: null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    }

    const { result } = await commandBus.execute<
      unknown,
      { orderId: string }
    >('sales.orders.create', {
      input: {
        organizationId,
        tenantId: tid,
        currencyCode: orderCurrencyCode,
        channelId: salesChannelId,
        placedAt: new Date(),
        customerSnapshot: {
          customer: {
            displayName: customerInfo.name,
            primaryEmail: customerInfo.email,
            primaryPhone: customerInfo.phone ?? null,
          },
          shippingAddress: customerInfo.address ?? null,
        },
        metadata: {
          sourceCartId: cart.id,
          sourceStoreId: storeCtx.store.id,
        },
        lines: cartLines.map((line, i) => ({
          currencyCode: resolvedLineCurrencyCodes[i],
          kind: 'product' as const,
          productId: line.productId ?? undefined,
          productVariantId: line.variantId ?? undefined,
          name: line.titleSnapshot ?? undefined,
          quantity: line.quantity,
          unitPriceNet: line.unitPriceNet ?? 0,
          unitPriceGross: line.unitPriceGross ?? 0,
          lineNumber: i + 1,
          catalogSnapshot: {
            sku: line.skuSnapshot ?? null,
            imageUrl: line.imageUrlSnapshot ?? null,
          },
        })),
      },
      ctx,
    })

    const normalizedResult = createOrderResultSchema.safeParse(result)
    if (!normalizedResult.success) {
      console.error('[ecommerce:checkout] Invalid sales.orders.create result', {
        issues: normalizedResult.error.issues,
        result,
      })
      return NextResponse.json(
        { error: 'Invalid order creation response from sales module' },
        { status: 500 },
      )
    }
    const orderId = normalizedResult.data.orderId

    cart.status = 'converted'
    cart.convertedOrderId = orderId
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
      description: 'Convert the cart to a SalesOrder via the command bus. Validates channel binding, creates order with guest customer snapshot, marks the cart as converted, and emits ecommerce.cart.converted event.',
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
