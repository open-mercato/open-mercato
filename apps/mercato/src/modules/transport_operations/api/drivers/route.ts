import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { EXPIRY_WINDOW_DAYS } from '../../lib/expiry'
import { expiryCutoff, withOrConditions } from '../../lib/crudFilters'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TransportDriver } from '../../data/entities'
import { createDriverSchema, updateDriverSchema } from '../../data/validators'
import { createPagedListResponseSchema, createTransportCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { TRANSPORT_DRIVER_ENTITY_ID } from '../../commands/transport'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(), ids: z.string().optional(),
  status: z.enum(['available', 'on_trip', 'on_leave', 'suspended']).optional(),
  // `expired` is the compliance emergency; `within30` is what a dispatcher renews this week. The
  // cut-off is computed on the server so every consumer filters on one definition of "expiring".
  expiry: z.enum(['expired', 'within30']).optional(),
  licenseExpiresBefore: z.string().optional(), search: z.string().optional(),
  sortField: z.string().optional(), sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
  PUT: { requireAuth: true, requireFeatures: ['transport.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['transport.write'] },
}
export const metadata = { path: '/transport_operations/drivers', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: TransportDriver, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: TRANSPORT_DRIVER_ENTITY_ID },
  list: {
    schema: listSchema, entityId: TRANSPORT_DRIVER_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'user_id', 'full_name', 'national_id', 'license_number', 'license_expiry', 'phone', 'status', 'created_at', 'updated_at'],
    sortFieldMap: { fullName: 'full_name', licenseExpiry: 'license_expiry', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => {
      const cutoff = expiryCutoff(query.expiry, { expired: 0, within30: EXPIRY_WINDOW_DAYS })
      return withOrConditions({
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
        ...(query.status ? { status: { $eq: query.status } } : {}),
        ...(query.licenseExpiresBefore ? { license_expiry: { $lte: query.licenseExpiresBefore } } : {}),
      }, [
        ...(query.search ? [{ $or: [
          { full_name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { national_id: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { license_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { phone: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ] }] : []),
        ...(cutoff ? [{ license_expiry: { $lte: cutoff, $ne: null } }] : []),
      ])
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'transport_operations.drivers.create', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createDriverSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }), status: 201,
    },
    update: {
      commandId: 'transport_operations.drivers.update', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateDriverSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'transport_operations.drivers.delete', schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const driverListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(), employee_id: z.string().uuid().nullable().optional(),
  full_name: z.string(), national_id: z.string(), license_number: z.string(), license_expiry: z.string(), phone: z.string(),
  status: z.enum(['available', 'on_trip', 'on_leave', 'suspended']), created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createTransportCrudOpenApi({
  resourceName: 'Driver', pluralName: 'Drivers', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(driverListItemSchema),
  create: { schema: createDriverSchema, description: 'Creates a transport driver.' },
  update: { schema: updateDriverSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a transport driver.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a transport driver.' },
})
