import { z, type ZodTypeAny } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import type { CrudOpenApiOptions } from '@open-mercato/shared/lib/openapi/crud'
import {
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  defaultOkResponseSchema as sharedDefaultOkResponseSchema,
} from '@open-mercato/shared/lib/openapi/crud'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- MikroORM entity class constructor
type EntityClass = new (...args: any[]) => unknown

interface ActivityRouteConfig {
  entity: EntityClass
  entityId: string
  parentFkColumn: string
  parentFkParam: string
  features: { view: string; manage: string }
  createSchema: ZodTypeAny
  updateSchema: ZodTypeAny
  commandPrefix: string
  logPrefix: string
  openApiFactory: (options: CrudOpenApiOptions) => OpenApiRouteDoc
  openApi: {
    resourceName: string
    createDescription: string
    updateDescription: string
    deleteDescription: string
  }
}

function createPagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const defaultOkResponseSchema = sharedDefaultOkResponseSchema

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

const sortFieldMap = {
  occurredAt: 'occurred_at',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

const activityCreateResponseSchema = z.object({
  id: z.string().uuid().nullable(),
  authorUserId: z.string().uuid().nullable(),
})

export function makeActivityRoute(config: ActivityRouteConfig) {
  const {
    entity,
    entityId,
    parentFkColumn,
    parentFkParam,
    features,
    createSchema,
    updateSchema,
    commandPrefix,
    logPrefix,
    openApiFactory,
    openApi: openApiConfig,
  } = config

  const routeMetadata = {
    GET: { requireAuth: true, requireFeatures: [features.view] },
    POST: { requireAuth: true, requireFeatures: [features.manage] },
    PUT: { requireAuth: true, requireFeatures: [features.manage] },
    DELETE: { requireAuth: true, requireFeatures: [features.manage] },
  }

  const fields = [
    'id',
    parentFkColumn,
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
  ]

  const crud = makeCrudRoute({
    metadata: routeMetadata,
    orm: {
      entity,
      idField: 'id',
      orgField: 'organizationId',
      tenantField: 'tenantId',
    },
    indexer: {
      entityType: entityId,
    },
    list: {
      schema: listSchema,
      entityId,
      fields,
      decorateCustomFields: {
        entityIds: entityId,
      },
      sortFieldMap,
      buildFilters: async (query) => {
        const filters: Record<string, unknown> = {}
        if (query.entityId) filters[parentFkColumn] = { $eq: query.entityId }
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
        const parentId = readString(record[parentFkColumn]) ?? readString(record[parentFkParam]) ?? null
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
          entityId: parentId,
          [parentFkParam]: parentId,
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
        commandId: `${commandPrefix}.create`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          return parseScopedCommandInput(createSchema, raw ?? {}, ctx, translate)
        },
        response: ({ result }) => ({
          id: result?.activityId ?? result?.id ?? null,
          authorUserId: result?.authorUserId ?? null,
        }),
        status: 201,
      },
      update: {
        commandId: `${commandPrefix}.update`,
        schema: rawBodySchema,
        mapInput: async ({ raw, ctx }) => {
          const { translate } = await resolveTranslations()
          return parseScopedCommandInput(updateSchema, raw ?? {}, ctx, translate)
        },
        response: () => ({ ok: true }),
      },
      delete: {
        commandId: `${commandPrefix}.delete`,
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
          console.warn(`${logPrefix} failed to enrich author metadata`, err)
        }
      },
    },
  })

  const activityListItemSchema = z
    .object({
      id: z.string().uuid(),
      [parentFkColumn]: z.string().uuid().nullable().optional(),
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

  const openApi = openApiFactory({
    resourceName: openApiConfig.resourceName,
    querySchema: listSchema,
    listResponseSchema: createPagedListResponseSchema(activityListItemSchema),
    create: {
      schema: createSchema,
      responseSchema: activityCreateResponseSchema,
      description: openApiConfig.createDescription,
    },
    update: {
      schema: updateSchema,
      responseSchema: defaultOkResponseSchema,
      description: openApiConfig.updateDescription,
    },
    del: {
      schema: z.object({ id: z.string().uuid() }),
      responseSchema: defaultOkResponseSchema,
      description: openApiConfig.deleteDescription,
    },
  })

  return {
    metadata: routeMetadata,
    openApi,
    GET: crud.GET,
    POST: crud.POST,
    PUT: crud.PUT,
    DELETE: crud.DELETE,
  }
}
