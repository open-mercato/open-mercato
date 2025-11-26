import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import type { SalesOrder, SalesQuote } from '../../data/entities'
import { SalesChannel } from '../../data/entities'
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
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { loadSalesSettings } from '../../commands/settings'
import { CustomerEntity, CustomerPersonProfile, CustomerAddress } from '../../../customers/data/entities'
import type { SalesSettings } from '../../data/entities'
import { resolveDictionaryEntryValue } from '../../lib/dictionaries'

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

async function resolveCustomerSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  customerEntityId?: string | null,
  customerContactId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!customerEntityId) return null
  const customer = await em.findOne(
    CustomerEntity,
    { id: customerEntityId, organizationId, tenantId },
    { populate: ['personProfile', 'companyProfile'] }
  )
  if (!customer) return null

  const contact = customerContactId
    ? await em.findOne(CustomerPersonProfile, {
        id: customerContactId,
        organizationId,
        tenantId,
      })
    : null

  return {
    customer: {
      id: customer.id,
      kind: customer.kind,
      displayName: customer.displayName,
      primaryEmail: customer.primaryEmail ?? null,
      primaryPhone: customer.primaryPhone ?? null,
      personProfile: customer.personProfile
        ? {
            id: customer.personProfile.id,
            firstName: customer.personProfile.firstName ?? null,
            lastName: customer.personProfile.lastName ?? null,
            preferredName: customer.personProfile.preferredName ?? null,
          }
        : null,
      companyProfile: customer.companyProfile
        ? {
            id: customer.companyProfile.id,
            legalName: customer.companyProfile.legalName ?? null,
            brandName: customer.companyProfile.brandName ?? null,
            domain: customer.companyProfile.domain ?? null,
            websiteUrl: customer.companyProfile.websiteUrl ?? null,
          }
        : null,
    },
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName ?? null,
          lastName: contact.lastName ?? null,
          preferredName: contact.preferredName ?? null,
          jobTitle: contact.jobTitle ?? null,
          department: contact.department ?? null,
        }
      : null,
  }
}

async function resolveAddressSnapshot(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  addressId?: string | null
): Promise<Record<string, unknown> | null> {
  if (!addressId) return null
  const address = await em.findOne(CustomerAddress, { id: addressId, organizationId, tenantId })
  if (!address) return null
  const record = address as any
  return {
    id: record.id,
    name: record.name ?? null,
    purpose: record.purpose ?? null,
    companyName: record.companyName ?? null,
    addressLine1: record.addressLine1 ?? null,
    addressLine2: record.addressLine2 ?? null,
    buildingNumber: record.buildingNumber ?? null,
    flatNumber: record.flatNumber ?? null,
    city: record.city ?? null,
    region: record.region ?? null,
    postalCode: record.postalCode ?? null,
    country: record.country ?? null,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
  }
}

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

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, { message: 'currency_code_invalid' })

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'invalid_date' })
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'invalid_date' })

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

