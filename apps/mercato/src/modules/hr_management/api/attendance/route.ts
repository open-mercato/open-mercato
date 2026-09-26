import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrAttendanceRecord } from '../../data/entities'
import { createAttendanceRecordSchema, updateAttendanceRecordSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_ATTENDANCE_ENTITY_ID } from '../../commands/hr'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr/attendance', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrAttendanceRecord, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_ATTENDANCE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_ATTENDANCE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'date', 'check_in_at', 'check_out_at', 'status', 'worked_minutes', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { employeeId: 'employee_id', date: 'date', checkInAt: 'check_in_at', checkOutAt: 'check_out_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employeeId: { $eq: query.employeeId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.attendance.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createAttendanceRecordSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.attendance.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateAttendanceRecordSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.attendance.delete',
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
  date: z.string().nullable().optional(),
  check_in_at: z.string().nullable().optional(),
  check_out_at: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  worked_minutes: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Attendance record', pluralName: 'Attendance records', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createAttendanceRecordSchema, description: 'Creates a attendance record.' },
  update: { schema: updateAttendanceRecordSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a attendance record.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a attendance record.' },
})
