import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BookingTeam, BookingTeamRole } from '../data/entities'
import { bookingTeamRoleCreateSchema, bookingTeamRoleUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm } from './helpers'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_team_role'

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
    teamId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingTeamRole,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_team_role },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_team_role,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.team_id,
      F.name,
      F.description,
      F.appearance_icon,
      F.appearance_color,
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
      if (query.teamId) {
        filters[F.team_id] = query.teamId
      }
      return filters
    },
    decorateCustomFields: { entityIds: [E.booking.booking_team_role] },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (!items.length) return
      const teamIds = new Set<string>()
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const teamId = typeof item.teamId === 'string'
          ? item.teamId
          : typeof item.team_id === 'string'
            ? item.team_id
            : null
        if (teamId) teamIds.add(teamId)
      })
      if (!teamIds.size) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const teams = await findWithDecryption(
        em,
        BookingTeam,
        { id: { $in: Array.from(teamIds) }, deletedAt: null },
        undefined,
        { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
      )
      const teamById = new Map(teams.map((team) => [team.id, { id: team.id, name: team.name }]))
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const teamId = typeof item.teamId === 'string'
          ? item.teamId
          : typeof item.team_id === 'string'
            ? item.team_id
            : null
        item.team = teamId ? (teamById.get(teamId) ?? null) : null
      })
    },
  },
  actions: {
    create: {
      commandId: 'booking.team-roles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamRoleCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.roleId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.team-roles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamRoleUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.team-roles.delete',
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
