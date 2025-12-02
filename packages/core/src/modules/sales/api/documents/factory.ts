import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { SalesOrder, SalesQuote } from '../../data/entities'
import { SalesDocumentTagAssignment } from '../../data/entities'
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
import { documentUpdateSchema } from '../../commands/documents'

type DocumentKind = 'order' | 'quote'

type DocumentBinding = {
  kind: DocumentKind
  entity: typeof SalesOrder | typeof SalesQuote
  entityId: (typeof E.sales)[keyof typeof E.sales]
  numberField: 'orderNumber' | 'quoteNumber'
  createCommandId: string
  updateCommandId: string
  deleteCommandId: string
  manageFeature: string
  viewFeature: string
}

const rawBodySchema = z.object({}).passthrough()

const resolveCustomerName = (snapshot: Record<string, unknown> | null, fallback?: string | null) => {
  if (!snapshot) return fallback ?? null
  const customer = snapshot.customer as Record<string, unknown> | undefined
  const contact = snapshot.contact as Record<string, unknown> | undefined
  const displayName = typeof customer?.displayName === 'string' ? customer.displayName : null
  if (displayName) return displayName
  const first = typeof contact?.firstName === 'string' ? contact.firstName : null
  const last = typeof contact?.lastName === 'string' ? contact.lastName : null
  const preferred = typeof contact?.preferredName === 'string' ? contact.preferredName : null
  const parts = [preferred ?? first, last].filter((part) => part && part.trim().length)
  if (parts.length) return parts.join(' ')
  return fallback ?? null
}

const resolveCustomerEmail = (snapshot: Record<string, unknown> | null) => {
  if (!snapshot) return null
  const customer = snapshot.customer as Record<string, unknown> | undefined
  const primary = typeof customer?.primaryEmail === 'string' ? customer.primaryEmail : null
  return primary ?? null
}

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    lineItemCountMin: z.coerce.number().min(0).optional(),
    lineItemCountMax: z.coerce.number().min(0).optional(),
    totalNetMin: z.coerce.number().optional(),
    totalNetMax: z.coerce.number().optional(),
    totalGrossMin: z.coerce.number().optional(),
    totalGrossMax: z.coerce.number().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    tagIds: z.string().optional(),
    tagIdsEmpty: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

type ListQuery = z.infer<typeof listSchema>

function buildFilters(query: ListQuery, numberColumn: string, kind: DocumentKind) {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  if (query.search && query.search.trim().length > 0) {
    const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
    filters.$or = [{ [numberColumn]: { $ilike: term } }, { status: { $ilike: term } }]
  }
  if (query.customerId) {
    filters.customer_entity_id = { $eq: query.customerId }
  }
  if (query.channelId) {
    filters.channel_id = { $eq: query.channelId }
  }
  const lineRange: Record<string, number> = {}
  if (typeof query.lineItemCountMin === 'number') lineRange.$gte = query.lineItemCountMin
  if (typeof query.lineItemCountMax === 'number') lineRange.$lte = query.lineItemCountMax
  if (Object.keys(lineRange).length) {
    filters.line_item_count = lineRange
  }
  const netRange: Record<string, number> = {}
  if (typeof query.totalNetMin === 'number') netRange.$gte = query.totalNetMin
  if (typeof query.totalNetMax === 'number') netRange.$lte = query.totalNetMax
  if (Object.keys(netRange).length) {
    filters.grand_total_net_amount = netRange
  }
  const grossRange: Record<string, number> = {}
  if (typeof query.totalGrossMin === 'number') grossRange.$gte = query.totalGrossMin
  if (typeof query.totalGrossMax === 'number') grossRange.$lte = query.totalGrossMax
  if (Object.keys(grossRange).length) {
    filters.grand_total_gross_amount = grossRange
  }
  const dateRange: Record<string, Date> = {}
  if (query.dateFrom) {
    const from = new Date(query.dateFrom)
    if (!Number.isNaN(from.getTime())) dateRange.$gte = from
  }
  if (query.dateTo) {
    const to = new Date(query.dateTo)
    if (!Number.isNaN(to.getTime())) dateRange.$lte = to
  }
  if (Object.keys(dateRange).length) {
    filters.created_at = dateRange
  }
  const tagIdsRaw = typeof query.tagIds === 'string' ? query.tagIds : ''
  const tagIds = tagIdsRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (query.tagIdsEmpty === 'true') {
    filters.id = { $eq: '00000000-0000-0000-0000-000000000000' }
  } else if (tagIds.length) {
    filters['tag_assignments.tag_id'] = { $in: tagIds }
    filters['tag_assignments.document_kind'] = { $eq: kind }
  }
  return filters
}

