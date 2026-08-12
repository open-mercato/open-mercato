import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { EudrProductMapping } from '../../../data/entities'
import { EUDR_COMMODITIES } from '../../../data/validators'
import { suggestCommodityForHsCode } from '../../../lib/reference-data'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['eudr.mappings.view'] },
}

const logger = createLogger('eudr').child({ component: 'api/product-mappings/suggestions' })

type RequestContext = {
  container: { resolve: <T = unknown>(name: string) => T }
  em: EntityManager
  tenantId: string
  organizationId: string
}

type CatalogProductRecord = Record<string, unknown> & {
  id?: unknown
  title?: unknown
  name?: unknown
  sku?: unknown
  hs_code?: unknown
}

async function resolveRequestContext(req: Request): Promise<RequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()

  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('eudr.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('eudr.errors.organization_required', 'Organization context is required'),
    })
  }

  return {
    container,
    em: container.resolve('em') as EntityManager,
    tenantId: auth.tenantId,
    organizationId,
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function loadCatalogProducts(ctx: RequestContext): Promise<CatalogProductRecord[]> {
  try {
    const queryEngine = ctx.container.resolve<QueryEngine>('queryEngine')
    const products: CatalogProductRecord[] = []
    for (let page = 1; page <= 5; page += 1) {
      const result = await queryEngine.query<CatalogProductRecord>(E.catalog.catalog_product, {
        fields: ['id', 'title', 'name', 'sku', 'hs_code'],
        filters: [
          { field: 'hs_code', op: 'exists', value: true },
          { field: 'hs_code', op: 'ne', value: '' },
        ],
        page: { page, pageSize: 100 },
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
      })
      products.push(...result.items)
      if (result.items.length < 100) break
    }
    return products
  } catch (error) {
    logger.debug('Catalog product scan failed; returning no mapping suggestions', { err: error })
    return []
  }
}

export async function GET(req: Request) {
  try {
    const ctx = await resolveRequestContext(req)
    const products = await loadCatalogProducts(ctx)
    const candidates = products
      .map((product) => {
        const productId = readString(product.id)
        const hsCode = readString(product.hs_code)
        const suggestedCommodity = suggestCommodityForHsCode(hsCode)
        if (!productId || !hsCode || !suggestedCommodity) return null
        return {
          productId,
          name: readString(product.title) ?? readString(product.name) ?? productId,
          sku: readString(product.sku),
          hsCode,
          suggestedCommodity,
        }
      })
      .filter((item): item is {
        productId: string
        name: string
        sku: string | null
        hsCode: string
        suggestedCommodity: NonNullable<ReturnType<typeof suggestCommodityForHsCode>>
      } => item !== null)

    const productIds = candidates.map((item) => item.productId)
    const activeMappings = productIds.length
      ? await ctx.em.find(EudrProductMapping, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          deletedAt: null,
          productId: { $in: productIds },
        } as FilterQuery<EudrProductMapping>)
      : []
    const mappedProductIds = new Set(activeMappings.map((mapping) => mapping.productId))

    return Response.json({
      items: candidates
        .filter((item) => !mappedProductIds.has(item.productId))
        .slice(0, 200),
    })
  } catch (error) {
    if (isCrudHttpError(error)) {
      return Response.json(error.body, { status: error.status })
    }
    const { translate } = await resolveTranslations()
    logger.error('Product mapping suggestions loading failed', { err: error })
    return Response.json(
      { error: translate('eudr.errors.mapping_suggestions_failed', 'Failed to load EUDR mapping suggestions') },
      { status: 500 },
    )
  }
}

const suggestionSchema = z.object({
  productId: z.string().uuid(),
  name: z.string(),
  sku: z.string().nullable(),
  hsCode: z.string(),
  suggestedCommodity: z.enum(EUDR_COMMODITIES),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'EUDR',
  summary: 'Suggest EUDR product mappings from catalog HS codes',
  methods: {
    GET: {
      summary: 'Product mapping suggestions',
      responses: [
        { status: 200, description: 'Suggested product mappings', schema: z.object({ items: z.array(suggestionSchema) }) },
        { status: 400, description: 'Invalid organization context', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Forbidden', schema: z.object({ error: z.string() }) },
        { status: 500, description: 'Product mapping suggestions loading failed', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
