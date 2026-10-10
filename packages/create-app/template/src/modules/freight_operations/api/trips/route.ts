import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  FreightTrip,
  RATE_BASES,
  TRIP_BILLING_STATUSES,
  TRIP_EXECUTION_STATUSES,
  TRIP_SOURCES,
} from '../../data/entities'
import { createTripSchema, updateTripSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createFreightCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FREIGHT_TRIP_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    customerId: z.string().uuid().optional(),
    contractId: z.string().uuid().optional(),
    billingStatus: z.enum(TRIP_BILLING_STATUSES).optional(),
    executionStatus: z.enum(TRIP_EXECUTION_STATUSES).optional(),
    executionFrom: z.string().optional(),
    executionTo: z.string().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['freight.trips.manage'] },
}
export const metadata = { path: '/freight_operations/trips', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FreightTrip, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FREIGHT_TRIP_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_TRIP_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'trip_number', 'source', 'contract_id', 'contract_route_id',
      'freight_order_id', 'customer_id', 'customer_snapshot', 'execution_date', 'transport_route_id',
      'route_code_snapshot', 'origin', 'destination', 'rate_basis', 'quantity', 'unit_price_net',
      'minimum_charge_applied', 'base_amount_net', 'charges_total_net', 'total_net_amount', 'tax_rate',
      'tax_amount', 'total_gross_amount', 'currency_code', 'vehicle_id', 'driver_id', 'transport_trip_id',
      'execution_status', 'billing_status', 'active_abstract_id', 'actual_start_at', 'actual_end_at',
      'waiting_minutes', 'distance_km', 'pod_reference', 'pod_document_id', 'pod_received_by_name',
      'pod_received_at', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      tripNumber: 'trip_number',
      executionDate: 'execution_date',
      totalGrossAmount: 'total_gross_amount',
      status: 'execution_status',
      billingStatus: 'billing_status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.contractId ? { contract_id: { $eq: query.contractId } } : {}),
          ...(query.billingStatus ? { billing_status: { $eq: query.billingStatus } } : {}),
          ...(query.executionStatus ? { execution_status: { $eq: query.executionStatus } } : {}),
          ...(query.executionFrom ? { execution_date: { $gte: query.executionFrom } } : {}),
          ...(query.executionTo ? { execution_date: { $lte: query.executionTo } } : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { trip_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { origin: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { destination: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'freight_operations.trips.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createTripSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'freight_operations.trips.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateTripSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'freight_operations.trips.delete',
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

const tripListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  trip_number: z.string(),
  source: z.enum(TRIP_SOURCES),
  contract_id: z.string().uuid().nullable().optional(),
  contract_route_id: z.string().uuid().nullable().optional(),
  freight_order_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid(),
  execution_date: z.string().nullable().optional(),
  origin: z.string(),
  destination: z.string(),
  rate_basis: z.enum(RATE_BASES),
  quantity: z.string(),
  unit_price_net: z.string(),
  charges_total_net: z.string(),
  total_net_amount: z.string(),
  tax_amount: z.string(),
  total_gross_amount: z.string(),
  currency_code: z.string(),
  execution_status: z.enum(TRIP_EXECUTION_STATUSES),
  billing_status: z.enum(TRIP_BILLING_STATUSES),
  active_abstract_id: z.string().uuid().nullable().optional(),
  pod_reference: z.string().nullable().optional(),
  pod_document_id: z.string().uuid().nullable().optional(),
  pod_received_by_name: z.string().nullable().optional(),
  pod_received_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightTrip',
  pluralName: 'Freight Trips',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tripListItemSchema),
  create: { schema: createTripSchema, description: 'Records a trip against a contract rate line (price snapshotted) or a spot order.' },
  update: { schema: updateTripSchema, responseSchema: defaultOkResponseSchema, description: 'Updates an unbilled trip; locked once it is inside an abstract.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes an unbilled trip.' },
})
