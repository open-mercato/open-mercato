import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveStoreFromRequest } from '../../../lib/storeContext'
import { isStorefrontReady, STOREFRONT_NOT_READY_ERROR } from '../../../lib/storefrontReadiness'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
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
    if (!isStorefrontReady(storeCtx)) {
      return NextResponse.json({ error: STOREFRONT_NOT_READY_ERROR }, { status: 404 })
    }

    return NextResponse.json({
      store: storeCtx.store,
      tenantId: storeCtx.tenantId,
      organizationId: storeCtx.organizationId,
      channelBinding: storeCtx.channelBinding,
      effectiveLocale: storeCtx.effectiveLocale,
    })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const storeResponseSchema = z.object({
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
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront context',
  methods: {
    GET: {
      summary: 'Resolve store context',
      description:
        'Resolves the store configuration from the Host header or storeSlug query parameter. Used by storefront apps to bootstrap locale, currency, and channel configuration.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        locale: z.string().optional(),
      }),
      responses: [{ status: 200, description: 'Store context', schema: storeResponseSchema }],
      errors: [
        { status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
