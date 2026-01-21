import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesResourceActivity } from '../data/entities'
import {
  resourcesResourceActivityCreateSchema,
  resourcesResourceActivityUpdateSchema,
} from '../data/validators'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { E } from '#generated/entities.ids.generated'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

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
  GET: { requireAuth: true, requireFeatures: ['resources.view'] },
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

export const metadata = routeMetadata

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ResourcesResourceActivity,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: {
    entityType: E.resources.resources_resource_activity,
  },
  list: {
    schema: listSchema,
    entityId: E.resources.resources_resource_activity,
    fields: [
      'id',
      'resource_id',
      'activity_type',
      'subject',
      'body',
      'occurred_at',
      'author_user_id',
      'appearance_icon',
      'appearance_color',
      'organization_id',
      'tenant_id',
      'created_at',
      'updated_at',
    ],
    decorateCustomFields: {
      entityIds: E.resources.resources_resource_activity,
    },
    sortFieldMap: {
      occurredAt: 'occurred_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.entityId) filters.resource_id = { $eq: query.entityId }
      return filters
    },
    transformItem: (item: Record<string, unknown>) => {
      const record = (item ?? {}) as Record<string, unknown>
      const toIsoString = (value: unknown): string | null => {
        if (value == null) return null
        if (value instanceof Date) return value.toISOString()
        if (typeof value === 'string') {
          const trimmed = value.trim()
          if (!trimmed.length) return null
          const date = new Date(trimmed)
          return Number.isNaN(date.getTime()) ? trimmed : date.toISOString()
        }
        return null
      }
      const readString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
      const idValue = readString(record.id) ?? (record.id != null ? String(record.id) : '')
      const resourceId = readString(record['resource_id']) ?? readString(record['resourceId']) ?? null
      const activityType =
        readString(record['activity_type']) ??
        readString(record['activityType']) ??
        ''
      const subject =
        readString(record.subject) ??
        (record.subject == null ? null : String(record.subject))
      const body =
        readString(record.body) ??
        (record.body == null ? null : String(record.body))
      const authorUserId =
        readString(record['author_user_id']) ?? readString(record['authorUserId']) ?? null
      const appearanceIconRaw =
        readString(record['appearance_icon']) ?? readString(record['appearanceIcon'])
      const appearanceColorRaw =
        readString(record['appearance_color']) ?? readString(record['appearanceColor'])
      const organizationId =
        readString(record['organization_id']) ?? readString(record['organizationId'])
      const tenantId =
        readString(record['tenant_id']) ?? readString(record['tenantId'])
      const output: Record<string, unknown> = {
        id: idValue,
        entityId: resourceId,
        resourceId,
        activityType,
        subject,
        body,
        occurredAt: toIsoString(record['occurred_at'] ?? record['occurredAt']),
        createdAt: toIsoString(record['created_at'] ?? record['createdAt']),
        authorUserId,
        organizationId,
        tenantId,
        appearanceIcon: appearanceIconRaw && appearanceIconRaw.trim().length ? appearanceIconRaw : null,
        appearanceColor: appearanceColorRaw && appearanceColorRaw.trim().length ? appearanceColorRaw : null,
        customFields: Array.isArray(record.customFields) ? record.customFields : undefined,
        customValues: record.customValues ?? undefined,
      }
      for (const [key, value] of Object.entries(record)) {
        if (key.startsWith('cf_') || key.startsWith('cf:')) {
          output[key] = value
        }
      }
      return output
    },
  },
  actions: {
    create: {
      commandId: 'resources.resource-activities.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceActivityCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({
        id: result?.activityId ?? result?.id ?? null,
        authorUserId: result?.authorUserId ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'resources.resource-activities.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceActivityUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'resources.resource-activities.delete',
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
          map.set(user.id, { name, email: user.email ?? null })
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
        console.warn('[resources.activities] failed to enrich author metadata', err)
      }
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const activityListItemSchema = z
  .object({
    id: z.string().uuid(),
    resource_id: z.string().uuid().nullable().optional(),
    activity_type: z.string().nullable().optional(),
    subject: z.string().nullable().optional(),
    body: z.string().nullable().optional(),
    occurred_at: z.string().nullable().optional(),
    author_user_id: z.string().uuid().nullable(),
    appearance_icon: z.string().nullable().optional(),
    appearance_color: z.string().nullable().optional(),
    organization_id: z.string().uuid().nullable().optional(),
    tenant_id: z.string().uuid().nullable().optional(),
    created_at: z.string().nullable(),
    updated_at: z.string().nullable().optional(),
  })
  .passthrough()

const activityCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  authorUserId: z.string().uuid().nullable(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'ResourceActivity',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(activityListItemSchema),
  create: {
    schema: resourcesResourceActivityCreateSchema,
    responseSchema: activityCreateResponseSchema,
    description: 'Adds an activity to a resource timeline.',
  },
  update: {
    schema: resourcesResourceActivityUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a resource activity.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a resource activity.',
  },
})
