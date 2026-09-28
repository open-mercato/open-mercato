import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { HrEmployeeDocument } from '../../data/entities'
import { createEmployeeDocumentSchema, updateEmployeeDocumentSchema } from '../../data/validators'
import { EMPLOYEE_DOCUMENT_TYPES } from '../../data/entities'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_EMPLOYEE_DOCUMENT_ENTITY_ID } from '../../commands/hr'
import { EXPIRY_WINDOW_DAYS } from '../../lib/expiry'
import { withOrConditions } from '../../lib/crudFilters'
import '../../commands/hr'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  documentType: z.enum(EMPLOYEE_DOCUMENT_TYPES).optional(),
  // `expired` is the compliance breach; `within30` is what an operator renews this week.
  expiry: z.enum(['expired', 'within30']).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  // The ACL declares `hr.documents.manage` for exactly this surface; it was granted to the default
  // roles as part of `hr.*`, so honouring it here adds no privilege and removes a declared-but-dead
  // feature id.
  POST: { requireAuth: true, requireFeatures: ['hr.documents.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.documents.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.documents.manage'] },
}

export const metadata = { path: '/hr_management/employee-documents', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrEmployeeDocument, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_EMPLOYEE_DOCUMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_EMPLOYEE_DOCUMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'document_type', 'document_number', 'issue_date', 'expiry_date', 'file_attachment_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { employeeId: 'employee_id', documentType: 'document_type', documentNumber: 'document_number', issueDate: 'issue_date', expiryDate: 'expiry_date', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => {
      const cutoff = query.expiry === 'expired'
        ? new Date()
        : query.expiry === 'within30'
          ? new Date(Date.now() + EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
          : null

      const orConditions: Record<string, unknown>[] = []
      if (query.search) {
        orConditions.push({ $or: [
          { document_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
          { document_type: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        ] })
      }
      if (cutoff) {
        orConditions.push({ expiry_date: { $lte: cutoff, $ne: null } })
      }

      return withOrConditions({
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
        ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
        ...(query.documentType ? { document_type: { $eq: query.documentType } } : {}),
      }, orConditions)
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.employee_documents.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createEmployeeDocumentSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.employee_documents.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateEmployeeDocumentSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.employee_documents.delete',
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
  document_type: z.string().nullable().optional(),
  document_number: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  file_attachment_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Employee document', pluralName: 'Employee documents', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createEmployeeDocumentSchema, description: 'Creates a employee document.' },
  update: { schema: updateEmployeeDocumentSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a employee document.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a employee document.' },
})
