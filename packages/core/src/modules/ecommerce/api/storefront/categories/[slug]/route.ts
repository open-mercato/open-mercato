import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  ecommerceStorefrontCategoryLandingQuerySchema,
  ecommerceStorefrontCategoryParamsSchema,
} from '../../../../data/validators'
import { enforceStorefrontRateLimit } from '../../../../lib/storefrontRateLimit'
import type { StoreContextService } from '../../../../lib/storeContextService'
import { cachedGetStorefrontCategoryLanding } from '../../../../lib/storefrontCategoryCache'
import { parseStorefrontCategoryLandingQuery } from '../../../../lib/storefrontQuery'
import {
  storefrontErrorResponse,
  storefrontErrorSchema,
  storefrontInvalidQueryErrorSchema,
  storefrontRouteErrorResponse,
  storefrontSuccessHeaders,
} from '../../storefrontRouteSupport'
import { storefrontCategoryLandingResponseSchema } from '../openapiSchemas'

export const metadata = {
  path: '/ecommerce/storefront/categories/[slug]',
  GET: {
    requireAuth: false,
  },
}

const ANONYMOUS_CACHE_CONTROL = 'public, max-age=30, stale-while-revalidate=30'
const CATEGORY_NOT_FOUND = { error: 'category_not_found' } as const

type CategoryRouteParams = { slug?: string }

type CategoryRouteContext = { params?: CategoryRouteParams | Promise<CategoryRouteParams> }

export async function GET(req: Request, routeContext: CategoryRouteContext = {}) {
  try {
    const query = parseStorefrontCategoryLandingQuery(new URL(req.url).searchParams)
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: query.path ?? '/' })
    const rateLimited = await enforceStorefrontRateLimit(container, req, context, 'categoryLanding')
    if (rateLimited) return rateLimited
    const params = ecommerceStorefrontCategoryParamsSchema.safeParse((await routeContext.params) ?? {})
    if (!params.success) return storefrontErrorResponse(404, { ...CATEGORY_NOT_FOUND })
    const landing = await cachedGetStorefrontCategoryLanding(container, context, params.data.slug, query)
    if (!landing) return storefrontErrorResponse(404, { ...CATEGORY_NOT_FOUND })
    const headers = storefrontSuccessHeaders(context, ANONYMOUS_CACHE_CONTROL)
    if (landing.products.sortApproximate) headers['X-Sort-Approximate'] = 'true'
    if (landing.products.sortUnavailable) headers['X-Sort-Unavailable'] = 'true'
    return NextResponse.json(landing, { headers })
  } catch (error) {
    return storefrontRouteErrorResponse(error, {
      message: 'Storefront category landing failed',
      code: 'ecommerce.storefront_category_landing_failed',
    })
  }
}

export default GET

const storefrontCategoryTag = 'Ecommerce'

const storefrontCategoryGetDoc: OpenApiMethodDoc = {
  summary: 'Get one storefront category landing for the current buyer',
  description:
    'Public. Resolves the store from the Host header and the optional portal session, then returns the category by slug with its breadcrumb, visible non-empty children and descendant-inclusive `productCount` within the buyer\'s assortment, plus a full `GET /products` response filtered to the category (`products`, same query grammar except `categoryId` / `categorySlug`). A slug that does not exist, is inactive, deleted, of another tenant, under an inactive ancestor or outside the buyer\'s effective assortment answers the same 404 `{ "error": "category_not_found" }`. `seo` fields are null until the catalog stores category SEO data. Anonymous responses are `public, max-age=30, stale-while-revalidate=30`; authenticated responses are `private, no-store`. The category block is cached server-side for 60 s per assortment scope; the embedded listing shares the `GET /products` cache. Rate limited per IP and store.',
  tags: [storefrontCategoryTag],
  pathParams: ecommerceStorefrontCategoryParamsSchema,
  query: ecommerceStorefrontCategoryLandingQuerySchema,
  responses: [
    { status: 200, description: 'The category landing as this buyer sees it.', schema: storefrontCategoryLandingResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Unknown, repeated or malformed query parameters', schema: storefrontInvalidQueryErrorSchema },
    { status: 401, description: 'Portal session invalid or issued for another tenant or organization', schema: storefrontErrorSchema },
    { status: 403, description: 'Draft store (only when OM_ECOMMERCE_DEV_STORE_SLUG=true)', schema: storefrontErrorSchema },
    { status: 404, description: 'No store serves this host or path, or the category is not visible to this buyer', schema: storefrontErrorSchema },
    { status: 410, description: 'Store archived', schema: storefrontErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
    { status: 503, description: 'Store misconfigured (no default channel binding)', schema: storefrontErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontCategoryTag,
  summary: 'Public storefront category landing',
  methods: {
    GET: storefrontCategoryGetDoc,
  },
}
