import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CatalogPriceKind } from '@open-mercato/core/modules/catalog/data/entities'
import { sanitizeSearchTerm, parseBooleanFlag } from '@open-mercato/core/modules/catalog/api/helpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_price_kind'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    isActive: z.string().optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogPriceKind,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_price_kind,
    fields: [
      F.id,
      F.code,
      F.title,
      F.currency_code,
      F.display_mode,
      F.is_active,
    ],
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${term}%`
        filters.$or = [{ [F.code]: { $ilike: like } }, { [F.title]: { $ilike: like } }]
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) {
        filters[F.is_active] = isActive
      }
      return filters
    },
  },
})

export const GET = crud.GET
