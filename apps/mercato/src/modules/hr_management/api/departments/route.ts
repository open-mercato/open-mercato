import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrDepartment } from '../../data/entities'
import { createDepartmentSchema, updateDepartmentSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_DEPARTMENT_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  parentDepartmentId: z.string().uuid().optional(),
  isActive: z.coerce.boolean().optional(),
  name: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr_management/departments', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrDepartment, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_DEPARTMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_DEPARTMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'name', 'code', 'description', 'parent_department_id', 'manager_employee_id', 'is_active', 'created_at', 'updated_at'],
    sortFieldMap: { name: 'name', code: 'code', isActive: 'is_active', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.parentDepartmentId ? { parentDepartmentId: { $eq: query.parentDepartmentId } } : {}),
      ...(query.isActive === undefined ? {} : { isActive: { $eq: query.isActive } }),
      ...(query.name ? { name: { $ilike: `%${escapeLikePattern(query.name)}%` } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.departments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createDepartmentSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.departments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateDepartmentSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.departments.delete',
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

const departmentListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  name: z.string(), code: z.string().nullable().optional(), description: z.string().nullable().optional(),
  parent_department_id: z.string().uuid().nullable().optional(),
  manager_employee_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Department', pluralName: 'Departments', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(departmentListItemSchema),
  create: { schema: createDepartmentSchema, description: 'Creates a department.' },
  update: { schema: updateDepartmentSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a department.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a department.' },
})