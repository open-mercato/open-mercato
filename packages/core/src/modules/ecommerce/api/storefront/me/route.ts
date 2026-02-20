import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveStoreFromRequest } from '../../../lib/storeContext'
import {
  formatCartDto,
  loadCartLines,
  resolveCartByToken,
  resolveCartToken,
} from '../../../lib/storefrontCart'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

const meQuerySchema = z.object({
  storeSlug: z.string().optional(),
  tenantId: z.string().uuid().optional(),
  cartToken: z.string().uuid().optional(),
  locale: z.string().optional(),
})

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

const meResponseSchema = z.object({
  store: z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.string(),
    defaultLocale: z.string(),
    supportedLocales: z.array(z.string()),
    defaultCurrencyCode: z.string(),
    isPrimary: z.boolean(),
    settings: z.record(z.string(), z.unknown()).nullable(),
  }),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
  channelBinding: z
    .object({
      id: z.string().uuid(),
      salesChannelId: z.string().uuid(),
      priceKindId: z.string().uuid().nullable(),
      catalogScope: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable(),
  effectiveLocale: z.string(),
  features: z.object({
    checkoutEnabled: z.boolean(),
  }),
  auth: z.object({
    isAuthenticated: z.boolean(),
    customerId: z.string().uuid().nullable(),
  }),
  cart: cartDtoSchema.nullable(),
})

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const parsedQuery = meQuerySchema.safeParse(
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

    const token = resolveCartToken(req)
    const cart = token
      ? await resolveCartByToken(em, token, storeCtx.organizationId, storeCtx.tenantId)
      : null
    const cartLines = cart
      ? await loadCartLines(em, cart.id, storeCtx.organizationId, storeCtx.tenantId)
      : []

    return NextResponse.json({
      store: storeCtx.store,
      tenantId: storeCtx.tenantId,
      organizationId: storeCtx.organizationId,
      channelBinding: storeCtx.channelBinding,
      effectiveLocale: storeCtx.effectiveLocale,
      features: {
        checkoutEnabled: Boolean(storeCtx.channelBinding?.salesChannelId),
      },
      auth: {
        isAuthenticated: false,
        customerId: null,
      },
      cart: cart ? formatCartDto(cart, cartLines) : null,
    })
  } catch (err) {
    console.error('[ecommerce:me] Failed to resolve storefront bootstrap context', {
      error: err,
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront bootstrap context',
  methods: {
    GET: {
      summary: 'Resolve storefront bootstrap payload',
      description:
        'Returns store context, tenant/org scope, checkout capability, auth placeholder, and current cart in one request. Intended for storefront app bootstrapping.',
      query: meQuerySchema,
      responses: [{ status: 200, description: 'Bootstrap payload', schema: meResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid query parameters', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
