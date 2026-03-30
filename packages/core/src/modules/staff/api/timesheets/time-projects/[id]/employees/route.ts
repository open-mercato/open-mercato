import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTimeProjectMember } from '../../../../../data/entities'
import { staffTimeProjectMemberAssignSchema } from '../../../../../data/validators'
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
      response: ({ result }) => ({ id: result?.memberId ?? null }),
      status: 201,
    },
    delete: {
      commandId: 'staff.timesheets.time_project_members.unassign',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const body = raw ?? {}
        return parseScopedCommandInput(
          z.object({ id: z.string().uuid() }),
          body,
          ctx,
          translate,
        )
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
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
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Unassigns an employee from a time project.',
  },
})
