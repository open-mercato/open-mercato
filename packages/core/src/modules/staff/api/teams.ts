import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeam, StaffTeamMember } from '../data/entities'
import { staffTeamCreateSchema, staffTeamUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

// Field constants for StaffTeam entity
const F = {
  id: 'id',
  tenant_id: 'tenant_id',
  organization_id: 'organization_id',
  name: 'name',
  description: 'description',
  is_active: 'is_active',
  created_at: 'created_at',
  updated_at: 'updated_at',
  deleted_at: 'deleted_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['staff.view'] },
  POST: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  PUT: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
  DELETE: { requireAuth: true, requireFeatures: ['staff.manage_team'] },
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
    entity: StaffTeam,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.staff.staff_team },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_team,
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
    decorateCustomFields: { entityIds: [E.staff.staff_team] },
  },
  actions: {
    create: {
      commandId: 'staff.teams.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.teamId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'staff.teams.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.teams.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (!items.length) return
      const teamIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (!teamIds.length) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
      const orgIds = ctx.organizationIds ?? ctx.organizationScope?.filterIds ?? null
      const orgFilter =
        Array.isArray(orgIds) && orgIds.length > 0
          ? { $in: orgIds }
          : ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null
      const scope = { tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null }
      const members = await findWithDecryption(
        em,
        StaffTeamMember,
        {
          teamId: { $in: teamIds },
          deletedAt: null,
          ...(tenantId ? { tenantId } : {}),
          ...(orgFilter ? { organizationId: orgFilter } : {}),
        },
        { fields: ['id', 'teamId'] },
        scope,
      )
      const countMap = new Map<string, number>()
      members.forEach((member) => {
        const teamId = member.teamId ?? null
        if (!teamId) return
        countMap.set(teamId, (countMap.get(teamId) ?? 0) + 1)
      })
      items.forEach((item) => {
        const id = typeof item.id === 'string' ? item.id : null
        if (!id) return
        item.memberCount = countMap.get(id) ?? 0
      })
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const teamListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  memberCount: z.number().nullable().optional(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'Team',
  pluralName: 'Teams',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(teamListItemSchema),
  create: {
    schema: staffTeamCreateSchema,
    description: 'Creates a staff team.',
  },
  update: {
    schema: staffTeamUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a staff team by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a staff team by id.',
  },
})
