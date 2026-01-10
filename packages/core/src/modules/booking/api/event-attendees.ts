import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BookingEvent, BookingEventAttendee } from '../data/entities'
import { bookingEventAttendeeCreateSchema, bookingEventAttendeeUpdateSchema } from '../data/validators'
import { sanitizeSearchTerm } from './helpers'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { E } from '@/generated/entities.ids.generated'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
  POST: { requireAuth: true, requireFeatures: ['booking.manage_events'] },
  PUT: { requireAuth: true, requireFeatures: ['booking.manage_events'] },
  DELETE: { requireAuth: true, requireFeatures: ['booking.manage_events'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    ids: z.string().optional(),
    eventId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingEventAttendee,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_event_attendee },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_event_attendee,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'event_id',
      'customer_id',
      'first_name',
      'last_name',
      'email',
      'phone',
      'address_line1',
      'address_line2',
      'city',
      'region',
      'postal_code',
      'country',
      'attendee_type',
      'external_ref',
      'tags',
      'notes',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      firstName: 'first_name',
      lastName: 'last_name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
        if (ids.length > 0) {
          filters.id = { $in: ids }
        }
      }
      const term = sanitizeSearchTerm(query.search)
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { first_name: { $ilike: like } },
          { last_name: { $ilike: like } },
          { email: { $ilike: like } },
        ]
      }
      if (query.eventId) {
        filters.event_id = query.eventId
      }
      if (query.customerId) {
        filters.customer_id = query.customerId
      }
      return filters
    },
    decorateCustomFields: { entityIds: [E.booking.booking_event_attendee] },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload?.items) ? payload.items : []
      if (!items.length) return
      const eventIds = new Set<string>()
      const customerIds = new Set<string>()
      items.forEach((item) => {
        if (!item || typeof item !== 'object') return
        const eventId = typeof item.eventId === 'string'
          ? item.eventId
          : typeof item.event_id === 'string'
            ? item.event_id
            : null
        if (eventId) eventIds.add(eventId)
        const customerId = typeof item.customerId === 'string'
          ? item.customerId
          : typeof item.customer_id === 'string'
            ? item.customer_id
            : null
        if (customerId) customerIds.add(customerId)
      })
      const em = (ctx.container.resolve('em') as EntityManager).fork()
      const tenantId = ctx.organizationScope?.tenantId ?? ctx.auth?.tenantId ?? null
      const orgIds = ctx.organizationIds ?? ctx.organizationScope?.filterIds ?? null
      const orgFilter =
        Array.isArray(orgIds) && orgIds.length > 0
          ? { $in: orgIds }
          : ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null
      const scope = { tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.organizationScope?.selectedId ?? null }

      const [events, customers] = await Promise.all([
        eventIds.size
          ? findWithDecryption(
            em,
            BookingEvent,
            {
              id: { $in: Array.from(eventIds) },
              deletedAt: null,
              ...(tenantId ? { tenantId } : {}),
              ...(orgFilter ? { organizationId: orgFilter } : {}),
            },
            undefined,
            scope,
          )
          : Promise.resolve([]),
        customerIds.size
          ? findWithDecryption(
            em,
            CustomerEntity,
            {
              id: { $in: Array.from(customerIds) },
              deletedAt: null,
              ...(tenantId ? { tenantId } : {}),
              ...(orgFilter ? { organizationId: orgFilter } : {}),
            },
            undefined,
            scope,
          )
          : Promise.resolve([]),
      ])

      const eventById = new Map(events.map((event) => [event.id, event]))
      const customerById = new Map(customers.map((customer) => [customer.id, customer]))

      items.forEach((item) => {
        const eventId = typeof item.eventId === 'string'
          ? item.eventId
          : typeof item.event_id === 'string'
            ? item.event_id
            : null
        const customerId = typeof item.customerId === 'string'
          ? item.customerId
          : typeof item.customer_id === 'string'
            ? item.customer_id
            : null
        const event = eventId ? eventById.get(eventId) : null
        const customer = customerId ? customerById.get(customerId) : null
        item.eventTitle = event?.title ?? null
        item.eventStartsAt = event?.startsAt ? event.startsAt.toISOString() : null
        item.eventEndsAt = event?.endsAt ? event.endsAt.toISOString() : null
        item.customerDisplayName = customer?.displayName ?? null
        item.customerKind = customer?.kind ?? null
      })
    },
  },
  actions: {
    create: {
      commandId: 'booking.event-attendees.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingEventAttendeeCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.attendeeId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.event-attendees.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingEventAttendeeUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.event-attendees.delete',
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
