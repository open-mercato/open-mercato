import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { staffTimeTagCrudEvents } from '../../../lib/crud'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { StaffTimeTag } from '../../../data/entities'
import { staffTimeTagCreateSchema } from '../../../data/validators'
import { staffTimeTagCommandIds, staffTimeTagUpdateSchema } from '../../../commands/timesheets-tags'
import { sanitizeSearchTerm } from '../../helpers'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'

const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  slug: 'slug',
  label: 'label',
  color: 'color',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

/**
 * Tags are org-wide vocabulary shared by the board (screen 6), the task drawer
 * (screen 7) and the time entry form (screens 8 and 10). Everyone who can open a
 * timesheet needs to read the list to render a badge, while maintaining the
 * vocabulary belongs with task management — hence `timesheets.view` to read and
 * `tasks.manage` to write.
 *
 * No `runRouteMutationGuards` here on purpose: every write goes through the
 * command bus via the factory's `actions`, which is already the guard wiring.
 */
const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.timesheets.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.timesheets.tasks.manage'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    q: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: StaffTimeTag,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: staffTimeTagCrudEvents,
  indexer: { entityType: 'staff:staff_time_tag' },
  list: {
    schema: listSchema,
    entityId: 'staff:staff_time_tag',
    fields: [F.id, F.organization_id, F.tenant_id, F.slug, F.label, F.color, F.created_at, F.updated_at],
    // Tag pickers read alphabetically; a chip list has no other natural order.
    defaultSort: { field: F.label, dir: 'asc' },
    sortFieldMap: {
      label: F.label,
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
      const term = sanitizeSearchTerm(query.q)
      if (term) {
        filters[F.label] = { $ilike: `%${escapeLikePattern(term)}%` }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: staffTimeTagCommandIds.create,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTagCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.tagId ?? null }),
      status: 201,
    },
    update: {
      commandId: staffTimeTagCommandIds.update,
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTimeTagUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: staffTimeTagCommandIds.delete,
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      // Deleting a tag cascades to its assignments; the counts travel back so the
      // caller sees how far the badge disappeared.
      response: ({ result }) => ({
        ok: true,
        removedTaskAssignments: result?.removedTaskAssignments ?? 0,
        removedEntryAssignments: result?.removedEntryAssignments ?? 0,
      }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const tagListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  slug: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

const tagDeleteResponseSchema = z.object({
  ok: z.literal(true),
  removedTaskAssignments: z.number().int(),
  removedEntryAssignments: z.number().int(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TimeTag',
  pluralName: 'Time Tags',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tagListItemSchema),
  create: {
    schema: staffTimeTagCreateSchema,
    description:
      'Creates a time tracking tag. The slug is unique per organization and tenant; a collision answers 409 with fieldErrors.slug.',
  },
  update: {
    schema: staffTimeTagUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Renames, re-slugs or recolours a tag. A slug collision answers 409 with fieldErrors.slug.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: tagDeleteResponseSchema,
    description:
      'Soft-deletes a tag and removes every task and time entry assignment it had, reporting how many of each were removed.',
  },
})
