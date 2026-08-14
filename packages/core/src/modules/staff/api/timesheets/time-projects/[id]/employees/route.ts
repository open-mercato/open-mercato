import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { StaffTimeProjectMember } from '../../../../../data/entities'
import { staffTimeProjectMemberAssignSchema, staffTimeProjectMemberUpdateSchema } from '../../../../../data/validators'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../../../openapi'

function extractProjectIdFromUrl(request?: Request): string | null {
  if (!request?.url) return null
  try {
    const url = new URL(request.url)
    const match = url.pathname.match(/\/time-projects\/([^/]+)\/employees/)
    return match?.[1] ?? null
  } catch {
    return null
  }
}

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  time_project_id: 'time_project_id',
  staff_member_id: 'staff_member_id',
  role: 'role',
  status: 'status',
  assigned_start_date: 'assigned_start_date',
  assigned_end_date: 'assigned_end_date',
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
    timeProjectId: z.string().uuid().optional(),
    status: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeProjectMember,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_project_member' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_project_member',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.time_project_id,
      F.staff_member_id,
      F.role,
      F.status,
      F.assigned_start_date,
      F.assigned_end_date,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      assignedStartDate: F.assigned_start_date,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      const projectId = query.timeProjectId ?? extractProjectIdFromUrl(ctx?.request) ?? null
      if (typeof projectId === 'string' && projectId.trim().length > 0) {
        filters[F.time_project_id] = projectId.trim()
      }
      if (typeof query.status === 'string' && query.status.trim().length > 0) {
        filters[F.status] = query.status.trim()
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.timesheets.time_project_members.assign',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const projectId = extractProjectIdFromUrl(ctx?.request) ?? null
        const body = { ...raw, timeProjectId: raw?.timeProjectId ?? projectId }
        return parseScopedCommandInput(staffTimeProjectMemberAssignSchema, body, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.timeProjectMemberId ?? null }),
      status: 201,
    },
    // Re-dating an assignment (D-12) is an update of the existing row, not a
    // replacement pair, so the audit trail reads as a change to
    // `assignedEndDate`. `timeProjectId` comes from the URL, never from the
    // body: the command uses it to refuse a membership id belonging to another
    // project. Guard wiring, tenant/org scoping and the optimistic-lock header
    // come from `makeCrudRoute`'s command path — this route MUST NOT hand-roll
    // them (see `runRouteMutationGuards` for the non-factory equivalent).
    update: {
      commandId: 'staff.timesheets.time_project_members.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          raw?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('staff.timesheets.errors.memberRequired', 'Time project member id is required.'),
          })
        }
        const parsed = staffTimeProjectMemberUpdateSchema.parse({ ...raw, id })
        const projectId = extractProjectIdFromUrl(ctx?.request)
        return projectId ? { ...parsed, timeProjectId: projectId } : parsed
      },
      response: ({ result }) => ({ id: result?.timeProjectMemberId ?? null }),
    },
    delete: {
      commandId: 'staff.timesheets.time_project_members.unassign',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id =
          parsed?.body?.id ??
          parsed?.id ??
          parsed?.query?.id ??
          (ctx.request ? new URL(ctx.request.url).searchParams.get('id') : null)
        if (!id) {
          throw new CrudHttpError(400, {
            error: translate('staff.timesheets.errors.memberRequired', 'Time project member id is required.'),
          })
        }
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

const projectMemberListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  staff_member_id: z.string().uuid().nullable().optional(),
  role: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  assigned_start_date: z.string().nullable().optional(),
  assigned_end_date: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeProjectMember',
  pluralName: 'Time Project Members',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(projectMemberListItemSchema),
  create: {
    schema: staffTimeProjectMemberAssignSchema,
    description: 'Assigns an employee to a time project.',
  },
  update: {
    schema: staffTimeProjectMemberUpdateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Updates an existing assignment (role, status, assignment end date) without unassigning the employee.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Unassigns an employee from a time project.',
  },
})
