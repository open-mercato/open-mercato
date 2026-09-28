import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { EXPIRY_WINDOW_DAYS } from '../../lib/expiry'
import { withOrConditions } from '../../lib/crudFilters'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrDriverProfile } from '../../data/entities'
import { createDriverProfileSchema, updateDriverProfileSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_DRIVER_PROFILE_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  search: z.string().optional(),
  // `expired` is the compliance emergency; `within30` is what an operator renews this week. Both
  // match on either date, because a driver is compliant only when the licence AND the medical
  // certificate are valid.
  expiry: z.enum(['expired', 'within30']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr_management/driver-profiles', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrDriverProfile, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_DRIVER_PROFILE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_DRIVER_PROFILE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'license_number', 'license_type', 'license_expiry', 'medical_check_expiry', 'years_of_experience', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { employeeId: 'employee_id', licenseNumber: 'license_number', licenseType: 'license_type', licenseExpiry: 'license_expiry', medicalCheckExpiry: 'medical_check_expiry', yearsOfExperience: 'years_of_experience', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => {
      // The renewal window is computed here rather than sent by the client so every consumer filters
      // on the same definition of "expiring", and a row with no date at all never matches.
      const cutoff = query.expiry === 'expired'
        ? new Date()
        : query.expiry === 'within30'
          ? new Date(Date.now() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
          : null

      const orConditions: Record<string, unknown>[] = []
      if (query.search) {
        orConditions.push({ $or: [
          { license_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { license_type: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ] })
      }
      if (cutoff) {
        orConditions.push({ $or: [
          { license_expiry: { $lte: cutoff, $ne: null } },
          { medical_check_expiry: { $lte: cutoff, $ne: null } },
        ] })
      }

      return withOrConditions({
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
        ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      }, orConditions)
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.driver_profiles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createDriverProfileSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.driver_profiles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateDriverProfileSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.driver_profiles.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
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
  employee_id: z.string().uuid().nullable().optional(),
  license_number: z.string().nullable().optional(),
  license_type: z.string().nullable().optional(),
  license_expiry: z.string().nullable().optional(),
  medical_check_expiry: z.string().nullable().optional(),
  years_of_experience: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Driver profile', pluralName: 'Driver profiles', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createDriverProfileSchema, description: 'Creates a driver profile.' },
  update: { schema: updateDriverProfileSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a driver profile.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a driver profile.' },
})
