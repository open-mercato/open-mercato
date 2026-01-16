import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesShippingMethod } from '../../data/entities'
import { shippingMethodCreateSchema, shippingMethodUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/sales_shipping_method'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultDeleteRequestSchema,
} from '../openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'

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

const shippingMethodItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  carrierCode: z.string().nullable(),
  providerKey: z.string().nullable(),
  serviceLevel: z.string().nullable(),
  estimatedTransitDays: z.number().nullable(),
  baseRateNet: z.string(),
  baseRateGross: z.string(),
  currencyCode: z.string().nullable(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  providerSettings: z.record(z.string(), z.unknown()).nullable().optional(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

const shippingMethodListResponseSchema = createPagedListResponseSchema(shippingMethodItemSchema)

function buildFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search && query.search.trim().length > 0) {
    const term = `%${escapeLikePattern(query.search.trim())}%`
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
  const isActive = parseBooleanToken(query.isActive)
  if (isActive !== null) filters.is_active = isActive
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
      F.provider_key,
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
    decorateCustomFields: { entityIds: [E.sales.sales_shipping_method] },
    transformItem: (item: any) => {
      const base = {
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description ?? null,
        carrierCode: item.carrier_code ?? null,
        providerKey: item.provider_key ?? null,
        serviceLevel: item.service_level ?? null,
        estimatedTransitDays: item.estimated_transit_days ?? null,
        baseRateNet: item.base_rate_net ?? '0',
        baseRateGross: item.base_rate_gross ?? '0',
        currencyCode: item.currency_code ?? null,
        isActive: item.is_active ?? false,
        metadata: item.metadata ?? null,
        providerSettings:
          item.metadata && typeof item.metadata === 'object'
            ? (item.metadata as any).providerSettings ?? null
            : null,
        organizationId: item.organization_id ?? null,
        tenantId: item.tenant_id ?? null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
      const { custom } = splitCustomFieldPayload(item)
      return Object.keys(custom).length ? { ...base, customFields: custom } : base
    },
  },
  actions: {
    create: {
      commandId: 'sales.shipping-methods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(shippingMethodCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.shippingMethodId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.shipping-methods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(shippingMethodUpdateSchema, raw ?? {}, ctx, translate)
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

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Shipping method',
  pluralName: 'Shipping methods',
  description: 'Maintain shipping services, carrier mappings, and pricing defaults for order fulfillment.',
  querySchema: listSchema,
  listResponseSchema: shippingMethodListResponseSchema,
  create: { schema: shippingMethodCreateSchema },
  update: { schema: shippingMethodUpdateSchema },
  del: { schema: defaultDeleteRequestSchema },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