function buildSortMap(numberColumn: string) {
  return {
    id: 'id',
    number: numberColumn,
    placedAt: 'placed_at',
    lineItemCount: 'line_item_count',
    grandTotalNetAmount: 'grand_total_net_amount',
    grandTotalGrossAmount: 'grand_total_gross_amount',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
}

const mapUpdateResponse = (entity: any) => ({
  id: entity?.id ?? null,
  customerEntityId: entity?.customerEntityId ?? null,
  customerContactId: entity?.customerContactId ?? null,
  customerSnapshot: entity?.customerSnapshot ?? null,
  metadata: entity?.metadata ?? null,
  externalReference: entity?.externalReference ?? null,
  customerReference: entity?.customerReference ?? null,
  comment: entity?.comments ?? null,
  statusEntryId: (entity as any)?.statusEntryId ?? null,
  status: (entity as any)?.status ?? null,
  channelId: (entity as any)?.channelId ?? null,
  customerName: resolveCustomerName(entity?.customerSnapshot ?? null, entity?.customerEntityId ?? null),
  contactEmail:
    resolveCustomerEmail(entity?.customerSnapshot ?? null) ??
    (typeof entity?.metadata?.customerEmail === 'string' ? entity.metadata.customerEmail : null),
  currencyCode: entity?.currencyCode ?? null,
  placedAt: entity?.placedAt ? entity.placedAt.toISOString() : null,
  expectedDeliveryAt: entity?.expectedDeliveryAt ? entity.expectedDeliveryAt.toISOString() : null,
  shippingAddressId: entity?.shippingAddressId ?? null,
  billingAddressId: entity?.billingAddressId ?? null,
  shippingAddressSnapshot: entity?.shippingAddressSnapshot ?? null,
  billingAddressSnapshot: entity?.billingAddressSnapshot ?? null,
  shippingMethodId: entity?.shippingMethodId ?? null,
  shippingMethodCode: entity?.shippingMethodCode ?? null,
  shippingMethodSnapshot: entity?.shippingMethodSnapshot ?? null,
  paymentMethodId: entity?.paymentMethodId ?? null,
  paymentMethodCode: entity?.paymentMethodCode ?? null,
  paymentMethodSnapshot: entity?.paymentMethodSnapshot ?? null,
})

const attachTags = async (payload: any, ctx: any) => {
  const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, any>>) : []
  if (!items.length) return
  const ids = items
    .map((item) => (item && typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => !!id)
  if (!ids.length) return
  const em = ctx?.container?.resolve ? (ctx.container.resolve('em') as any) : null
  if (!em) return
  const where: Record<string, unknown> = {
    documentId: { $in: ids },
    documentKind: ctx?.bindingKind ?? null,
  }
  if (ctx?.auth?.tenantId) where.tenantId = ctx.auth.tenantId
  const orgIds =
    Array.isArray(ctx?.organizationIds) && ctx.organizationIds.length
      ? ctx.organizationIds.filter((val: string | null) => !!val)
      : ctx?.selectedOrganizationId
        ? [ctx.selectedOrganizationId]
        : []
  if (orgIds.length) where.organizationId = { $in: orgIds }
  const assignments = await em.find(
    SalesDocumentTagAssignment,
    where,
    { populate: ['tag'] },
  )
  const grouped = new Map<string, Array<{ id: string; label: string; color: string | null }>>()
  assignments.forEach((assignment: any) => {
    const tag = assignment?.tag
    const documentId = assignment?.documentId
    if (!tag || typeof tag.id !== 'string' || typeof documentId !== 'string') return
    const entry = {
      id: tag.id,
      label: typeof tag.label === 'string' && tag.label.trim().length ? tag.label : tag.slug ?? tag.id,
      color: typeof tag.color === 'string' && tag.color.trim().length ? tag.color : null,
    }
    const list = grouped.get(documentId) ?? []
    list.push(entry)
    grouped.set(documentId, list)
  })
  items.forEach((item: Record<string, any>) => {
    const id = item && typeof item.id === 'string' ? item.id : null
    if (!id) return
    const list = grouped.get(id)
    if (list) item.tags = list
  })
}

export function buildDocumentCrudOptions(binding: DocumentBinding) {
  const numberColumn = binding.numberField === 'orderNumber' ? 'order_number' : 'quote_number'
  const createSchema = binding.kind === 'order' ? orderCreateSchema : quoteCreateSchema

  const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: [binding.viewFeature] },
    POST: { requireAuth: true, requireFeatures: [binding.manageFeature] },
    PUT: { requireAuth: true, requireFeatures: [binding.manageFeature] },
    DELETE: { requireAuth: true, requireFeatures: [binding.manageFeature] },
  }

  const commonFields = [
    'id',
    numberColumn,
    'status',
    'status_entry_id',
    'customer_entity_id',
    'customer_contact_id',
    'billing_address_id',
    'shipping_address_id',
    'customer_snapshot',
    'billing_address_snapshot',
    'shipping_address_snapshot',
    'shipping_method_id',
    'shipping_method_code',
    'shipping_method_snapshot',
    'payment_method_id',
    'payment_method_code',
    'payment_method_snapshot',
    'customer_reference',
    'metadata',
    'external_reference',
    'currency_code',
    'comments',
    'channel_id',
    'placed_at',
    'line_item_count',
    'subtotal_net_amount',
    'subtotal_gross_amount',
    'tax_total_amount',
    'discount_total_amount',
    'grand_total_net_amount',
    'grand_total_gross_amount',
    'totals_snapshot',
    'organization_id',
    'tenant_id',
    'created_at',
    'updated_at',
  ]

  const orderOnlyFields = [
    'expected_delivery_at',
    'shipping_net_amount',
    'shipping_gross_amount',
    'surcharge_total_amount',
    'paid_total_amount',
    'refunded_total_amount',
    'outstanding_amount',
  ]

  const quoteOnlyFields = ['valid_from', 'valid_until']

  const listFields = [
    ...commonFields,
    ...(binding.kind === 'order' ? orderOnlyFields : quoteOnlyFields),
  ]

  return {
    metadata: routeMetadata,
    orm: {
      entity: binding.entity as any,
      idField: 'id',
      orgField: 'organizationId',
      tenantField: 'tenantId',
      softDeleteField: 'deletedAt',
    },
    indexer: {
      entityType: binding.entityId,
    },
    list: {
      schema: listSchema,
      entityId: binding.entityId,
      fields: listFields,
      sortFieldMap: buildSortMap(numberColumn),
      buildFilters: async (query: any) => buildFilters(query, numberColumn, binding.kind),
      decorateCustomFields: { entityIds: [binding.entityId] },
      joins: [
        {
          alias: 'tag_assignments',
          table: 'sales_document_tag_assignments',
          from: { field: 'id' },
          to: { field: 'document_id' },
          type: 'left',
        },
      ],
      transformItem: (item: any) => {
        const toNumber = (value: unknown): number | null => {
          if (typeof value === 'number') return Number.isNaN(value) ? null : value
          if (typeof value === 'string' && value.trim().length) {
            const parsed = Number(value)
            return Number.isNaN(parsed) ? null : parsed
          }
          return null
        }
        const base = {
          id: item.id,
          [binding.numberField]: item[numberColumn] ?? null,
          status: item.status ?? null,
          statusEntryId: item.status_entry_id ?? null,
          customerEntityId: item.customer_entity_id ?? null,
          customerContactId: item.customer_contact_id ?? null,
          billingAddressId: item.billing_address_id ?? null,
          shippingAddressId: item.shipping_address_id ?? null,
          shippingMethodId: item.shipping_method_id ?? null,
          shippingMethodCode: item.shipping_method_code ?? null,
          shippingMethodSnapshot: item.shipping_method_snapshot ?? null,
          paymentMethodId: item.payment_method_id ?? null,
          paymentMethodCode: item.payment_method_code ?? null,
          paymentMethodSnapshot: item.payment_method_snapshot ?? null,
          currencyCode: item.currency_code ?? null,
          channelId: item.channel_id ?? null,
          externalReference: item.external_reference ?? null,
          customerReference: item.customer_reference ?? null,
          placedAt: item.placed_at ?? null,
          expectedDeliveryAt: item.expected_delivery_at ?? null,
          comment: item.comments ?? null,
          validFrom: item.valid_from ?? null,
          validUntil: item.valid_until ?? null,
          lineItemCount: toNumber(item.line_item_count),
          subtotalNetAmount: toNumber(item.subtotal_net_amount),
          subtotalGrossAmount: toNumber(item.subtotal_gross_amount),
          discountTotalAmount: toNumber(item.discount_total_amount),
          taxTotalAmount: toNumber(item.tax_total_amount),
          shippingNetAmount: toNumber(item.shipping_net_amount),
          shippingGrossAmount: toNumber(item.shipping_gross_amount),
          surchargeTotalAmount: toNumber(item.surcharge_total_amount),
          grandTotalNetAmount: toNumber(item.grand_total_net_amount),
          grandTotalGrossAmount: toNumber(item.grand_total_gross_amount),
          paidTotalAmount: toNumber(item.paid_total_amount),
          refundedTotalAmount: toNumber(item.refunded_total_amount),
          outstandingAmount: toNumber(item.outstanding_amount),
          customerSnapshot: item.customer_snapshot ?? null,
          billingAddressSnapshot: item.billing_address_snapshot ?? null,
          shippingAddressSnapshot: item.shipping_address_snapshot ?? null,
          metadata: item.metadata ?? null,
          organizationId: item.organization_id ?? null,
          tenantId: item.tenant_id ?? null,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        }
        const customRaw: Record<string, unknown> = {}
        Object.entries(item as Record<string, unknown>).forEach(([key, value]) => {
          if (typeof key !== 'string') return
          if (key.startsWith('cf_') || key.startsWith('cf:')) {
            customRaw[key] = value
          }
        })
        return Object.keys(customRaw).length ? { ...base, ...customRaw } : base
      },
    },
    actions: {
      create: {
        commandId: binding.createCommandId,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          const { base, custom } = splitCustomFieldPayload(raw ?? {})
          const parsed = parseScopedCommandInput(
            createSchema,
            Object.keys(custom).length ? { ...base, customFields: custom } : base,
            ctx,
            translate,
          )
          return parsed
        },
        response: ({ result }) => ({ id: result?.orderId ?? result?.quoteId ?? result?.id ?? null }),
        status: 201,
      },
      update: {
        commandId: binding.updateCommandId,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          const { base, custom } = splitCustomFieldPayload(raw ?? {})
          const parsed = parseScopedCommandInput(
            documentUpdateSchema,
            Object.keys(custom).length ? { ...base, customFields: custom } : base,
            ctx,
            translate,
          )
          return parsed
        },
        response: ({ result }) => mapUpdateResponse((result as any)?.order ?? (result as any)?.quote ?? result),
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
    hooks: {
      afterList: async (payload, ctx) => {
        await attachTags(payload, { ...ctx, bindingKind: binding.kind })
      },
    },
  }
}

