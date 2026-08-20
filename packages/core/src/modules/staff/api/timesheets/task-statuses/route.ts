import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTimeTaskStatus } from '../../../data/entities'
import { staffTimeTaskStatusCreateSchema, staffTimeTaskStatusUpdateSchema } from '../../../data/validators'
import { staffTimeTaskStatusCommandIds } from '../../../commands/timesheets-task-statuses'
import { resolveListProjectAccess } from '../tasks/route'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  time_project_id: 'time_project_id',
  name: 'name',
  slug: 'slug',
  color: 'color',
  position: 'position',
  is_default: 'is_default',
  is_done: 'is_done',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

/**
 * Columns are project configuration (D-1), not task content: anyone who can see the
 * board needs to read them, but only a Team Leader who can manage the project may
 * add, rename, recolour, reorder or remove one. Hence the asymmetric gating —
 * `tasks.view` to read, `projects.manage` to write.
 *
 * `tasks.view` is granted to every employee, so it decides *what kind* of access this
 * is, never *whose* board is being read. The list is therefore intersected with
 * `resolveProjectAccess` exactly as the tasks routes are — a column carries its
 * project's naming, workflow and done/default policy, which is the same thing a task
 * title leaks about a client the caller has no route to.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.view'] },
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
    ids: z.string().optional(),
    timeProjectId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type TaskStatusListQuery = z.infer<typeof listSchema>

/** Non-UUID sentinel used as the "match nothing" filter, mirroring the tasks route. */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000'

function splitIdList(value: unknown): string[] | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  const ids = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return ids.length > 0 ? ids : []
}

/**
 * Every column query narrows to the projects the caller may actually see. The access
 * decision is the tasks route's memoised resolver, so a board that loads its columns
 * and its cards in one request pays for it once and both answers agree. Exported so
 * the intersection is testable without standing up the CRUD factory.
 */
export async function buildTaskStatusListFilters(
  query: TaskStatusListQuery,
  ctx: CrudCtx,
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}

  const narrowIds = splitIdList(query.ids)
  const requestedProjectId =
    typeof query.timeProjectId === 'string' && query.timeProjectId.trim().length > 0
      ? query.timeProjectId.trim()
      : null

  const access = await resolveListProjectAccess(ctx)
  if (!access.canManageAll) {
    const projectIds = requestedProjectId
      ? access.projectIds.filter((id) => id === requestedProjectId)
      : [...access.projectIds]
    if (projectIds.length === 0) {
      // A non-member gets no row at all — not a redacted one — so a foreign board's
      // column names and workflow never leave the server.
      filters[F.time_project_id] = { $in: [IMPOSSIBLE_ID] }
      return filters
    }
    filters[F.time_project_id] = { $in: projectIds }
  } else if (requestedProjectId) {
    filters[F.time_project_id] = requestedProjectId
  }

  if (narrowIds !== null) {
    filters[F.id] = { $in: narrowIds.length > 0 ? narrowIds : [IMPOSSIBLE_ID] }
  }

  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeTaskStatus,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_task_status' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_task_status',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.time_project_id,
      F.name,
      F.slug,
      F.color,
      F.position,
      F.is_default,
      F.is_done,
      F.created_at,
      F.updated_at,
    ],
    // The board renders left to right in `position` order, so that is the default
    // sort rather than the usual created-at.
    defaultSort: { field: F.position, dir: 'asc' },
    sortFieldMap: {
      position: F.position,
      name: F.name,
      slug: F.slug,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: buildTaskStatusListFilters,
  },
  actions: {
    create: {
      commandId: staffTimeTaskStatusCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTaskStatusCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.taskStatusId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffTimeTaskStatusCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTaskStatusUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffTimeTaskStatusCommandIds.delete,
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

export const taskStatusListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  slug: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  position: z.number().int().nullable().optional(),
  is_default: z.boolean().nullable().optional(),
  is_done: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeTaskStatus',
  pluralName: 'Time Task Statuses',
  description:
    'Returns the Kanban columns of the projects the caller can see. A caller without `staff.timesheets.projects.manage` is narrowed to the projects they are an active member of, so `timeProjectId` can only ever select a board they already have access to.',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(taskStatusListItemSchema),
  create: {
    schema: staffTimeTaskStatusCreateSchema,
    description: 'Creates a Kanban column on a time project.',
  },
  update: {
    schema: staffTimeTaskStatusUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description:
      'Updates a Kanban column. Supplying `position` re-orders the board; the last default column cannot be unset and the last done column cannot be cleared.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description:
      'Soft-deletes a Kanban column. Refused with 409 when it is the project\'s last column or still holds tasks.',
  },
})
