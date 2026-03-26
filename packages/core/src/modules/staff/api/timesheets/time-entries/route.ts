import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTimeEntry } from '../../../data/entities'
import { staffTimeEntryCreateSchema, staffTimeEntryUpdateSchema } from '../../../data/validators'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  staff_member_id: 'staff_member_id',
  date: 'date',
  duration_minutes: 'duration_minutes',
  started_at: 'started_at',
  ended_at: 'ended_at',
  notes: 'notes',
  time_project_id: 'time_project_id',
  customer_id: 'customer_id',
  deal_id: 'deal_id',
  order_id: 'order_id',
  source: 'source',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.manage_own'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    staffMemberId: z.string().uuid().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    projectId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeEntry,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: 'staff:staff_time_entry' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_entry',
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.staff_member_id,
      F.date,
      F.duration_minutes,
      F.started_at,
      F.ended_at,
      F.notes,
      F.time_project_id,
      F.customer_id,
      F.deal_id,
      F.order_id,
      F.source,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      date: F.date,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      durationMinutes: F.duration_minutes,
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
      if (typeof query.staffMemberId === 'string' && query.staffMemberId.length > 0) {
        filters[F.staff_member_id] = query.staffMemberId
      }
      if (typeof query.from === 'string' && query.from.length > 0) {
        filters[F.date] = { ...((filters[F.date] as Record<string, unknown>) ?? {}), $gte: query.from }
      }
      if (typeof query.to === 'string' && query.to.length > 0) {
        filters[F.date] = { ...((filters[F.date] as Record<string, unknown>) ?? {}), $lte: query.to }
      }
      if (typeof query.projectId === 'string' && query.projectId.length > 0) {
        filters[F.time_project_id] = query.projectId
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.timesheets.time_entries.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeEntryCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.entryId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.timesheets.time_entries.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeEntryUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.timesheets.time_entries.delete',
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

const timeEntryListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  staff_member_id: z.string().uuid().nullable().optional(),
  date: z.string().nullable().optional(),
  duration_minutes: z.number().nullable().optional(),
  started_at: z.string().nullable().optional(),
  ended_at: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  time_project_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  deal_id: z.string().uuid().nullable().optional(),
  order_id: z.string().uuid().nullable().optional(),
  source: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeEntry',
  pluralName: 'TimeEntries',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(timeEntryListItemSchema),
  create: {
    schema: staffTimeEntryCreateSchema,
    description: 'Creates a time entry for a staff member.',
  },
  update: {
    schema: staffTimeEntryUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a time entry by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a time entry by id.',
  },
})