export function buildDocumentOpenApi(binding: DocumentBinding) {
  const createSchema = binding.kind === 'order' ? orderCreateSchema : quoteCreateSchema
  const itemSchema = z.object({
    id: z.string().uuid(),
    [binding.numberField]: z.string().nullable(),
    status: z.string().nullable(),
    statusEntryId: z.string().uuid().nullable().optional(),
    customerEntityId: z.string().uuid().nullable(),
    customerContactId: z.string().uuid().nullable(),
    billingAddressId: z.string().uuid().nullable(),
    shippingAddressId: z.string().uuid().nullable(),
    customerReference: z.string().nullable().optional(),
    externalReference: z.string().nullable().optional(),
    comment: z.string().nullable().optional(),
    placedAt: z.string().nullable().optional(),
    expectedDeliveryAt: z.string().nullable().optional(),
    customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    billingAddressSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    shippingAddressSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    shippingMethodId: z.string().uuid().nullable().optional(),
    shippingMethodCode: z.string().nullable().optional(),
    shippingMethodSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    paymentMethodId: z.string().uuid().nullable().optional(),
    paymentMethodCode: z.string().nullable().optional(),
    paymentMethodSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    currencyCode: z.string().nullable(),
    channelId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    tenantId: z.string().uuid().nullable(),
    validFrom: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    lineItemCount: z.number().nullable().optional(),
    subtotalNetAmount: z.number().nullable().optional(),
    subtotalGrossAmount: z.number().nullable().optional(),
    discountTotalAmount: z.number().nullable().optional(),
    taxTotalAmount: z.number().nullable().optional(),
    shippingNetAmount: z.number().nullable().optional(),
    shippingGrossAmount: z.number().nullable().optional(),
    surchargeTotalAmount: z.number().nullable().optional(),
    grandTotalNetAmount: z.number().nullable().optional(),
    grandTotalGrossAmount: z.number().nullable().optional(),
    paidTotalAmount: z.number().nullable().optional(),
    refundedTotalAmount: z.number().nullable().optional(),
    outstandingAmount: z.number().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    customValues: z.record(z.string(), z.unknown()).optional(),
  })

  const listResponseSchema = createPagedListResponseSchema(itemSchema)

  return createSalesCrudOpenApi({
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
}

// Compatibility wrapper
export function createDocumentCrudRoute(binding: DocumentBinding) {
  const crud = makeCrudRoute(buildDocumentCrudOptions(binding))
  const { GET, POST, PUT, DELETE } = crud
  return { GET, POST, PUT, DELETE, openApi: buildDocumentOpenApi(binding), metadata: crud.metadata }
}
