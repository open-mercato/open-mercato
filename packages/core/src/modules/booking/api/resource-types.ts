import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BookingResource, BookingResourceType } from '../data/entities'
import { bookingResourceTypeCreateSchema, bookingResourceTypeUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm } from './helpers'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_resource_type'

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
    ids: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingResourceType,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_resource_type },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_resource_type,
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
    decorateCustomFields: { entityIds: [E.booking.booking_resource_type] },
  },
  actions: {
    create: {
      commandId: 'booking.resourceTypes.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingResourceTypeCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.resourceTypeId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.resourceTypes.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingResourceTypeUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.resourceTypes.delete',
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
        BookingResource,
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
