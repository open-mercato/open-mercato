import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployeeCompensation } from '../../data/entities'
import { createCompensationSchema, updateCompensationSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_COMPENSATION_ENTITY_ID } from '../../commands/payroll'
import '../../commands/payroll'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr_management/compensations', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrEmployeeCompensation, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_COMPENSATION_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_COMPENSATION_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'effective_from', 'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance', 'currency_code', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { effectiveFrom: 'effective_from', employeeId: 'employee_id', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      ...(query.search ? { notes: { $ilike: `%${escapeLikePattern(query.search)}%` } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.compensations.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createCompensationSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.compensations.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateCompensationSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.compensations.delete',
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
  employee_id: z.string().uuid(),
  effective_from: z.string().nullable().optional(),
  basic_salary: z.string().nullable().optional(),
  housing_allowance: z.string().nullable().optional(),
  transport_allowance: z.string().nullable().optional(),
  other_allowance: z.string().nullable().optional(),
  currency_code: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Compensation',
  pluralName: 'Compensations',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createCompensationSchema, description: 'Creates an effective-dated compensation record.' },
  update: { schema: updateCompensationSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a compensation record.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a compensation record.' },
})
