import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import {
  ecommerceStorefrontProductDetailQuerySchema,
  ecommerceStorefrontProductParamsSchema,
} from '../../../../data/validators'
import { enforceStorefrontRateLimit } from '../../../../lib/storefrontRateLimit'
import type { StoreContextService } from '../../../../lib/storeContextService'
import { cachedGetStorefrontProductDetail } from '../../../../lib/storefrontProductCache'
import { parseStorefrontProductDetailQuery } from '../../../../lib/storefrontQuery'
import {
  storefrontErrorResponse,
  storefrontErrorSchema,
  storefrontInvalidQueryErrorSchema,
  storefrontRouteErrorResponse,
  storefrontSuccessHeaders,
} from '../../storefrontRouteSupport'
import { storefrontProductDetailResponseSchema } from '../openapiSchemas'

export const metadata = {
  path: '/ecommerce/storefront/products/[idOrHandle]',
  GET: {
    requireAuth: false,
  },
}

const ANONYMOUS_CACHE_CONTROL = 'public, max-age=60'
const PRODUCT_NOT_FOUND = { error: 'product_not_found' } as const

type ProductRouteParams = { idOrHandle?: string }

type ProductRouteContext = { params?: ProductRouteParams | Promise<ProductRouteParams> }

export async function GET(req: Request, routeContext: ProductRouteContext = {}) {
  try {
    const query = parseStorefrontProductDetailQuery(new URL(req.url).searchParams)
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: query.path ?? '/' })
    const rateLimited = await enforceStorefrontRateLimit(container, req, context, 'productDetail')
    if (rateLimited) return rateLimited
    const params = ecommerceStorefrontProductParamsSchema.safeParse((await routeContext.params) ?? {})
    if (!params.success) return storefrontErrorResponse(404, { ...PRODUCT_NOT_FOUND })
    const detail = await cachedGetStorefrontProductDetail(container, context, params.data.idOrHandle, {
      variantId: query.variantId ?? null,
      locale: query.locale ?? null,
    })
    if (!detail) return storefrontErrorResponse(404, { ...PRODUCT_NOT_FOUND })
    return NextResponse.json(detail, { headers: storefrontSuccessHeaders(context, ANONYMOUS_CACHE_CONTROL) })
  } catch (error) {
    return storefrontRouteErrorResponse(error, {
      message: 'Storefront product detail failed',
      code: 'ecommerce.storefront_product_detail_failed',
    })
  }
}

export default GET

const storefrontProductTag = 'Ecommerce'

const storefrontProductGetDoc: OpenApiMethodDoc = {
  summary: 'Get one storefront product for the current buyer',
  description:
    'Public. Resolves the store from the Host header and the optional portal session, then returns the product by UUID or handle with buyer-resolved prices per variant. A product that does not exist, is inactive, deleted, of another tenant or outside the buyer\'s effective assortment answers the same 404 `{ "error": "product_not_found" }`. `variantId` preselects a variant; top-level `priceTiers` are the selected variant\'s tiers. Anonymous responses are `public, max-age=60`; authenticated responses are `private, no-store`. Cached server-side for 60 s per buyer context digest. Rate limited per IP and store.',
  tags: [storefrontProductTag],
  pathParams: ecommerceStorefrontProductParamsSchema,
  query: ecommerceStorefrontProductDetailQuerySchema,
  responses: [
    { status: 200, description: 'The product as this buyer sees it.', schema: storefrontProductDetailResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Unknown, repeated or malformed query parameters', schema: storefrontInvalidQueryErrorSchema },
    { status: 401, description: 'Portal session invalid or issued for another tenant or organization', schema: storefrontErrorSchema },
    { status: 403, description: 'Draft store (only when OM_ECOMMERCE_DEV_STORE_SLUG=true)', schema: storefrontErrorSchema },
    { status: 404, description: 'No store serves this host or path, or the product is not visible to this buyer', schema: storefrontErrorSchema },
    { status: 410, description: 'Store archived', schema: storefrontErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
    { status: 503, description: 'Store misconfigured (no default channel binding)', schema: storefrontErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontProductTag,
  summary: 'Public storefront product detail',
  methods: {
    GET: storefrontProductGetDoc,
  },
}
