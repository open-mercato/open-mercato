import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { ecommerceStorefrontSearchSuggestQuerySchema } from '../../../../data/validators'
import { enforceStorefrontRateLimit } from '../../../../lib/storefrontRateLimit'
import type { StoreContextService } from '../../../../lib/storeContextService'
import { parseStorefrontSearchSuggestQuery } from '../../../../lib/storefrontQuery'
import { cachedSuggestStorefrontSearch } from '../../../../lib/storefrontSearchCache'
import {
  storefrontErrorSchema,
  storefrontInvalidQueryErrorSchema,
  storefrontRouteErrorResponse,
  storefrontSuccessHeaders,
  runInStoreCacheTenant,
} from '../../storefrontRouteSupport'
import { storefrontSearchSuggestResponseSchema } from './openapiSchemas'

export const metadata = {
  path: '/ecommerce/storefront/search/suggest',
  GET: {
    requireAuth: false,
  },
}

const ANONYMOUS_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30'

export async function GET(req: Request) {
  try {
    const query = parseStorefrontSearchSuggestQuery(new URL(req.url).searchParams)
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: query.path ?? '/' })
    return await runInStoreCacheTenant(context, async () => {
      const rateLimited = await enforceStorefrontRateLimit(container, req, context, 'searchSuggest')
      if (rateLimited) return rateLimited
      const body = await cachedSuggestStorefrontSearch(container, context, query)
      return NextResponse.json(body, { headers: storefrontSuccessHeaders(context, ANONYMOUS_CACHE_CONTROL) })
    })
  } catch (error) {
    return storefrontRouteErrorResponse(error, {
      message: 'Storefront search suggest failed',
      code: 'ecommerce.storefront_search_suggest_failed',
    })
  }
}

export default GET

const storefrontSearchTag = 'Ecommerce'

const storefrontSearchSuggestGetDoc: OpenApiMethodDoc = {
  summary: 'Typeahead suggestions for the current buyer',
  description:
    'Public. Resolves the store from the Host header and the optional portal session, then returns up to `limit` products of the buyer\'s effective assortment matching `q`, with the buyer\'s formatted price, and up to `limit` visible categories whose localized name matches `q`. Products are ranked by the `tokens` or `pgvector` search strategy with the assortment scope inside the ranking query, or by the escaped `ILIKE` match when neither is available; the payload is identical either way. A `q` shorter than 2 characters returns empty arrays, never an error. Products whose availability policy hides them when out of stock are omitted. No facets are computed. Anonymous responses are `public, max-age=30, stale-while-revalidate=30`; authenticated responses are `private, no-store`. Cached server-side for 30 s per buyer context digest. Rate limited per IP and store.',
  tags: [storefrontSearchTag],
  query: ecommerceStorefrontSearchSuggestQuerySchema,
  responses: [
    { status: 200, description: 'Products and categories matching the query.', schema: storefrontSearchSuggestResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Missing `q`, or unknown, repeated or malformed query parameters', schema: storefrontInvalidQueryErrorSchema },
    { status: 401, description: 'Portal session invalid or issued for another tenant or organization', schema: storefrontErrorSchema },
    { status: 403, description: 'Draft store (only when OM_ECOMMERCE_DEV_STORE_SLUG=true)', schema: storefrontErrorSchema },
    { status: 404, description: 'No store serves this host or path', schema: storefrontErrorSchema },
    { status: 410, description: 'Store archived', schema: storefrontErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
    { status: 503, description: 'Store misconfigured (no default channel binding)', schema: storefrontErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontSearchTag,
  summary: 'Public storefront search suggestions',
  methods: {
    GET: storefrontSearchSuggestGetDoc,
  },
}
