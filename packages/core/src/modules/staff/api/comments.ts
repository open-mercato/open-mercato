import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { StaffTeamMemberComment } from '../data/entities'
import {
  staffTeamMemberCommentCreateSchema,
  staffTeamMemberCommentUpdateSchema,
} from '../data/validators'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { E } from '#generated/entities.ids.generated'
import { createStaffCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

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
    entity: StaffTeamMemberComment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.staff.staff_team_member_comment,
  },
  list: {
    schema: listSchema,
    entityId: E.staff.staff_team_member_comment,
    fields: [
      'id',
      'member_id',
      'body',
      'author_user_id',
      'appearance_icon',
      'appearance_color',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
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
      commandId: 'staff.team-member-comments.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberCommentCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({
        id: result?.commentId ?? result?.id ?? null,
        authorUserId: result?.authorUserId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'staff.team-member-comments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(staffTeamMemberCommentUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'staff.team-member-comments.delete',
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
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      const userIds = new Set<string>()
      items.forEach((item: unknown) => {
        if (!item || typeof item !== 'object') return
        const record = item as Record<string, unknown>
        const userId =
          typeof record.author_user_id === 'string'
            ? record.author_user_id
            : typeof record.authorUserId === 'string'
              ? record.authorUserId
              : null
        if (userId) userIds.add(userId)
      })
      if (!userIds.size) return
      try {
        const em = (ctx.container.resolve('em') as EntityManager).fork()
        const users = await findWithDecryption(
          em,
          User,
          { id: { $in: Array.from(userIds) } },
          undefined,
          { tenantId: ctx.auth?.tenantId ?? null, organizationId: ctx.selectedOrganizationId ?? null },
        )
        const map = new Map<string, { name: string | null; email: string | null }>()
        users.forEach((user) => {
          const name = typeof user.name === 'string' && user.name.trim().length
            ? user.name.trim()
            : null
          map.set(user.id, {
            name,
            email: user.email ?? null,
          })
        })
        items.forEach((item: unknown) => {
          if (!item || typeof item !== 'object') return
          const record = item as Record<string, unknown>
          const userId =
            typeof record.author_user_id === 'string'
              ? record.author_user_id
              : typeof record.authorUserId === 'string'
                ? record.authorUserId
                : null
          if (!userId) return
          const meta = map.get(userId)
          if (!meta) return
          record.authorName = meta.name
          record.authorEmail = meta.email
          if (!('author_name' in record)) record.author_name = meta.name
          if (!('author_email' in record)) record.author_email = meta.email
        })
      } catch (err) {
        console.warn('[staff.comments] failed to enrich author metadata', err)
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const commentListItemSchema = z
  .object({
    id: z.string().uuid(),
    member_id: z.string().uuid().nullable().optional(),
    body: z.string().nullable(),
    author_user_id: z.string().uuid().nullable(),
    appearance_icon: z.string().nullable().optional(),
    appearance_color: z.string().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

const commentCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  authorUserId: z.string().uuid().nullable(),
})

export const openApi = createStaffCrudOpenApi({
  resourceName: 'TeamMemberComment',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(commentListItemSchema),
  create: {
    schema: staffTeamMemberCommentCreateSchema,
    responseSchema: commentCreateResponseSchema,
    description: 'Adds a note to a team member timeline.',
  },
  update: {
    schema: staffTeamMemberCommentUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a team member note.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a team member note.',
  },
})
