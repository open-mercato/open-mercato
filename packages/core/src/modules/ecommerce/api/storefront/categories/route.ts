import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { ecommerceStorefrontCategoryTreeQuerySchema } from '../../../data/validators'
import type { StoreContextService } from '../../../lib/storeContextService'
import { cachedGetStorefrontCategoryTree } from '../../../lib/storefrontCategoryCache'
import { parseStorefrontCategoryTreeQuery } from '../../../lib/storefrontQuery'
import {
  storefrontErrorSchema,
  storefrontInvalidQueryErrorSchema,
  storefrontRouteErrorResponse,
  storefrontSuccessHeaders,
} from '../storefrontRouteSupport'
import { storefrontCategoryTreeResponseSchema } from './openapiSchemas'

export const metadata = {
  path: '/ecommerce/storefront/categories',
  GET: {
    requireAuth: false,
    rateLimit: { points: 120, duration: 60, keyPrefix: 'ecommerce_storefront_categories' },
  },
}

const ANONYMOUS_CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=60'

export async function GET(req: Request) {
  try {
    const query = parseStorefrontCategoryTreeQuery(new URL(req.url).searchParams)
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: query.path ?? '/' })
    const body = await cachedGetStorefrontCategoryTree(container, context, query)
    return NextResponse.json(body, { headers: storefrontSuccessHeaders(context, ANONYMOUS_CACHE_CONTROL) })
  } catch (error) {
    return storefrontRouteErrorResponse(error, {
      message: 'Storefront category tree failed',
      code: 'ecommerce.storefront_categories_failed',
    })
  }
}

export default GET

const storefrontCategoriesTag = 'Ecommerce'

const storefrontCategoriesGetDoc: OpenApiMethodDoc = {
  summary: 'List the storefront category tree for the current buyer',
  description:
    'Public. Resolves the store from the Host header and the optional portal session, then returns the visible category tree below `parentId` (the roots when omitted), `depth` levels deep (all levels when omitted). `productCount` is descendant-inclusive and counts only products inside the buyer\'s effective assortment; categories the buyer cannot browse are absent, and empty categories are absent unless `includeEmpty=true`. A `parentId` that is unknown or not visible to the buyer yields an empty tree, identical to a nonexistent one. A nested node beyond `depth` has empty `children` and `hasChildren: true`. Anonymous responses are `public, max-age=300, stale-while-revalidate=60`; authenticated responses are `private, no-store`. Cached server-side for 300 s per assortment scope. Rate limited per IP.',
  tags: [storefrontCategoriesTag],
  query: ecommerceStorefrontCategoryTreeQuerySchema,
  responses: [
    { status: 200, description: 'The category tree within the buyer\'s assortment.', schema: storefrontCategoryTreeResponseSchema },
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
  tag: storefrontCategoriesTag,
  summary: 'Public storefront category tree',
  methods: {
    GET: storefrontCategoriesGetDoc,
  },
}
