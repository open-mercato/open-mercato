import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import {
  resolveCartByToken,
  formatCartDto,
  loadCartLines,
  resolveCartToken,
} from '../../../../lib/storefrontCart'
import { filterByPriceKind } from '../../../../lib/storefrontProducts'
import { EcommerceCartLine } from '../../../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  POST: { requireAuth: false },
}

const addLineBodySchema = z.object({
  cartToken: z.string().uuid().optional(),
  productId: z.string().uuid(),
  variantId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().min(1).default(1),
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
    const parsed = addLineBodySchema.safeParse(rawBody)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { productId, variantId, quantity } = parsed.data

    const bodyToken = parsed.data.cartToken ?? null
    const headerToken = resolveCartToken(req)
    const token = bodyToken ?? headerToken

    if (!token) {
      return NextResponse.json({ error: 'Cart token is required' }, { status: 400 })
    }

    const cart = await resolveCartByToken(em, token, storeCtx.organizationId, storeCtx.tenantId)
    if (!cart) {
      return NextResponse.json({ error: 'Cart not found' }, { status: 404 })
    }

    const { organizationId, tenantId: tid } = storeCtx

    const [product, variant] = await Promise.all([
      em.findOne(CatalogProduct, { id: productId, organizationId, tenantId: tid, deletedAt: null }),
      variantId
        ? em.findOne(CatalogProductVariant, { id: variantId, organizationId, tenantId: tid, deletedAt: null })
        : Promise.resolve(null),
    ])

    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Resolve price snapshot
    const allPrices = await em.find(
      CatalogProductPrice,
      {
        $or: [
          { product: productId },
          ...(variantId ? [{ variant: variantId }] : []),
        ],
        organizationId,
        tenantId: tid,
      },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
    )

    const filteredPrices = filterByPriceKind(allPrices, storeCtx.channelBinding?.priceKindId)
    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const bestPrice = await pricingService.resolvePrice(filteredPrices, {
      channelId: storeCtx.channelBinding?.salesChannelId ?? null,
      quantity: 1,
      date: new Date(),
    })

    // Upsert cart line (same productId + variantId → add quantities)
    const lines = await loadCartLines(em, cart.id, organizationId, tid)
    const existing = lines.find(
      (l) => l.productId === productId && (l.variantId ?? null) === (variantId ?? null),
    )

    if (existing) {
      existing.quantity = existing.quantity + quantity
      if (bestPrice) {
        existing.unitPriceNet = bestPrice.unitPriceNet ?? null
        existing.unitPriceGross = bestPrice.unitPriceGross ?? null
        existing.currencyCode = bestPrice.currencyCode
      }
    } else {
      const titleSnapshot = variant?.name ?? product.title
      const skuSnapshot = variant?.sku ?? product.sku ?? null
      const imageUrlSnapshot = product.defaultMediaUrl ?? null

      em.create(EcommerceCartLine, {
        organizationId,
        tenantId: tid,
        cartId: cart.id,
        productId,
        variantId: variantId ?? null,
        quantity,
        unitPriceNet: bestPrice?.unitPriceNet ?? null,
        unitPriceGross: bestPrice?.unitPriceGross ?? null,
        currencyCode: bestPrice?.currencyCode ?? cart.currencyCode,
        titleSnapshot,
        skuSnapshot,
        imageUrlSnapshot,
      })
    }

    await em.flush()

    const updatedLines = await loadCartLines(em, cart.id, organizationId, tid)
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
  summary: 'Cart lines',
  methods: {
    POST: {
      summary: 'Add line to cart',
      description: 'Add a product (and optional variant) to the cart. If the same product/variant exists, quantities are summed.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
      }),
      requestBody: { schema: addLineBodySchema },
      responses: [{ status: 200, description: 'Updated cart', schema: z.object({ cart: cartDtoSchema }) }],
      errors: [
        { status: 400, description: 'Invalid request or missing token', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Cart or product not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
