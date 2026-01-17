import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesPaymentMethod } from '../../data/entities'
import { paymentMethodCreateSchema, paymentMethodUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '#generated/entities.ids.generated'
import * as F from '#generated/entities/sales_payment_method'
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

const paymentMethodItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  providerKey: z.string().nullable(),
  terms: z.string().nullable(),
  isActive: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  providerSettings: z.record(z.string(), z.unknown()).nullable().optional(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
})

const paymentMethodListResponseSchema = createPagedListResponseSchema(paymentMethodItemSchema)

function buildFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search && query.search.trim().length > 0) {
    const term = `%${escapeLikePattern(query.search.trim())}%`
    filters.$or = [
      { name: { $ilike: term } },
      { code: { $ilike: term } },
      { provider_key: { $ilike: term } },
      { description: { $ilike: term } },
    ]
  }
  const isActive = parseBooleanToken(query.isActive)
  if (isActive !== null) filters.is_active = isActive
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesPaymentMethod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_payment_method,
    fields: [
      F.id,
      F.name,
      F.code,
      F.description,
      F.provider_key,
      F.terms,
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
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildFilters(query),
    decorateCustomFields: { entityIds: [E.sales.sales_payment_method] },
    transformItem: (item: any) => {
      const base = {
        id: item.id,
        name: item.name,
        code: item.code,
        description: item.description ?? null,
        providerKey: item.provider_key ?? null,
        terms: item.terms ?? null,
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
      commandId: 'sales.payment-methods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(paymentMethodCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.paymentMethodId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.payment-methods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(paymentMethodUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.payment-methods.delete',
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
  resourceName: 'Payment method',
  pluralName: 'Payment methods',
  description: 'Configure payment options that can be assigned to sales orders and invoices.',
  querySchema: listSchema,
  listResponseSchema: paymentMethodListResponseSchema,
  create: { schema: paymentMethodCreateSchema },
  update: { schema: paymentMethodUpdateSchema },
  del: { schema: defaultDeleteRequestSchema },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
