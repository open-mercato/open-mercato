import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployee } from '../../data/entities'
import { createEmployeeSchema, updateEmployeeSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_EMPLOYEE_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  departmentId: z.string().uuid().optional(),
  status: z.enum(['active', 'on_leave', 'suspended', 'terminated']).optional(),
  employeeNumber: z.string().optional(),
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

export const metadata = { path: '/hr_management/employees', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrEmployee, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_EMPLOYEE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_EMPLOYEE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_number', 'first_name', 'last_name', 'identity_type', 'national_id', 'national_id_expiry', 'department_id', 'job_title', 'employment_type', 'status', 'hire_date', 'termination_date', 'email', 'phone', 'user_id', 'created_at', 'updated_at'],
    sortFieldMap: { employeeNumber: 'employee_number', firstName: 'first_name', lastName: 'last_name', hireDate: 'hire_date', jobTitle: 'job_title', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.departmentId ? { department_id: { $eq: query.departmentId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.employeeNumber ? { employee_number: { $ilike: `%${escapeLikePattern(query.employeeNumber)}%` } } : {}),
      ...(query.search ? { $or: [
        { first_name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { last_name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { employee_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      ] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.employees.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createEmployeeSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.employees.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateEmployeeSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.employees.delete',
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

const employeeListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  employee_number: z.string(), first_name: z.string(), last_name: z.string(),
  identity_type: z.enum(['national_id', 'iqama']).optional(),
  national_id: z.string(), national_id_expiry: z.string().nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  job_title: z.string(),
  employment_type: z.enum(['full_time', 'part_time', 'contract', 'temporary']).optional(),
  status: z.enum(['active', 'on_leave', 'suspended', 'terminated']),
  hire_date: z.string(), termination_date: z.string().nullable().optional(),
  email: z.string().nullable().optional(), phone: z.string().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Employee', pluralName: 'Employees', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(employeeListItemSchema),
  create: { schema: createEmployeeSchema, description: 'Creates an employee record.' },
  update: { schema: updateEmployeeSchema, responseSchema: defaultOkResponseSchema, description: 'Updates an employee record.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes an employee record.' },
})