import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ResourcesResource, ResourcesResourceType } from '../data/entities'
import { resourcesResourceTypeCreateSchema, resourcesResourceTypeUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm } from './helpers'
import { E } from '#generated/entities.ids.generated'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

// Field constants for ResourcesResourceType entity
const F = {
  id: "id",
  tenant_id: "tenant_id",
  organization_id: "organization_id",
  name: "name",
  description: "description",
  default_duration: "default_duration",
  default_buffer: "default_buffer",
  appearance_icon: "appearance_icon",
  appearance_color: "appearance_color",
  is_active: "is_active",
  created_at: "created_at",
  updated_at: "updated_at",
  deleted_at: "deleted_at",
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['resources.view'] },
  POST: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['resources.manage_resources'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ResourcesResourceType,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.resources.resources_resource_type },
  list: {
    schema: listSchema,
    entityId: E.resources.resources_resource_type,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.description,
      'appearance_icon',
      'appearance_color',
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
      return filters
    },
    decorateCustomFields: { entityIds: [E.resources.resources_resource_type] },
  },
  actions: {
    create: {
      commandId: 'resources.resourceTypes.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceTypeCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.resourceTypeId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'resources.resourceTypes.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceTypeUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'resources.resourceTypes.delete',
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
      const typeIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (!typeIds.length) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
      const orgIds = ctx.organizationIds ?? ctx.organizationScope?.filterIds ?? null
      const orgFilter =
        Array.isArray(orgIds) && orgIds.length > 0
          ? { $in: orgIds }
          : ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null
      const scope = { tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null }
      const resources = await findWithDecryption(
        em,
        ResourcesResource,
        {
          resourceTypeId: { $in: typeIds },
          deletedAt: null,
          ...(tenantId ? { tenantId } : {}),
          ...(orgFilter ? { organizationId: orgFilter } : {}),
        },
        { fields: ['id', 'resourceTypeId'] },
        scope,
      )
      const countMap = new Map<string, number>()
      resources.forEach((resource) => {
        const typeId = resource.resourceTypeId ?? null
        if (!typeId) return
        countMap.set(typeId, (countMap.get(typeId) ?? 0) + 1)
      })
      items.forEach((item) => {
        const id = typeof item.id === 'string' ? item.id : null
        if (!id) return
        item.resourceCount = countMap.get(id) ?? 0
      })
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const resourceTypeListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  appearance_icon: z.string().nullable().optional(),
  appearance_color: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  resourceCount: z.number().nullable().optional(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'Resource type',
  pluralName: 'Resource types',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(resourceTypeListItemSchema),
  create: {
    schema: resourcesResourceTypeCreateSchema,
    description: 'Creates a resource type for resources resources.',
  },
  update: {
    schema: resourcesResourceTypeUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a resource type by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a resource type by id.',
  },
})
