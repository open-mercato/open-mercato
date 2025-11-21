import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogPriceKind } from '../../data/entities'
import { priceKindCreateSchema, priceKindUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_price_kind'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.settings.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    isPromotion: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
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
      F.organization_id,
      F.tenant_id,
      F.code,
      F.title,
      F.display_mode,
      F.currency_code,
      F.is_promotion,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      code: F.code,
      title: F.title,
      displayMode: F.display_mode,
      currencyCode: F.currency_code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${term}%`
        filters.$or = [{ [F.code]: { $ilike: like } }, { [F.title]: { $ilike: like } }]
      }
      const isPromotion = parseBooleanFlag(query.isPromotion)
      if (isPromotion !== undefined) {
        filters[F.is_promotion] = isPromotion
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) {
        filters[F.is_active] = isActive
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'catalog.priceKinds.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(priceKindCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.priceKindId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.priceKinds.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(priceKindUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.priceKinds.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Price kind id is required.') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
