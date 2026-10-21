import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployeePenalty } from '../../data/entities'
import { createPenaltySchema, updatePenaltySchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_PENALTY_ENTITY_ID } from '../../commands/payroll'
import '../../commands/payroll'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled']).optional(),
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

export const metadata = { path: '/hr_management/penalties', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrEmployeePenalty, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_PENALTY_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_PENALTY_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'penalty_type', 'incident_on', 'amount', 'suspended_days', 'reason', 'status', 'approval_request_id', 'payroll_run_id', 'payslip_id', 'created_at', 'updated_at'],
    sortFieldMap: { incidentOn: 'incident_on', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.search ? { reason: { $ilike: `%${escapeLikePattern(query.search)}%` } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.penalties.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createPenaltySchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.penalties.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updatePenaltySchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.penalties.delete',
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
  penalty_type: z.string(),
  incident_on: z.string().nullable().optional(),
  amount: z.string().nullable().optional(),
  suspended_days: z.number().nullable().optional(),
  reason: z.string(),
  status: z.string(),
  approval_request_id: z.string().uuid().nullable().optional(),
  payroll_run_id: z.string().uuid().nullable().optional(),
  payslip_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Employee penalty',
  pluralName: 'Employee penalties',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createPenaltySchema, description: 'Creates a penalty awaiting approval.' },
  update: { schema: updatePenaltySchema, responseSchema: defaultOkResponseSchema, description: 'Updates a penalty.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a penalty.' },
})
