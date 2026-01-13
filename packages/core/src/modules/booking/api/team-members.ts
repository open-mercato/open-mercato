import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BookingTeam, BookingTeamMember, BookingTeamRole } from '../data/entities'
import { bookingTeamMemberCreateSchema, bookingTeamMemberUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_team_member'
import { createBookingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

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
    isActive: z.string().optional(),
    teamId: z.string().uuid().optional(),
    roleId: z.string().uuid().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingTeamMember,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_team_member },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_team_member,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.team_id,
      F.display_name,
      F.description,
      F.user_id,
      F.role_ids,
      F.tags,
      'availability_rule_set_id',
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      displayName: F.display_name,
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
        filters[F.display_name] = { $ilike: like }
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) {
        filters[F.is_active] = isActive
      }
      if (query.teamId) {
        filters[F.team_id] = query.teamId
      }
      if (query.roleId) {
        filters[F.role_ids] = { $contains: [query.roleId] }
      }
      return filters
    },
    decorateCustomFields: { entityIds: [E.booking.booking_team_member] },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (!items.length) return
      const roleIds = new Set<string>()
      const userIds = new Set<string>()
      const teamIds = new Set<string>()
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const roleList = Array.isArray(item.roleIds) ? item.roleIds : Array.isArray(item.role_ids) ? item.role_ids : []
        roleList.forEach((roleId: unknown) => {
          if (typeof roleId === 'string' && roleId.length) roleIds.add(roleId)
        })
        const userId = typeof item.userId === 'string'
          ? item.userId
          : typeof item.user_id === 'string'
            ? item.user_id
            : null
        if (userId) userIds.add(userId)
        const teamId = typeof item.teamId === 'string'
          ? item.teamId
          : typeof item.team_id === 'string'
            ? item.team_id
            : null
        if (teamId) teamIds.add(teamId)
      })
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const roleById = new Map<string, string>()
      if (roleIds.size) {
        const roles = await findWithDecryption(
          em,
          BookingTeamRole,
          { id: { $in: Array.from(roleIds) } },
          undefined,
          { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
        )
        roles.forEach((role) => {
          roleById.set(role.id, role.name)
        })
      }
      const userById = new Map<string, { id: string; email: string | null }>()
      if (userIds.size) {
        const users = await findWithDecryption(
          em,
          User,
          { id: { $in: Array.from(userIds) }, deletedAt: null },
          undefined,
          { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
        )
        users.forEach((user) => {
          userById.set(user.id, { id: user.id, email: user.email ?? null })
        })
      }
      const teamById = new Map<string, { id: string; name: string }>()
      if (teamIds.size) {
        const teams = await findWithDecryption(
          em,
          BookingTeam,
          { id: { $in: Array.from(teamIds) }, deletedAt: null },
          undefined,
          { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
        )
        teams.forEach((team) => {
          teamById.set(team.id, { id: team.id, name: team.name })
        })
      }
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const roleList = Array.isArray(item.roleIds) ? item.roleIds : Array.isArray(item.role_ids) ? item.role_ids : []
        item.roleNames = roleList
          .map((roleId: unknown) => (typeof roleId === 'string' ? roleById.get(roleId) : null))
          .filter((name): name is string => typeof name === 'string' && name.length > 0)
        const userId = typeof item.userId === 'string'
          ? item.userId
          : typeof item.user_id === 'string'
            ? item.user_id
            : null
        item.user = userId ? (userById.get(userId) ?? null) : null
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
      commandId: 'booking.team-members.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamMemberCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.memberId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.team-members.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingTeamMemberUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.team-members.delete',
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

const teamMemberListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
  display_name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  user_id: z.string().uuid().nullable().optional(),
  role_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  availability_rule_set_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  roleNames: z.array(z.string()).optional(),
  user: z
    .object({
      id: z.string().uuid().nullable().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  team: z
    .object({
      id: z.string().uuid().nullable().optional(),
      name: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
})

export const openApi = createBookingCrudOpenApi({
  resourceName: 'Team member',
  pluralName: 'Team members',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(teamMemberListItemSchema),
  create: {
    schema: bookingTeamMemberCreateSchema,
    description: 'Creates a team member for booking assignments.',
  },
  update: {
    schema: bookingTeamMemberUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a team member by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a team member by id.',
  },
})
