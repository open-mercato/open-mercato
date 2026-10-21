import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  RENTAL_CLIENT_TYPES,
  RENTAL_DURATION_TYPES,
  RENTAL_STATUSES,
  RENTAL_TYPES,
  RentalContract,
} from '../../data/entities'
import { createRentalContractSchema, updateRentalContractSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createRentalCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { RENTAL_CONTRACT_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(RENTAL_STATUSES).optional(),
    rentalType: z.enum(RENTAL_TYPES).optional(),
    clientType: z.enum(RENTAL_CLIENT_TYPES).optional(),
    durationType: z.enum(RENTAL_DURATION_TYPES).optional(),
    customerId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['rentals.read'] },
  POST: { requireAuth: true, requireFeatures: ['rentals.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['rentals.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['rentals.manage'] },
}
export const metadata = { path: '/vehicle_rentals/contracts', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: RentalContract, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: RENTAL_CONTRACT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: RENTAL_CONTRACT_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'rental_number', 'status', 'rental_type', 'client_type',
      'duration_type', 'customer_id', 'customer_snapshot', 'vehicle_id', 'vehicle_snapshot', 'driver_id',
      'driver_snapshot', 'start_at', 'end_at', 'actual_start_at', 'actual_end_at', 'daily_rate', 'weekly_rate',
      'monthly_rate', 'included_km', 'extra_km_rate', 'odo_start_km', 'odo_end_km', 'usage_km', 'extra_km',
      'rental_amount_net', 'extra_km_amount_net', 'total_net_amount', 'tax_rate', 'tax_amount',
      'total_gross_amount', 'currency_code', 'handover_at', 'return_at', 'sales_order_id', 'sales_invoice_id', 'notes', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      rentalNumber: 'rental_number',
      startAt: 'start_at',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.status ? { status: { $eq: query.status } } : {}),
          ...(query.rentalType ? { rental_type: { $eq: query.rentalType } } : {}),
          ...(query.clientType ? { client_type: { $eq: query.clientType } } : {}),
          ...(query.durationType ? { duration_type: { $eq: query.durationType } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.vehicleId ? { vehicle_id: { $eq: query.vehicleId } } : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { rental_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { notes: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'vehicle_rentals.contracts.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createRentalContractSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'vehicle_rentals.contracts.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateRentalContractSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'vehicle_rentals.contracts.delete',
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

const rentalContractItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  rental_number: z.string(),
  status: z.enum(RENTAL_STATUSES),
  rental_type: z.enum(RENTAL_TYPES),
  client_type: z.enum(RENTAL_CLIENT_TYPES),
  duration_type: z.enum(RENTAL_DURATION_TYPES),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  vehicle_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  driver_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  start_at: z.string().nullable().optional(),
  end_at: z.string().nullable().optional(),
  actual_start_at: z.string().nullable().optional(),
  actual_end_at: z.string().nullable().optional(),
  daily_rate: z.string(),
  weekly_rate: z.string(),
  monthly_rate: z.string(),
  included_km: z.number().nullable().optional(),
  extra_km_rate: z.string().nullable().optional(),
  odo_start_km: z.number().nullable().optional(),
  odo_end_km: z.number().nullable().optional(),
  usage_km: z.number().nullable().optional(),
  extra_km: z.number().nullable().optional(),
  rental_amount_net: z.string(),
  extra_km_amount_net: z.string(),
  total_net_amount: z.string(),
  tax_rate: z.string(),
  tax_amount: z.string(),
  total_gross_amount: z.string(),
  currency_code: z.string(),
  handover_at: z.string().nullable().optional(),
  return_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createRentalCrudOpenApi({
  resourceName: 'RentalContract',
  pluralName: 'Vehicle Rental Contracts',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(rentalContractItemSchema),
  create: { schema: createRentalContractSchema, description: 'Creates a rental contract (draft) and allocates its number.' },
  update: { schema: updateRentalContractSchema, responseSchema: defaultOkResponseSchema, description: 'Updates an open rental contract and recomputes its amounts.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a draft rental contract.' },
})
