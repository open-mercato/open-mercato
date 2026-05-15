/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { MaterialPrice } from '../../data/entities'
import {
  createMaterialPriceSchema,
  updateMaterialPriceSchema,
} from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createMaterialsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'
import '../../commands'

const MATERIAL_PRICE_ENTITY_ID = 'materials:material_price'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    materialSupplierLinkId: z.string().uuid().optional(),
    currencyId: z.string().uuid().optional(),
    // Convenience filter — narrows to prices that are valid at a given timestamp.
    // Implemented as `validFrom <= effectiveAt <= validTo` (with NULL = open).
    effectiveAt: z.coerce.date().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['materials.price.view'] },
  POST: { requireAuth: true, requireFeatures: ['materials.price.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['materials.price.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['materials.price.manage'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: MaterialPrice,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  list: {
    schema: listSchema,
    entityId: MATERIAL_PRICE_ENTITY_ID,
    fields: [
      'id',
      'material_supplier_link_id',
      'price_amount',
      'currency_id',
      'base_currency_amount',
      'base_currency_at',
      'valid_from',
      'valid_to',
      'is_active',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = { deletedAt: null }
      if (query.materialSupplierLinkId) filters.materialSupplierLinkId = query.materialSupplierLinkId
      if (query.currencyId) filters.currencyId = query.currencyId
      if (query.effectiveAt) {
        const effectiveAt = query.effectiveAt instanceof Date ? query.effectiveAt : new Date(query.effectiveAt)
        // Validity window predicate: (validFrom IS NULL OR validFrom <= eff)
        //                       AND (validTo IS NULL OR validTo >= eff)
        filters.$and = [
          { $or: [{ validFrom: null }, { validFrom: { $lte: effectiveAt } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: effectiveAt } }] },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'materials.price.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return createMaterialPriceSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.priceId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'materials.price.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return updateMaterialPriceSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'materials.price.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('materials.price.errors.id_required', 'Price id is required'),
          })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

const { POST, PUT, DELETE } = crud

export { POST, PUT, DELETE }
export const GET = crud.GET

const priceListItemSchema = z.object({
  id: z.string().uuid(),
  material_supplier_link_id: z.string().uuid(),
  price_amount: z.string(),
  currency_id: z.string().uuid(),
  base_currency_amount: z.string().nullable().optional(),
  base_currency_at: z.string().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_to: z.string().nullable().optional(),
  is_active: z.boolean(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const openApi = createMaterialsCrudOpenApi({
  resourceName: 'MaterialPrice',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(priceListItemSchema),
  create: {
    schema: createMaterialPriceSchema,
    description:
      'Adds a price record to a supplier link. `currency_id` must reference a Currency in the same organization. `valid_to` defaults to NULL (open-ended); when present must be >= `valid_from`. Phase 1 does not enforce non-overlapping validity windows — procurement chooses one price per moment via valid_from sort.',
  },
  update: {
    schema: updateMaterialPriceSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a price. Changing currency or amount invalidates the cached `base_currency_amount` (subscriber recomputes on next FX event). `base_currency_amount` and `base_currency_at` cannot be set directly via this endpoint — strict-mode zod rejects them.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a price record. Audit log preserves the prior amount and validity window.',
  },
})
