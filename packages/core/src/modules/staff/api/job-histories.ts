import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { StaffTeamMemberJobHistory } from '../data/entities'
import {
  staffTeamMemberJobHistoryCreateSchema,
  staffTeamMemberJobHistoryUpdateSchema,
} from '../data/validators'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'
import { E } from '#generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    entityId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTeamMemberJobHistory,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: E.staff.staff_team_member_job_history },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_team_member_job_history,
    fields: [
      'id',
      'member_id',
      'name',
      'company_name',
      'description',
      'start_date',
      'end_date',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      startDate: 'start_date',
      endDate: 'end_date',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.entityId) filters.member_id = { $eq: query.entityId }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'staff.team-member-job-histories.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberJobHistoryCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.jobHistoryId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.team-member-job-histories.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberJobHistoryUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.team-member-job-histories.delete',
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

const jobHistoryListItemSchema = z
  .object({
    id: z.string().uuid(),
    member_id: z.string().uuid().nullable().optional(),
    name: z.string().nullable().optional(),
    company_name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    start_date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TeamMemberJobHistory',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(jobHistoryListItemSchema),
  create: {
    schema: staffTeamMemberJobHistoryCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Adds a team member job history entry.',
  },
  update: {
    schema: staffTeamMemberJobHistoryUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a team member job history entry.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a team member job history entry.',
  },
})
