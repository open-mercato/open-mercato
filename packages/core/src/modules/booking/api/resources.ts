import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { BookingResource, BookingResourceTagAssignment, BookingResourceTag } from '../data/entities'
import { bookingResourceCreateSchema, bookingResourceUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_resource'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
  POST: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
  PUT: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
  DELETE: { requireAuth: true, requireFeatures: ['booking.manage_resources'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
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
    entity: BookingResource,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_resource },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_resource,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.resource_type_id,
      F.capacity,
      'capacity_unit_value',
      'capacity_unit_name',
      'capacity_unit_color',
      'capacity_unit_icon',
      F.is_active,
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
          const assignments = await em.find(BookingResourceTagAssignment, assignmentFilters, { fields: ['resource'] })
          const resourceIds = assignments.map((assignment) => assignment.resource.id)
          filters[F.id] = { $in: resourceIds.length > 0 ? resourceIds : [] }
        }
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload?.items) ? payload.items : []
      if (items.length === 0) return
      const resourceIds = items.map((item) => item?.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (resourceIds.length === 0) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const assignments = await em.find(
        BookingResourceTagAssignment,
        { resource: { $in: resourceIds } },
        { populate: ['tag'] },
      )
      const tagById = new Map<string, { id: string; label: string; color?: string | null }>()
      assignments.forEach((assignment) => {
        const tag = assignment.tag as BookingResourceTag
        if (!tag || !tag.id) return
        if (!tagById.has(tag.id)) {
          tagById.set(tag.id, { id: tag.id, label: tag.label, color: tag.color ?? null })
        }
      })
      const tagsByResource = new Map<string, Array<{ id: string; label: string; color?: string | null }>>()
      assignments.forEach((assignment) => {
        const tag = assignment.tag as BookingResourceTag
        const mapped = tagById.get(tag?.id ?? '')
        if (!mapped) return
        const list = tagsByResource.get(assignment.resource.id) ?? []
        list.push(mapped)
        tagsByResource.set(assignment.resource.id, list)
      })
      items.forEach((item) => {
        item.tags = tagsByResource.get(item.id) ?? []
      })
    },
  },
  actions: {
    create: {
      commandId: 'booking.resources.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingResourceCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.resourceId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.resources.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingResourceUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.resources.delete',
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
