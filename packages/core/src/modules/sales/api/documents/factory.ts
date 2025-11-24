import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { SalesOrder, SalesQuote } from '../../data/entities'
import {
  orderCreateSchema,
  quoteCreateSchema,
} from '../../data/validators'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultDeleteRequestSchema,
} from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'

type DocumentKind = 'order' | 'quote'

type DocumentBinding = {
  kind: DocumentKind
  entity: typeof SalesOrder | typeof SalesQuote
  entityId: (typeof E.sales)[keyof typeof E.sales]
  numberField: 'orderNumber' | 'quoteNumber'
  createCommandId: string
  deleteCommandId: string
  manageFeature: string
  viewFeature: string
}

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

function buildFilters(query: z.infer<typeof listSchema>, numberColumn: string) {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.search && query.search.trim().length > 0) {
    const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
    filters.$or = [{ [numberColumn]: { $ilike: term } }, { status: { $ilike: term } }]
  }
  return filters
}

function buildSortMap(numberColumn: string) {
  return {
    id: 'id',
    number: numberColumn,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
}

export function createDocumentCrudRoute(binding: DocumentBinding) {
  const numberColumn = binding.numberField === 'orderNumber' ? 'order_number' : 'quote_number'
  const createSchema = binding.kind === 'order' ? orderCreateSchema : quoteCreateSchema

  const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: [binding.viewFeature] },
    POST: { requireAuth: true, requireFeatures: [binding.manageFeature] },
    DELETE: { requireAuth: true, requireFeatures: [binding.manageFeature] },
  }

  const crud = makeCrudRoute({
    metadata: routeMetadata,
    orm: {
      entity: binding.entity as any,
      idField: 'id',
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
    list: {
      schema: listSchema,
      entityId: binding.entityId,
      fields: [
        'id',
        numberColumn,
        'status',
        'customer_entity_id',
        'customer_contact_id',
        'billing_address_id',
        'shipping_address_id',
        'currency_code',
        'channel_id',
        'organization_id',
        'tenant_id',
        'created_at',
        'updated_at',
      ],
      sortFieldMap: buildSortMap(numberColumn),
      buildFilters: async (query) => buildFilters(query, numberColumn),
      decorateCustomFields: { entityIds: [binding.entityId] },
      transformItem: (item: any) => {
        const base = {
          id: item.id,
          [binding.numberField]: item[numberColumn] ?? null,
          status: item.status ?? null,
          customerEntityId: item.customer_entity_id ?? null,
          customerContactId: item.customer_contact_id ?? null,
          billingAddressId: item.billing_address_id ?? null,
          shippingAddressId: item.shipping_address_id ?? null,
          currencyCode: item.currency_code ?? null,
          channelId: item.channel_id ?? null,
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
        commandId: binding.createCommandId,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          return parseScopedCommandInput(createSchema, raw ?? {}, ctx, translate)
        },
        response: ({ result }) => ({ id: result?.orderId ?? result?.quoteId ?? result?.id ?? null }),
        status: 201,
      },
      delete: {
        commandId: binding.deleteCommandId,
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

  const { GET, POST, DELETE } = crud

  const itemSchema = z.object({
    id: z.string().uuid(),
    [binding.numberField]: z.string().nullable(),
    status: z.string().nullable(),
    customerEntityId: z.string().uuid().nullable(),
    customerContactId: z.string().uuid().nullable(),
    billingAddressId: z.string().uuid().nullable(),
    shippingAddressId: z.string().uuid().nullable(),
    currencyCode: z.string().nullable(),
    channelId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    tenantId: z.string().uuid().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })

  const listResponseSchema = createPagedListResponseSchema(itemSchema)

  const openApi = createSalesCrudOpenApi({
    resourceName: binding.kind === 'order' ? 'Order' : 'Quote',
    querySchema: listSchema,
    listResponseSchema,
    create: {
      schema: createSchema,
      responseSchema: z.object({ id: z.string().uuid().nullable() }),
      description: `Creates a new sales ${binding.kind}.`,
    },
    del: {
      schema: defaultDeleteRequestSchema,
      responseSchema: z.object({ ok: z.boolean() }),
      description: `Deletes a sales ${binding.kind}.`,
    },
  })

  return { GET, POST, DELETE, openApi, metadata: routeMetadata }
}
