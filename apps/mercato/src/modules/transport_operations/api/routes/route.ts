import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TransportRoute } from '../../data/entities'
import { createRouteSchema, updateRouteSchema } from '../../data/validators'
import { createPagedListResponseSchema, createTransportCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { TRANSPORT_ROUTE_ENTITY_ID } from '../../commands/transport'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(), ids: z.string().optional(), search: z.string().optional(),
  sortField: z.string().optional(), sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
  PUT: { requireAuth: true, requireFeatures: ['transport.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['transport.write'] },
}
export const metadata = { path: '/transport/routes', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: TransportRoute, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: TRANSPORT_ROUTE_ENTITY_ID },
  list: {
    schema: listSchema, entityId: TRANSPORT_ROUTE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'code', 'name', 'start_location', 'end_location', 'estimated_duration_minutes', 'created_at', 'updated_at'],
    sortFieldMap: { code: 'code', name: 'name', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.search ? { $or: [{ code: { $ilike: `%${escapeLikePattern(query.search)}%` } }, { name: { $ilike: `%${escapeLikePattern(query.search)}%` } }] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'transport_operations.routes.create', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createRouteSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }), status: 201,
    },
    update: {
      commandId: 'transport_operations.routes.update', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateRouteSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'transport_operations.routes.delete', schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const routeListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(), code: z.string(), name: z.string(),
  start_location: z.string(), end_location: z.string(), estimated_duration_minutes: z.number(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createTransportCrudOpenApi({
  resourceName: 'Route', pluralName: 'Routes', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(routeListItemSchema),
  create: { schema: createRouteSchema, description: 'Creates a transport route.' },
  update: { schema: updateRouteSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a transport route.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a transport route.' },
})
