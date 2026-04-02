import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { StaffTimeProject } from '../../../data/entities'
import { staffTimeProjectCreateSchema, staffTimeProjectUpdateSchema } from '../../../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from '../../helpers'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  name: 'name',
  code: 'code',
  description: 'description',
  project_type: 'project_type',
  status: 'status',
  customer_id: 'customer_id',
  owner_user_id: 'owner_user_id',
  cost_center: 'cost_center',
  start_date: 'start_date',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.projects.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    ids: z.string().optional(),
    projectType: z.string().optional(),
    status: z.string().optional(),
    customerId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeProject,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_project' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_project',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.code,
      F.description,
      F.project_type,
      F.status,
      F.customer_id,
      F.owner_user_id,
      F.cost_center,
      F.start_date,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      code: F.code,
      status: F.status,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      startDate: F.start_date,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (ids.length > 0) {
          filters[F.id] = { $in: ids }
        }
      }
      const term = sanitizeSearchTerm(query.q)
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [{ [F.name]: { $ilike: like } }, { [F.code]: { $ilike: like } }]
      }
      if (typeof query.projectType === 'string' && query.projectType.trim().length > 0) {
        filters[F.project_type] = query.projectType.trim()
      }
      if (typeof query.status === 'string' && query.status.trim().length > 0) {
        filters[F.status] = query.status.trim()
      }
      if (typeof query.customerId === 'string' && query.customerId.trim().length > 0) {
        filters[F.customer_id] = query.customerId.trim()
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.timesheets.time_projects.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeProjectCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.timeProjectId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.timesheets.time_projects.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeProjectUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.timesheets.time_projects.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const timeProjectListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  project_type: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  owner_user_id: z.string().uuid().nullable().optional(),
  cost_center: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeProject',
  pluralName: 'Time Projects',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(timeProjectListItemSchema),
  create: {
    schema: staffTimeProjectCreateSchema,
    description: 'Creates a time project.',
  },
  update: {
    schema: staffTimeProjectUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a time project by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a time project by id.',
  },
})
