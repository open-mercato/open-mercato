import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesShippingMethod } from '../../data/entities'
import { shippingMethodCreateSchema, shippingMethodUpdateSchema } from '../../data/validators'
import { resolveCrudRecordId, withScopedPayload } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_shipping_method'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    currency: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.settings.manage'] },
}

export const metadata = routeMetadata

function buildFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search && query.search.trim().length > 0) {
    const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
    filters.$or = [
      { name: { $ilike: term } },
      { code: { $ilike: term } },
      { carrier_code: { $ilike: term } },
      { service_level: { $ilike: term } },
    ]
  }
  if (query.currency && query.currency.trim().length > 0) {
    filters.currency_code = query.currency.trim().toUpperCase()
  }
  if (query.isActive === 'true') filters.is_active = true
  if (query.isActive === 'false') filters.is_active = false
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesShippingMethod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_shipping_method,
    fields: [
      F.id,
      F.name,
      F.code,
      F.description,
      F.carrier_code,
      F.service_level,
      F.estimated_transit_days,
      F.base_rate_net,
      F.base_rate_gross,
      F.currency_code,
      F.is_active,
      F.metadata,
      F.organization_id,
      F.tenant_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      id: F.id,
      name: F.name,
      code: F.code,
      carrierCode: F.carrier_code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildFilters(query),
    transformItem: (item: any) => ({
      id: item.id,
      name: item.name,
      code: item.code,
      description: item.description ?? null,
      carrierCode: item.carrier_code ?? null,
      serviceLevel: item.service_level ?? null,
      estimatedTransitDays: item.estimated_transit_days ?? null,
      baseRateNet: item.base_rate_net ?? '0',
      baseRateGross: item.base_rate_gross ?? '0',
      currencyCode: item.currency_code ?? null,
      isActive: item.is_active ?? false,
      metadata: item.metadata ?? null,
      organizationId: item.organization_id ?? null,
      tenantId: item.tenant_id ?? null,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }),
  },
  actions: {
    create: {
      commandId: 'sales.shipping-methods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return shippingMethodCreateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: ({ result }) => ({ id: result?.shippingMethodId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.shipping-methods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return shippingMethodUpdateSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.shipping-methods.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
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
