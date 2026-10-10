import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { DRIVER_INCENTIVE_TYPES, FreightContractRoute, RATE_BASES } from '../../data/entities'
import { createContractRouteSchema, updateContractRouteSchema } from '../../data/validators'
import { createPagedListResponseSchema, createFreightCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FREIGHT_CONTRACT_ROUTE_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    contractId: z.string().uuid().optional(),
    isActive: z.enum(['true', 'false']).optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['freight.contracts.manage'] },
}
export const metadata = { path: '/freight_operations/contract-routes', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FreightContractRoute, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FREIGHT_CONTRACT_ROUTE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FREIGHT_CONTRACT_ROUTE_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'contract_id', 'line_number', 'transport_route_id', 'route_code_snapshot',
      'origin', 'destination', 'rate_basis', 'rate_amount', 'minimum_charge', 'currency_code', 'includes_tolls',
      'includes_waiting', 'free_waiting_minutes', 'waiting_rate_per_hour', 'vehicle_type_id', 'equipment_type',
      'driver_incentive_type', 'driver_incentive_value', 'vat_rate_override', 'is_active',
      'effective_from', 'effective_to', 'position', 'created_at', 'updated_at',
    ],
    sortFieldMap: {
      lineNumber: 'line_number',
      rateAmount: 'rate_amount',
      position: 'position',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.contractId ? { contract_id: { $eq: query.contractId } } : {}),
      ...(query.isActive ? { is_active: { $eq: query.isActive === 'true' } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'freight_operations.contract-routes.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createContractRouteSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'freight_operations.contract-routes.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateContractRouteSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'freight_operations.contract-routes.delete',
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

const contractRouteItemSchema = z.object({
  id: z.string().uuid(),
  contract_id: z.string().uuid(),
  line_number: z.number(),
  transport_route_id: z.string().uuid().nullable().optional(),
  route_code_snapshot: z.string().nullable().optional(),
  origin: z.string(),
  destination: z.string(),
  rate_basis: z.enum(RATE_BASES),
  rate_amount: z.string(),
  minimum_charge: z.string().nullable().optional(),
  currency_code: z.string(),
  equipment_type: z.string().nullable().optional(),
  vehicle_type_id: z.string().uuid().nullable().optional(),
  driver_incentive_type: z.enum(DRIVER_INCENTIVE_TYPES),
  driver_incentive_value: z.string().nullable().optional(),
  is_active: z.boolean(),
  effective_from: z.string().nullable().optional(),
  effective_to: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFreightCrudOpenApi({
  resourceName: 'FreightContractRateLine',
  pluralName: 'Freight Contract Rate Lines',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(contractRouteItemSchema),
  create: { schema: createContractRouteSchema, description: 'Adds a route rate line to a contract.' },
  update: { schema: updateContractRouteSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a route rate line.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a rate line.' },
})
