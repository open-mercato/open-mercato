import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { BookingService, BookingServiceTagAssignment, BookingResourceTag } from '../data/entities'
import { sanitizeSearchTerm, parseBooleanFlag } from './helpers'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_service'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
}

export const metadata = routeMetadata

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    isActive: z.string().optional(),
    tagIds: z.string().optional(),
    duration: z.string().optional(),
    maxAttendees: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingService,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_service },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_service,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.description,
      F.duration_minutes,
      F.capacity_model,
      F.max_attendees,
      F.tags,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
      duration: F.duration_minutes,
      maxAttendees: F.max_attendees,
    },
    buildFilters: async (query, ctx) => {
      const filters: Record<string, unknown> = {}
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters[F.name] = { $ilike: like }
      }
      const duration = typeof query.duration === 'string' ? Number(query.duration) : null
      if (Number.isFinite(duration as number)) {
        filters[F.duration_minutes] = duration
      }
      const maxAttendees = typeof query.maxAttendees === 'string' ? Number(query.maxAttendees) : null
      if (Number.isFinite(maxAttendees as number)) {
        filters[F.max_attendees] = maxAttendees
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
          const assignments = await em.find(BookingServiceTagAssignment, assignmentFilters, { fields: ['service'] })
          const serviceIds = assignments.map((assignment) => assignment.service.id)
          filters[F.id] = { $in: serviceIds.length > 0 ? serviceIds : [] }
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
      const serviceIds = items
        .map((item) => (typeof item.id === 'string' ? item.id : null))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
      if (serviceIds.length === 0) return
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const assignments = await em.find(
        BookingServiceTagAssignment,
        { service: { $in: serviceIds } },
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
      const tagsByService = new Map<string, Array<{ id: string; label: string; color?: string | null }>>()
      assignments.forEach((assignment) => {
        const tag = assignment.tag as BookingResourceTag
        const mapped = tagById.get(tag?.id ?? '')
        if (!mapped) return
        const list = tagsByService.get(assignment.service.id) ?? []
        list.push(mapped)
        tagsByService.set(assignment.service.id, list)
      })
      items.forEach((item) => {
        const serviceId = typeof item.id === 'string' ? item.id : null
        item.tags = serviceId ? (tagsByService.get(serviceId) ?? []) : []
      })
    },
  },
})

export const GET = crud.GET
