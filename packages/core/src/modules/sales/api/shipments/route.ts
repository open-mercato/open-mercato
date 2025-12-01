import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { SalesOrderLine, SalesShipment, SalesShipmentItem, SalesShippingMethod } from '../../data/entities'
import { shipmentCreateSchema, shipmentUpdateSchema } from '../../data/validators'
import { withScopedPayload } from '../utils'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_shipment'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
    orderId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.orders.view'] },
  POST: { requireAuth: true, requireFeatures: ['sales.shipments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.shipments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.shipments.manage'] },
}

const deleteSchema = shipmentUpdateSchema.pick({
  id: true,
  orderId: true,
  organizationId: true,
  tenantId: true,
})

const toNumber = (value: unknown): number => {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesShipment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_shipment,
    fields: [
      F.id,
      'order_id',
      F.shipment_number,
      F.shipping_method_id,
      F.status_entry_id,
      F.status,
      F.carrier_name,
      F.tracking_numbers,
      F.shipped_at,
      F.delivered_at,
      F.weight_value,
      F.weight_unit,
      F.declared_value_net,
      F.declared_value_gross,
      F.currency_code,
      F.notes,
      F.metadata,
      F.created_at,
      F.updated_at,
    ],
    decorateCustomFields: { entityIds: [E.sales.sales_shipment] },
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      shippedAt: F.shipped_at,
    },
    buildFilters: async (query: any) => {
      const filters: Record<string, any> = {}
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'sales.shipments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        return shipmentCreateSchema.parse({
          ...base,
          ...(Object.keys(custom).length ? { customFields: custom } : {}),
        })
      },
      response: ({ result }) => ({ id: result?.shipmentId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.shipments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base, custom } = splitCustomFieldPayload(scoped)
        return shipmentUpdateSchema.parse({
          ...base,
          ...(Object.keys(custom).length ? { customFields: custom } : {}),
        })
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.shipments.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const payload = deleteSchema.parse(withScopedPayload(raw ?? {}, ctx, translate))
        if (!payload.id || !payload.orderId) {
          throw new CrudHttpError(400, {
            error: translate('sales.shipments.not_found', 'Shipment not found'),
          })
        }
        return payload
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const shipmentIds = items
        .map((item: unknown) => (item && typeof item === 'object' ? (item as Record<string, unknown>).id : null))
        .filter((value: string | null): value is string => typeof value === 'string')
      if (!shipmentIds.length) return
      const em = ctx.container.resolve('em') as EntityManager
      const [shipmentItems, shippingMethods] = await Promise.all([
        em.find(
          SalesShipmentItem,
          { shipment: { $in: shipmentIds } },
          { populate: ['orderLine'] }
        ),
        (async () => {
          const ids: string[] = Array.from(
            new Set(
              items
                .map((item: unknown) => {
                  if (!item || typeof item !== 'object') return null
                  const raw = (item as Record<string, unknown>).shipping_method_id
                  return typeof raw === 'string' ? raw : null
                })
                .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
            )
          )
          if (!ids.length) return []
          return em.find(SalesShippingMethod, { id: { $in: ids } })
        })(),
      ])
      const orderLineIds = Array.from(
        new Set(
          shipmentItems
            .map((entry) =>
              typeof entry.orderLine === 'string'
                ? entry.orderLine
                : entry.orderLine?.id ?? (entry as any).orderLineId ?? null
            )
            .filter((value): value is string => typeof value === 'string')
        )
      )
      const orderLines = orderLineIds.length
        ? await em.find(SalesOrderLine, { id: { $in: orderLineIds } })
        : []
      const lineMap = new Map(
        orderLines.map((line) => [
          line.id,
          {
            lineNumber: line.lineNumber ?? null,
            name:
              line.name ??
              (typeof line.catalogSnapshot === 'object' && line.catalogSnapshot
                ? ((line.catalogSnapshot as any).name as string | undefined) ?? null
                : null),
          },
        ])
      )
      const grouped = shipmentItems.reduce<Map<string, Array<Record<string, unknown>>>>((acc, entry) => {
        const shipmentId =
          typeof entry.shipment === 'string'
            ? entry.shipment
            : entry.shipment?.id ?? (entry as any).shipment_id ?? null
        const lineId =
          typeof entry.orderLine === 'string'
            ? entry.orderLine
            : entry.orderLine?.id ?? (entry as any).order_line_id ?? null
        if (!shipmentId || !lineId) return acc
        const line = lineMap.get(lineId)
        const list = acc.get(shipmentId) ?? []
        list.push({
          id: entry.id,
          orderLineId: lineId,
          orderLineName: line?.name ?? null,
          orderLineNumber: line?.lineNumber ?? null,
          quantity: toNumber(entry.quantity),
          metadata: entry.metadata ?? null,
        })
        acc.set(shipmentId, list)
        return acc
      }, new Map())
      const shippingMap = new Map(
        shippingMethods.map((method) => [method.id, method.code ?? null])
      )
      const statusIds: string[] = Array.from(
        new Set(
          items
            .map((item: unknown) => {
              if (!item || typeof item !== 'object') return null
              const raw = (item as Record<string, unknown>).status_entry_id
              return typeof raw === 'string' ? raw : null
            })
            .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
        )
      )
      const statusMap = new Map<string, string | null>()
      if (statusIds.length) {
        const entries = await em.find(DictionaryEntry, { id: { $in: statusIds } })
        entries.forEach((entry) => statusMap.set(entry.id, entry.value ?? null))
      }
      items.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return
        const id = (item as Record<string, unknown>).id
        if (typeof id !== 'string') return
        ;(item as Record<string, unknown>).items = grouped.get(id) ?? []
        const shippingId = (item as Record<string, unknown>).shipping_method_id
        if (typeof shippingId === 'string' && shippingMap.has(shippingId)) {
          ;(item as Record<string, unknown>).shipping_method_code = shippingMap.get(shippingId)
        }
        const statusId = (item as Record<string, unknown>).status_entry_id
        if (!(item as Record<string, unknown>).status && typeof statusId === 'string' && statusMap.has(statusId)) {
          ;(item as Record<string, unknown>).status = statusMap.get(statusId)
        }
      })
    },
  },
})

