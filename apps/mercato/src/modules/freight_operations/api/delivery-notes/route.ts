import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  CARGO_UNITS,
  DELIVERY_NOTE_STATUSES,
  EXTERNAL_WAYBILL_STATUSES,
  FreightDeliveryNote,
} from '../../data/entities'
import { createDeliveryNoteSchema, updateDeliveryNoteSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createFreightCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FREIGHT_DELIVERY_NOTE_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(DELIVERY_NOTE_STATUSES).optional(),
    freightOrderId: z.string().uuid().optional(),
    freightTripId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    externalWaybillStatus: z.enum(EXTERNAL_WAYBILL_STATUSES).optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['freight.delivery_notes.manage'] },
}
export const metadata = { path: '/freight_operations/delivery-notes', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: FreightDeliveryNote,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: FREIGHT_DELIVERY_NOTE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_DELIVERY_NOTE_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'note_number', 'status',
      'freight_order_id', 'freight_trip_id', 'order_number_snapshot', 'trip_number_snapshot',
      'customer_id', 'customer_snapshot', 'seller_snapshot',
      'consignee_name', 'consignee_phone', 'consignee_address',
      'origin', 'destination', 'requested_pickup_at', 'requested_delivery_at',
      'cargo_description', 'cargo_quantity', 'cargo_unit', 'cargo_weight_kg', 'cargo_volume_m3',
      'cargo_hazardous', 'cargo_refrigerated', 'seal_number',
      'vehicle_id', 'driver_id', 'vehicle_snapshot', 'driver_snapshot',
      'issued_at', 'delivered_at', 'received_by_name', 'received_by_id_number',
      'pod_reference', 'pod_document_id', 'pop_reference', 'pop_document_id',
      'external_waybill_number', 'external_waybill_status', 'external_waybill_url',
      'external_waybill_recorded_at', 'external_waybill_cancelled_at', 'external_waybill_notes',
      'cancellation_reason', 'cancelled_at', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      noteNumber: 'note_number',
      status: 'status',
      issuedAt: 'issued_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.status ? { status: { $eq: query.status } } : {}),
          ...(query.freightOrderId ? { freight_order_id: { $eq: query.freightOrderId } } : {}),
          ...(query.freightTripId ? { freight_trip_id: { $eq: query.freightTripId } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.externalWaybillStatus
            ? { external_waybill_status: { $eq: query.externalWaybillStatus } }
            : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { note_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { order_number_snapshot: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { trip_number_snapshot: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { consignee_name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { external_waybill_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { cargo_description: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'freight_operations.delivery_notes.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createDeliveryNoteSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({
        id: result?.id ?? null,
        noteNumber: result?.noteNumber ?? null,
        updatedAt: result?.updatedAt?.toISOString?.() ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'freight_operations.delivery_notes.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateDeliveryNoteSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'freight_operations.delivery_notes.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const deliveryNoteItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  note_number: z.string(),
  status: z.enum(DELIVERY_NOTE_STATUSES),
  freight_order_id: z.string().uuid().nullable().optional(),
  freight_trip_id: z.string().uuid().nullable().optional(),
  order_number_snapshot: z.string().nullable().optional(),
  trip_number_snapshot: z.string().nullable().optional(),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  consignee_name: z.string().nullable().optional(),
  consignee_phone: z.string().nullable().optional(),
  origin: z.string(),
  destination: z.string(),
  cargo_description: z.string(),
  cargo_quantity: z.string().nullable().optional(),
  cargo_unit: z.enum(CARGO_UNITS).nullable().optional(),
  cargo_weight_kg: z.string().nullable().optional(),
  cargo_volume_m3: z.string().nullable().optional(),
  cargo_hazardous: z.boolean().optional(),
  cargo_refrigerated: z.boolean().optional(),
  seal_number: z.string().nullable().optional(),
  issued_at: z.string().nullable().optional(),
  delivered_at: z.string().nullable().optional(),
  external_waybill_number: z.string().nullable().optional(),
  external_waybill_status: z.enum(EXTERNAL_WAYBILL_STATUSES),
  created_at: z.string().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightDeliveryNote',
  pluralName: 'Freight Delivery Notes',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(deliveryNoteItemSchema),
  create: {
    schema: createDeliveryNoteSchema,
    description: 'Creates a draft delivery note from a confirmed/executed spot order or from a freight trip.',
  },
  update: {
    schema: updateDeliveryNoteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates consignee, cargo corrections and notes while the delivery note is a draft.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a draft delivery note.',
  },
})
