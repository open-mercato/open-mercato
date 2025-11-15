import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesTaxRate } from '../../data/entities'
import { taxRateCreateSchema, taxRateUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_tax_rate'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    country: z.string().optional(),
    region: z.string().optional(),
    channelId: z.string().uuid().optional(),
    isCompound: z.string().optional(),
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

const taxRateResponseItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  rate: z.number(),
  countryCode: z.string().nullable(),
  regionCode: z.string().nullable(),
  postalCode: z.string().nullable(),
  city: z.string().nullable(),
  customerGroupId: z.string().uuid().nullable(),
  productCategoryId: z.string().uuid().nullable(),
  channelId: z.string().uuid().nullable(),
  priority: z.number().nullable(),
  isCompound: z.boolean(),
  metadata: z.record(z.string(), z.any()).nullable().optional(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.any()).optional(),
})

const taxRateListResponseSchema = z.object({
  items: z.array(taxRateResponseItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
})

const taxRateDeleteSchema = z.object({
  id: z.string().uuid(),
})

function buildFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search && query.search.trim().length > 0) {
    const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
    filters.$or = [
      { name: { $ilike: term } },
      { code: { $ilike: term } },
      { country_code: { $ilike: term } },
      { region_code: { $ilike: term } },
      { postal_code: { $ilike: term } },
      { city: { $ilike: term } },
    ]
  }
  if (query.country && query.country.trim().length > 0) {
    filters.country_code = query.country.trim().toUpperCase()
  }
  if (query.region && query.region.trim().length > 0) {
    filters.region_code = query.region.trim()
  }
  if (query.channelId) {
    filters.channel_id = query.channelId
  }
  if (query.isCompound === 'true') filters.is_compound = true
  if (query.isCompound === 'false') filters.is_compound = false
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesTaxRate,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_tax_rate,
    fields: [
      F.id,
      F.name,
      F.code,
      F.rate,
      F.country_code,
      F.region_code,
      F.postal_code,
      F.city,
      F.customer_group_id,
      F.product_category_id,
      F.channel_id,
      F.priority,
      F.is_compound,
      F.metadata,
      F.starts_at,
      F.ends_at,
      F.organization_id,
      F.tenant_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      id: F.id,
      name: F.name,
      code: F.code,
      rate: F.rate,
      priority: F.priority,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildFilters(query),
    decorateCustomFields: { entityIds: [E.sales.sales_tax_rate] },
    transformItem: (item: any) => {
      const base = {
        id: item.id,
        name: item.name,
        code: item.code,
        rate: item.rate,
        countryCode: item.country_code ?? null,
        regionCode: item.region_code ?? null,
        postalCode: item.postal_code ?? null,
        city: item.city ?? null,
        customerGroupId: item.customer_group_id ?? null,
        productCategoryId: item.product_category_id ?? null,
        channelId: item.channel_id ?? null,
        priority: item.priority ?? 0,
        isCompound: item.is_compound ?? false,
        metadata: item.metadata ?? null,
        startsAt: item.starts_at ?? null,
        endsAt: item.ends_at ?? null,
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
      commandId: 'sales.tax-rates.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(taxRateCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.taxRateId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.tax-rates.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(taxRateUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.tax-rates.delete',
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

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Manage tax rates',
  methods: {
    GET: {
      summary: 'List tax rates',
      description: 'Returns a paginated list of sales tax rates for the current organization.',
      query: listSchema,
      responses: [{ status: 200, description: 'Paginated list of tax rates', schema: taxRateListResponseSchema }],
    },
    POST: {
      summary: 'Create tax rate',
      description: 'Creates a new tax rate record.',
      requestBody: {
        schema: taxRateCreateSchema,
        description: 'Payload describing the tax rate to create.',
      },
      responses: [
        {
          status: 201,
          description: 'Identifier of the created tax rate',
          schema: z.object({ id: z.string().uuid().nullable() }),
        },
      ],
    },
    PUT: {
      summary: 'Update tax rate',
      description: 'Updates an existing tax rate by identifier.',
      requestBody: {
        schema: taxRateUpdateSchema,
        description: 'Fields to update on the target tax rate.',
      },
      responses: [{ status: 200, description: 'Update acknowledgement', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Delete tax rate',
      description: 'Deletes a tax rate identified by `id`.',
      requestBody: {
        schema: taxRateDeleteSchema,
        description: 'Identifier payload for the tax rate to delete.',
      },
      responses: [{ status: 200, description: 'Deletion acknowledgement', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
