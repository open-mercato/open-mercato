import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { ecommerceStorefrontProductListQuerySchema } from '../../../data/validators'
import { enforceStorefrontRateLimit } from '../../../lib/storefrontRateLimit'
import type { StoreContextService } from '../../../lib/storeContextService'
import { cachedListStorefrontProducts } from '../../../lib/storefrontProductCache'
import { parseStorefrontProductListQuery } from '../../../lib/storefrontQuery'
import {
  storefrontErrorSchema,
  storefrontInvalidQueryErrorSchema,
  storefrontRouteErrorResponse,
  storefrontSuccessHeaders,
  runInStoreCacheTenant,
} from '../storefrontRouteSupport'
import { storefrontProductListResponseSchema } from './openapiSchemas'

export const metadata = {
  path: '/ecommerce/storefront/products',
  GET: {
    requireAuth: false,
  },
}

const ANONYMOUS_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30'

export async function GET(req: Request) {
  try {
    const query = parseStorefrontProductListQuery(new URL(req.url).searchParams)
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: query.path ?? '/' })
    return await runInStoreCacheTenant(context, async () => {
      const rateLimited = await enforceStorefrontRateLimit(container, req, context, 'products')
      if (rateLimited) return rateLimited
      const body = await cachedListStorefrontProducts(container, context, query)
      const headers = storefrontSuccessHeaders(context, ANONYMOUS_CACHE_CONTROL)
      if (body.sortApproximate) headers['X-Sort-Approximate'] = 'true'
      if (body.sortUnavailable) headers['X-Sort-Unavailable'] = 'true'
      return NextResponse.json(body, { headers })
    })
  } catch (error) {
    return storefrontRouteErrorResponse(error, {
      message: 'Storefront product listing failed',
      code: 'ecommerce.storefront_products_failed',
    })
  }
}

export default GET

const storefrontProductsTag = 'Ecommerce'

const storefrontProductsGetDoc: OpenApiMethodDoc = {
  summary: 'List storefront products for the current buyer',
  description:
    'Public. Resolves the store from the Host header and the optional portal session, then lists the products of the buyer\'s effective assortment with buyer-resolved prices. Unknown, repeated or malformed parameters are rejected with 400. Options use bracket notation (`options[color]=red,blue`). `availability=` is page-scoped: `total` counts the pre-availability set and a page may be short. Facets count each dimension against every other active filter (cross-exclusion); category, tag, option and product-type counts are shared per assortment scope (and empty past 10 000 products in the search universe), `priceRange` spans the buyer\'s own prices over the filtered set without the price filter, and `availability` counts the returned page only. `X-Sort-Approximate: true` marks a price order past the sort cap; `X-Sort-Unavailable: true` marks a declined price sort. Anonymous responses are `public, max-age=30, stale-while-revalidate=30`; authenticated responses are `private, no-store`. Cached server-side for 30 s per buyer context digest. Rate limited per IP and store.',
  tags: [storefrontProductsTag],
  query: ecommerceStorefrontProductListQuerySchema,
  responses: [
    { status: 200, description: 'Products of the buyer\'s effective assortment.', schema: storefrontProductListResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Unknown, repeated or malformed query parameters', schema: storefrontInvalidQueryErrorSchema },
    { status: 401, description: 'Portal session invalid or issued for another tenant or organization', schema: storefrontErrorSchema },
    { status: 403, description: 'Draft store (only when OM_ECOMMERCE_DEV_STORE_SLUG=true)', schema: storefrontErrorSchema },
    { status: 404, description: 'No store serves this host or path', schema: storefrontErrorSchema },
    { status: 410, description: 'Store archived', schema: storefrontErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
    { status: 503, description: 'Store misconfigured (no default channel binding)', schema: storefrontErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontProductsTag,
  summary: 'Public storefront product listing',
  methods: {
    GET: storefrontProductsGetDoc,
  },
}