function buildFilters(query: z.infer<typeof listSchema>, numberColumn: string, kind: DocumentKind) {
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

export function createDocumentCrudRoute(binding: DocumentBinding) {
  const numberColumn = binding.numberField === 'orderNumber' ? 'order_number' : 'quote_number'
  const createSchema = binding.kind === 'order' ? orderCreateSchema : quoteCreateSchema
  const addressSnapshotSchema = z.record(z.string(), z.unknown()).nullable().optional()
  const updateSchema = z
    .object({
      id: z.string().uuid(),
      customerEntityId: z.string().uuid().nullable().optional(),
      customerContactId: z.string().uuid().nullable().optional(),
      customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
      customerReference: z.string().nullable().optional(),
      externalReference: z.string().nullable().optional(),
      comment: z.string().nullable().optional(),
      currencyCode: currencyCodeSchema.optional(),
      channelId: z.string().uuid().nullable().optional(),
      statusEntryId: z.string().uuid().nullable().optional(),
      placedAt: z.union([dateOnlySchema, z.null()]).optional(),
      shippingAddressId: z.string().uuid().nullable().optional(),
      billingAddressId: z.string().uuid().nullable().optional(),
      shippingAddressSnapshot: addressSnapshotSchema,
      billingAddressSnapshot: addressSnapshotSchema,
    })
    .refine(
      (input) =>
        typeof input.currencyCode === 'string' ||
        input.placedAt !== undefined ||
        input.channelId !== undefined ||
        input.statusEntryId !== undefined ||
        input.shippingAddressId !== undefined ||
        input.billingAddressId !== undefined ||
        input.customerEntityId !== undefined ||
        input.customerContactId !== undefined ||
        input.customerSnapshot !== undefined ||
        input.metadata !== undefined ||
        input.customerReference !== undefined ||
        input.externalReference !== undefined ||
        input.comment !== undefined ||
        input.shippingAddressSnapshot !== undefined ||
        input.billingAddressSnapshot !== undefined,
      { message: 'update_payload_empty' }
    )

  const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: [binding.viewFeature] },
    POST: { requireAuth: true, requireFeatures: [binding.manageFeature] },
    PUT: { requireAuth: true, requireFeatures: [binding.manageFeature] },
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
        'status_entry_id',
        'customer_entity_id',
        'customer_contact_id',
        'billing_address_id',
        'shipping_address_id',
        'customer_snapshot',
        'billing_address_snapshot',
        'shipping_address_snapshot',
        'customer_reference',
        'external_reference',
        'currency_code',
        'comments',
        'channel_id',
        'placed_at',
        'line_item_count',
        'subtotal_net_amount',
        'subtotal_gross_amount',
        'tax_total_amount',
        'grand_total_net_amount',
        'grand_total_gross_amount',
        'organization_id',
        'tenant_id',
        'created_at',
        'updated_at',
        ...(binding.kind === 'quote' ? ['valid_from', 'valid_until'] : []),
      ],
      sortFieldMap: buildSortMap(numberColumn),
      buildFilters: async (query) => buildFilters(query, numberColumn, binding.kind),
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
          currencyCode: item.currency_code ?? null,
          channelId: item.channel_id ?? null,
          externalReference: item.external_reference ?? null,
          customerReference: item.customer_reference ?? null,
          placedAt: item.placed_at ?? null,
          comment: item.comments ?? null,
          validFrom: item.valid_from ?? null,
          validUntil: item.valid_until ?? null,
          lineItemCount: toNumber(item.line_item_count),
          subtotalNetAmount: toNumber(item.subtotal_net_amount),
          subtotalGrossAmount: toNumber(item.subtotal_gross_amount),
          taxTotalAmount: toNumber(item.tax_total_amount),
          grandTotalNetAmount: toNumber(item.grand_total_net_amount),
          grandTotalGrossAmount: toNumber(item.grand_total_gross_amount),
          customerSnapshot: item.customer_snapshot ?? null,
          billingAddressSnapshot: item.billing_address_snapshot ?? null,
          shippingAddressSnapshot: item.shipping_address_snapshot ?? null,
          organizationId: item.organization_id ?? null,
          tenantId: item.tenant_id ?? null,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
        }
        const { custom } = splitCustomFieldPayload(item)
        return Object.keys(custom).length ? { ...base, customFields: custom } : base
      },
    },
    update: {
      schema: updateSchema,
      getId: (input) => input.id,
      applyToEntity: async (entity, input, ctx) => {
        const em = ctx.container.resolve('em') as EntityManager
        const organizationId = (entity as any).organizationId as string
        const tenantId = (entity as any).tenantId as string
        const status = typeof (entity as any).status === 'string' ? (entity as any).status : null
        const { translate } = await resolveTranslations()

        const wantsCustomerChange =
          input.customerEntityId !== undefined ||
          input.customerContactId !== undefined ||
          input.customerSnapshot !== undefined ||
          input.metadata !== undefined
        const wantsAddressChange =
          input.shippingAddressId !== undefined ||
          input.billingAddressId !== undefined ||
          input.shippingAddressSnapshot !== undefined ||
          input.billingAddressSnapshot !== undefined

        let settings: SalesSettings | null = null
        if (binding.kind === 'order' && (wantsCustomerChange || wantsAddressChange)) {
          settings = await loadSalesSettings(em, { organizationId, tenantId })
        }

        const guardStatus = (allowed: string[] | null | undefined, errorKey: string, fallback: string) => {
          if (!Array.isArray(allowed)) return
          if (allowed.length === 0) {
            throw new CrudHttpError(400, { error: translate(errorKey, fallback) })
          }
          if (!status || !allowed.includes(status)) {
            throw new CrudHttpError(400, { error: translate(errorKey, fallback) })
          }
        }

        if (binding.kind === 'order' && wantsCustomerChange) {
          guardStatus(
            settings?.orderCustomerEditableStatuses ?? null,
            'sales.orders.edit_customer_blocked',
            'Editing the customer is blocked for this status.'
          )
        }
        if (binding.kind === 'order' && wantsAddressChange) {
          guardStatus(
            settings?.orderAddressEditableStatuses ?? null,
            'sales.orders.edit_addresses_blocked',
            'Editing addresses is blocked for this status.'
          )
        }

        if (input.customerEntityId !== undefined) {
          entity.customerEntityId = input.customerEntityId ?? null
          entity.customerSnapshot = await resolveCustomerSnapshot(
            em,
            organizationId,
            tenantId,
            input.customerEntityId,
            input.customerContactId ?? entity.customerContactId ?? null
          )
          entity.customerContactId = input.customerContactId ?? null
          entity.billingAddressId = null
          entity.shippingAddressId = null
          entity.billingAddressSnapshot = null
          entity.shippingAddressSnapshot = null
        }
        if (input.customerContactId !== undefined) {
          entity.customerContactId = input.customerContactId ?? null
          if (entity.customerEntityId) {
            entity.customerSnapshot = await resolveCustomerSnapshot(
              em,
              organizationId,
              tenantId,
              entity.customerEntityId,
              input.customerContactId
            )
          }
        }
        if (input.customerSnapshot !== undefined) {
          entity.customerSnapshot = input.customerSnapshot ?? null
        }
        if (input.metadata !== undefined) {
          entity.metadata = input.metadata ?? null
        }
        if (input.externalReference !== undefined) {
          const normalized = typeof input.externalReference === 'string' ? input.externalReference.trim() : ''
          entity.externalReference = normalized.length ? normalized : null
        }
        if (input.customerReference !== undefined) {
          const normalized = typeof input.customerReference === 'string' ? input.customerReference.trim() : ''
          entity.customerReference = normalized.length ? normalized : null
        }
        if (input.comment !== undefined) {
          const normalized = typeof input.comment === 'string' ? input.comment.trim() : ''
          entity.comments = normalized.length ? normalized : null
        }
        if (typeof input.currencyCode === 'string') {
          entity.currencyCode = input.currencyCode
        }
        if (input.channelId !== undefined) {
          if (input.channelId === null) {
            entity.channelId = null
          } else {
            const channel = await em.findOne(SalesChannel, {
              id: input.channelId,
              organizationId,
              tenantId,
              deletedAt: null,
            })
            if (!channel) {
              throw new CrudHttpError(400, { error: translate('sales.documents.detail.channelInvalid', 'Selected channel could not be found.') })
            }
            entity.channelId = channel.id
          }
        }
        if (input.statusEntryId !== undefined) {
          const statusValue = await resolveDictionaryEntryValue(em, input.statusEntryId)
          if (input.statusEntryId && !statusValue) {
            throw new CrudHttpError(400, { error: translate('sales.documents.detail.statusInvalid', 'Selected status could not be found.') })
          }
          entity.statusEntryId = input.statusEntryId ?? null
          entity.status = statusValue
        }
        if (input.placedAt !== undefined) {
          if (input.placedAt === null) {
            entity.placedAt = null
          } else {
            const parsed = new Date(input.placedAt)
            entity.placedAt = Number.isNaN(parsed.getTime()) ? entity.placedAt : parsed
          }
        }
        if (input.shippingAddressId !== undefined) {
          entity.shippingAddressId = input.shippingAddressId ?? null
          if (input.shippingAddressSnapshot === undefined) {
            entity.shippingAddressSnapshot = await resolveAddressSnapshot(
              em,
              organizationId,
              tenantId,
              input.shippingAddressId
            )
          }
        }
        if (input.billingAddressId !== undefined) {
          entity.billingAddressId = input.billingAddressId ?? null
          if (input.billingAddressSnapshot === undefined) {
            entity.billingAddressSnapshot = await resolveAddressSnapshot(
              em,
              organizationId,
              tenantId,
              input.billingAddressId
            )
          }
        }
        if (input.shippingAddressSnapshot !== undefined) {
          entity.shippingAddressSnapshot = input.shippingAddressSnapshot ?? null
        }
        if (input.billingAddressSnapshot !== undefined) {
          entity.billingAddressSnapshot = input.billingAddressSnapshot ?? null
        }
      },
      response: (entity) => ({
        id: entity.id,
        customerEntityId: entity.customerEntityId ?? null,
        customerContactId: entity.customerContactId ?? null,
        customerSnapshot: entity.customerSnapshot ?? null,
        metadata: entity.metadata ?? null,
        externalReference: entity.externalReference ?? null,
        customerReference: entity.customerReference ?? null,
        comment: entity.comments ?? null,
        statusEntryId: (entity as any).statusEntryId ?? null,
        status: (entity as any).status ?? null,
        channelId: (entity as any).channelId ?? null,
        customerName: resolveCustomerName(entity.customerSnapshot ?? null, entity.customerEntityId ?? null),
        contactEmail: resolveCustomerEmail(entity.customerSnapshot ?? null),
        currencyCode: entity.currencyCode ?? null,
        placedAt: entity.placedAt ? entity.placedAt.toISOString() : null,
        shippingAddressId: entity.shippingAddressId ?? null,
        billingAddressId: entity.billingAddressId ?? null,
        shippingAddressSnapshot: entity.shippingAddressSnapshot ?? null,
        billingAddressSnapshot: entity.billingAddressSnapshot ?? null,
      }),
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

  const { GET, POST, PUT, DELETE } = crud

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
    customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    billingAddressSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    shippingAddressSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
    currencyCode: z.string().nullable(),
    channelId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    tenantId: z.string().uuid().nullable(),
    validFrom: z.string().nullable().optional(),
    validUntil: z.string().nullable().optional(),
    lineItemCount: z.number().nullable().optional(),
    subtotalNetAmount: z.number().nullable().optional(),
    subtotalGrossAmount: z.number().nullable().optional(),
    taxTotalAmount: z.number().nullable().optional(),
    grandTotalNetAmount: z.number().nullable().optional(),
    grandTotalGrossAmount: z.number().nullable().optional(),
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

  return { GET, POST, PUT, DELETE, openApi, metadata: routeMetadata }
}
