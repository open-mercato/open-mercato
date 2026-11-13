import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { organizationScopeRequiredResponse } from '@open-mercato/shared/lib/auth/organizationScope'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { E } from '#generated/entities.ids.generated'
import {
  buildCatalogVariantLabelFilters,
  CATALOG_VARIANT_LABEL_FIELDS,
  catalogVariantLabelsQuerySchema,
  parseCatalogVariantLabelsQuery,
  toCatalogVariantLabelItem,
  type CatalogVariantLabelItem,
} from '../../lib/catalogVariantLabels'

const logger = createLogger('wms')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
}

const labelItemSchema = z.object({
  id: z.string().uuid(),
  sku: z.string().nullable(),
  name: z.string().nullable(),
  is_active: z.boolean().nullable(),
})

const labelListSchema = z.object({
  items: z.array(labelItemSchema),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
})

const errorSchema = z.object({ error: z.string() })

export async function GET(request: Request) {
  try {
    const url = new URL(request.url)
    const query = parseCatalogVariantLabelsQuery(url.searchParams)
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    if (!auth?.tenantId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const organizationScope = await resolveOrganizationScopeForRequest({
      container,
      auth,
      request,
    })
    const organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth)
    if (!organizationId) {
      return organizationScopeRequiredResponse()
    }

    const queryEngine = container.resolve('queryEngine') as QueryEngine
    const result = await queryEngine.query<Record<string, unknown>>(E.catalog.catalog_product_variant, {
      tenantId: auth.tenantId,
      organizationId,
      filters: buildCatalogVariantLabelFilters(query),
      fields: [...CATALOG_VARIANT_LABEL_FIELDS],
      sort: [{ field: 'sku', dir: SortDir.Asc }],
      page: { page: query.page, pageSize: query.pageSize },
    })
    const items = (result.items ?? [])
      .map((row) => toCatalogVariantLabelItem(row))
      .filter((item): item is CatalogVariantLabelItem => item !== null)
    const total = result.total ?? items.length
    const totalPages = query.pageSize > 0 ? Math.ceil(total / query.pageSize) : 0
    return NextResponse.json(labelListSchema.parse({ items, total, totalPages }))
  } catch (error) {
    if (isCrudHttpError(error)) {
      return NextResponse.json(error.body, { status: error.status })
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 400 })
    }
    logger.error('catalog variant label lookup failed', { err: error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'WMS',
  summary: 'Catalog variant labels',
  description:
    'Variant identity for WMS pickers and labels. Requires wms.view. Items contain only id, sku, name, and is_active. Catalog prices and other catalog fields are not returned. Tenant and organization come from the authenticated session.',
  methods: {
    GET: {
      summary: 'Search catalog variant labels',
      query: catalogVariantLabelsQuerySchema,
      responses: [
        { status: 200, description: 'Matching variant labels', schema: labelListSchema },
        { status: 400, description: 'Validation failed or organization scope required', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Forbidden', schema: errorSchema },
      ],
    },
  },
}
