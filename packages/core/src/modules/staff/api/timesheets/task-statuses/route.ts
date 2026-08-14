import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTimeTaskStatus } from '../../../data/entities'
import { staffTimeTaskStatusCreateSchema, staffTimeTaskStatusUpdateSchema } from '../../../data/validators'
import { staffTimeTaskStatusCommandIds } from '../../../commands/timesheets-task-statuses'
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
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (ids.length > 0) filters[F.id] = { $in: ids }
      }
      if (typeof query.timeProjectId === 'string' && query.timeProjectId.trim().length > 0) {
        filters[F.time_project_id] = query.timeProjectId.trim()
      }
      return filters
    },
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
