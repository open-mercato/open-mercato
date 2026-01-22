import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { ResourcesResource, ResourcesResourceTagAssignment, ResourcesResourceTag } from '../data/entities'
import { resourcesResourceCreateSchema, resourcesResourceUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { E } from '#generated/entities.ids.generated'
import { createResourcesCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

// Field constants for ResourcesResource entity
const F = {
  id: "id",
  tenant_id: "tenant_id",
  organization_id: "organization_id",
  resource_type_id: "resource_type_id",
  name: "name",
  description: "description",
  capacity: "capacity",
  capacity_unit_value: "capacity_unit_value",
  capacity_unit_name: "capacity_unit_name",
  capacity_unit_color: "capacity_unit_color",
  capacity_unit_icon: "capacity_unit_icon",
  appearance_icon: "appearance_icon",
  appearance_color: "appearance_color",
  is_active: "is_active",
  availability_rule_set_id: "availability_rule_set_id",
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
    resourceTypeId: z.string().uuid().optional(),
    isActive: z.string().optional(),
    tagIds: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: ResourcesResource,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.resources.resources_resource },
  list: {
    schema: listSchema,
    entityId: E.resources.resources_resource,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      'description',
      F.resource_type_id,
      F.capacity,
      'capacity_unit_value',
      'capacity_unit_name',
      'capacity_unit_color',
      'capacity_unit_icon',
      'appearance_icon',
      'appearance_color',
      F.is_active,
      'availability_rule_set_id',
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query, ctx) => {
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
      if (query.resourceTypeId) {
        filters[F.resource_type_id] = query.resourceTypeId
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) {
        filters[F.is_active] = isActive
      }
      if (typeof query.tagIds === 'string' && query.tagIds.trim().length > 0) {
        const tagIds = query.tagIds
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (tagIds.length > 0) {
          const em = (ctx.container.resolve('em') as EntityManager).fork()
          const assignmentFilters: Record<string, unknown> = {
            tag: { $in: tagIds },
          }
          const scopeTenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
          const organizationIds = ctx.organizationIds ?? ctx.organizationScope?.filterIds ?? null
          const selectedOrganizationId = ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null
          if (scopeTenantId) assignmentFilters.tenantId = scopeTenantId
          if (Array.isArray(organizationIds) && organizationIds.length > 0) {
            assignmentFilters.organizationId = { $in: organizationIds }
          } else if (selectedOrganizationId) {
            assignmentFilters.organizationId = selectedOrganizationId
          }
          const assignments = await em.find(ResourcesResourceTagAssignment, assignmentFilters, { fields: ['resource'] })
          const resourceIds = assignments.map((assignment) => assignment.resource.id)
          filters[F.id] = { $in: resourceIds.length > 0 ? resourceIds : [] }
        }
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items: Array<Record<string, unknown>> = Array.isArray(payload?.items)
        ? (payload.items as Array<Record<string, unknown>>)
        : []
      if (items.length === 0) return
      const resourceIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (resourceIds.length === 0) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const assignments = await em.find(
        ResourcesResourceTagAssignment,
        { resource: { $in: resourceIds } },
        { populate: ['tag'] },
      )
      const tagById = new Map<string, { id: string; label: string; color?: string | null }>()
      assignments.forEach((assignment) => {
        const tag = assignment.tag as ResourcesResourceTag
        if (!tag || !tag.id) return
        if (!tagById.has(tag.id)) {
          tagById.set(tag.id, { id: tag.id, label: tag.label, color: tag.color ?? null })
        }
      })
      const tagsByResource = new Map<string, Array<{ id: string; label: string; color?: string | null }>>()
      assignments.forEach((assignment) => {
        const tag = assignment.tag as ResourcesResourceTag
        const mapped = tagById.get(tag?.id ?? '')
        if (!mapped) return
        const list = tagsByResource.get(assignment.resource.id) ?? []
        list.push(mapped)
        tagsByResource.set(assignment.resource.id, list)
      })
      items.forEach((item) => {
        const resourceId = typeof item.id === 'string' ? item.id : null
        item.tags = resourceId ? (tagsByResource.get(resourceId) ?? []) : []
      })
    },
  },
  actions: {
    create: {
      commandId: 'resources.resources.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.resourceId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'resources.resources.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(resourcesResourceUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'resources.resources.delete',
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

const resourceTagListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  label: z.string().nullable().optional(),
  color: z.string().nullable().optional(),
})

const resourceListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  resource_type_id: z.string().uuid().nullable().optional(),
  capacity: z.number().nullable().optional(),
  capacity_unit_value: z.string().nullable().optional(),
  capacity_unit_name: z.string().nullable().optional(),
  capacity_unit_color: z.string().nullable().optional(),
  capacity_unit_icon: z.string().nullable().optional(),
  appearance_icon: z.string().nullable().optional(),
  appearance_color: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  availability_rule_set_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  tags: z.array(resourceTagListItemSchema).optional(),
})

export const openApi = createResourcesCrudOpenApi({
  resourceName: 'Resource',
  pluralName: 'Resources',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(resourceListItemSchema),
  create: {
    schema: resourcesResourceCreateSchema,
    description: 'Creates a resource scoped to the selected organization.',
  },
  update: {
    schema: resourcesResourceUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a resource by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes a resource by id.',
  },
})
