import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rateLimitErrorSchema } from '@open-mercato/shared/lib/ratelimit/helpers'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { ecommercePriceDisplayModeSchema, ecommerceStorefrontContextQuerySchema } from '../../../data/validators'
import { isStorefrontResolutionError } from '../../../lib/storeContext'
import { enforceStorefrontRateLimit } from '../../../lib/storefrontRateLimit'
import type { StoreContextService } from '../../../lib/storeContextService'
import type { StoreContext } from '../../../lib/types'
import { runInStoreCacheTenant } from '../storefrontRouteSupport'

export const metadata = {
  path: '/ecommerce/storefront/context',
  GET: {
    requireAuth: false,
  },
}

const VARY_HEADER = 'Cookie, Authorization, X-Locale, Accept-Language'
const ANONYMOUS_CACHE_CONTROL = 'public, max-age=60'
const PRIVATE_CACHE_CONTROL = 'private, no-store'
const ERROR_CACHE_CONTROL = 'no-store'

const logger = createLogger('ecommerce').child({ component: 'storefront-context-route' })

export type StorefrontBuyerNames = {
  displayName: string | null
  companyName: string | null
}

export type StorefrontContextResponse = {
  store: {
    id: string
    code: string
    name: string
    slug: string
    status: 'active'
    defaultLocale: string
    supportedLocales: string[]
    defaultCurrencyCode: string
    settings: StoreContext['store']['settings']
  }
  effectiveLocale: string
  requestedLocale: string | null
  supportedLocales: string[]
  currencyCode: string
  buyer: {
    isAuthenticated: boolean
    taxMode: StoreContext['buyer']['taxMode']
    displayName: string | null
    companyName: string | null
    allowPurchaseOnAccount: boolean
  }
}

export function projectStorefrontContext(context: StoreContext, names: StorefrontBuyerNames): StorefrontContextResponse {
  const { store, buyer } = context
  return {
    store: {
      id: store.id,
      code: store.code,
      name: store.name,
      slug: store.slug,
      status: store.status,
      defaultLocale: store.defaultLocale,
      supportedLocales: [...store.supportedLocales],
      defaultCurrencyCode: store.defaultCurrencyCode,
      settings: store.settings,
    },
    effectiveLocale: context.effectiveLocale,
    requestedLocale: context.requestedLocale,
    supportedLocales: [...store.supportedLocales],
    currencyCode: context.currencyCode,
    buyer: {
      isAuthenticated: buyer.isAuthenticated,
      taxMode: buyer.taxMode,
      displayName: buyer.isAuthenticated ? names.displayName : null,
      companyName: buyer.isAuthenticated ? names.companyName : null,
      allowPurchaseOnAccount: buyer.allowPurchaseOnAccount,
    },
  }
}

function nonEmptyOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

async function loadBuyerNames(em: EntityManager, context: StoreContext): Promise<StorefrontBuyerNames> {
  const { buyer } = context
  if (!buyer.isAuthenticated || !buyer.customerUserId) return { displayName: null, companyName: null }
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const user = await findOneWithDecryption(
    em,
    CustomerUser,
    { id: buyer.customerUserId, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  const company = buyer.companyId
    ? await findOneWithDecryption(
        em,
        CustomerEntity,
        { id: buyer.companyId, ...scope, deletedAt: null },
        undefined,
        scope,
      )
    : null
  return {
    displayName: nonEmptyOrNull(user?.displayName),
    companyName: nonEmptyOrNull(company?.displayName),
  }
}

function errorResponse(status: number, code: string): NextResponse {
  return NextResponse.json(
    { error: code },
    { status, headers: { 'Cache-Control': ERROR_CACHE_CONTROL, Vary: VARY_HEADER } },
  )
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const parsed = ecommerceStorefrontContextQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
  if (!parsed.success) return errorResponse(400, 'invalid_query')

  try {
    const container = await createRequestContainer()
    const service = container.resolve('storeContextService') as StoreContextService
    const context = await service.resolve(req, { pathname: parsed.data.path ?? '/' })
    return await runInStoreCacheTenant(context, async () => {
      const rateLimited = await enforceStorefrontRateLimit(container, req, context, 'context')
      if (rateLimited) return rateLimited
      const em = container.resolve('em') as EntityManager
      const names = await loadBuyerNames(em, context)
      const body = projectStorefrontContext(context, names)
      return NextResponse.json(body, {
        headers: {
          'Cache-Control': context.buyer.isAuthenticated ? PRIVATE_CACHE_CONTROL : ANONYMOUS_CACHE_CONTROL,
          Vary: VARY_HEADER,
        },
      })
    })
  } catch (error) {
    if (isStorefrontResolutionError(error)) return errorResponse(error.status, error.code)
    logger.error('Storefront context resolution failed', { err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'ecommerce',
      code: 'ecommerce.storefront_context_failed',
    })
    return errorResponse(500, 'internal_error')
  }
}

export default GET

const storefrontContextTag = 'Ecommerce'

export const storefrontContextResponseSchema = z.object({
  store: z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    slug: z.string(),
    status: z.literal('active'),
    defaultLocale: z.string(),
    supportedLocales: z.array(z.string()),
    defaultCurrencyCode: z.string(),
    settings: z.record(z.string(), z.unknown()),
  }),
  effectiveLocale: z.string(),
  requestedLocale: z.string().nullable(),
  supportedLocales: z.array(z.string()),
  currencyCode: z.string(),
  buyer: z.object({
    isAuthenticated: z.boolean(),
    taxMode: ecommercePriceDisplayModeSchema,
    displayName: z.string().nullable(),
    companyName: z.string().nullable(),
    allowPurchaseOnAccount: z.boolean(),
  }),
})

const storefrontContextErrorSchema = z.object({ error: z.string() })

const storefrontContextGetDoc: OpenApiMethodDoc = {
  summary: 'Resolve the storefront context for the current host',
  description:
    'Public, unauthenticated. Resolves the store from the Host header (or `storeSlug` when OM_ECOMMERCE_DEV_STORE_SLUG=true) and the optional portal session, and returns a safe projection of the store and buyer context. Anonymous responses are `public, max-age=60`; authenticated responses are `private, no-store`. Rate limited per IP and store.',
  tags: [storefrontContextTag],
  query: ecommerceStorefrontContextQuerySchema,
  responses: [
    { status: 200, description: 'Storefront context resolved.', schema: storefrontContextResponseSchema },
  ],
  errors: [
    { status: 400, description: 'Invalid query, or storeSlug used while the development flag is off', schema: storefrontContextErrorSchema },
    { status: 401, description: 'Portal session invalid or issued for another tenant or organization', schema: storefrontContextErrorSchema },
    { status: 403, description: 'Draft store (only when OM_ECOMMERCE_DEV_STORE_SLUG=true)', schema: storefrontContextErrorSchema },
    { status: 404, description: 'No store serves this host or path', schema: storefrontContextErrorSchema },
    { status: 410, description: 'Store archived', schema: storefrontContextErrorSchema },
    { status: 429, description: 'Too many requests', schema: rateLimitErrorSchema },
    { status: 503, description: 'Store misconfigured (no default channel binding)', schema: storefrontContextErrorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: storefrontContextTag,
  summary: 'Public storefront context',
  methods: {
    GET: storefrontContextGetDoc,
  },
}
