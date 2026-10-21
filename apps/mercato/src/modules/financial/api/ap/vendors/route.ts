import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ApVendor } from '../../../data/entities'
import { createVendorSchema, updateVendorSchema } from '../../../data/validators'
import { createFinancialCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'
import { AP_VENDOR_ENTITY_ID } from '../../../commands/ap'
import '../../../commands/ap'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  search: z.string().optional(),
  isActive: z.enum(['true', 'false']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.write'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['financial.write'] },
}

export const metadata = { path: '/financial/ap/vendors', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: ApVendor, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: AP_VENDOR_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: AP_VENDOR_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'code', 'name', 'name_ar', 'vat_number', 'cr_number', 'email', 'phone', 'country_code', 'is_active', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { code: 'code', name: 'name', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.isActive ? { is_active: { $eq: query.isActive === 'true' } } : {}),
      ...(query.search ? { $or: [
        { code: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { vat_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      ] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.ap_vendors.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createVendorSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.ap_vendors.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateVendorSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.ap_vendors.delete',
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

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  name_ar: z.string().nullable().optional(),
  vat_number: z.string().nullable().optional(),
  cr_number: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  country_code: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Vendor',
  pluralName: 'Vendors',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createVendorSchema, description: 'Creates a vendor.' },
  update: { schema: updateVendorSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a vendor.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a vendor.' },
})
