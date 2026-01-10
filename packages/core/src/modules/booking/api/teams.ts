import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { BookingTeam } from '../data/entities'
import { bookingTeamCreateSchema, bookingTeamUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_team'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
  POST: { requireAuth: true, requireFeatures: ['booking.manage_team'] },
  PUT: { requireAuth: true, requireFeatures: ['booking.manage_team'] },
  DELETE: { requireAuth: true, requireFeatures: ['booking.manage_team'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    ids: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingTeam,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_team },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_team,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.description,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
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
        if (ids.length > 0) {
          filters[F.id] = { $in: ids }
        }
      }
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters[F.name] = { $ilike: like }
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) {
        filters[F.is_active] = isActive
      }
      return filters
    },
    decorateCustomFields: { entityIds: [E.booking.booking_team] },
  },
  actions: {
    create: {
      commandId: 'booking.teams.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.teamId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.teams.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.teams.delete',
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