const { GET, POST, PUT, DELETE } = crud

export { GET, POST, PUT, DELETE }

const shipmentItemSchema = z.object({
  id: z.string().uuid(),
  orderLineId: z.string().uuid(),
  orderLineName: z.string().nullable().optional(),
  orderLineNumber: z.number().nullable().optional(),
  quantity: z.number(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

const shipmentSchema = z
  .object({
    id: z.string().uuid(),
    order_id: z.string().uuid(),
    shipment_number: z.string().nullable().optional(),
    shipping_method_id: z.string().uuid().nullable().optional(),
    shipping_method_code: z.string().nullable().optional(),
    status_entry_id: z.string().uuid().nullable().optional(),
    status: z.string().nullable().optional(),
    carrier_name: z.string().nullable().optional(),
    tracking_numbers: z.array(z.string()).nullable().optional(),
    shipped_at: z.string().nullable().optional(),
    delivered_at: z.string().nullable().optional(),
    weight_value: z.number().nullable().optional(),
    weight_unit: z.string().nullable().optional(),
    declared_value_net: z.number().nullable().optional(),
    declared_value_gross: z.number().nullable().optional(),
    currency_code: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    custom_values: z.record(z.string(), z.unknown()).nullable().optional(),
    customValues: z.record(z.string(), z.unknown()).nullable().optional(),
    custom_fields: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    customFields: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    created_at: z.string(),
    updated_at: z.string(),
    items: z.array(shipmentItemSchema).optional(),
  })
  .passthrough()

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Shipment',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(shipmentSchema),
  create: {
    schema: shipmentCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a shipment for an order.',
  },
  update: {
    schema: shipmentUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a shipment.',
  },
  del: {
    schema: deleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a shipment.',
  },
})
