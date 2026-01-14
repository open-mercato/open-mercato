import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { BookingAvailabilityRuleSet } from '../data/entities'
import { bookingAvailabilityRuleSetCreateSchema, bookingAvailabilityRuleSetUpdateSchema } from '../data/validators'
import { E } from '@/generated/entities.ids.generated'
import { createBookingCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['booking.view'] },
  POST: { requireAuth: true, requireFeatures: ['booking.manage_availability'] },
  PUT: { requireAuth: true, requireFeatures: ['booking.manage_availability'] },
  DELETE: { requireAuth: true, requireFeatures: ['booking.manage_availability'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    ids: z.string().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const parseIds = (value?: string) => {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: BookingAvailabilityRuleSet,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_availability_rule_set },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_availability_rule_set,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'name',
      'description',
      'timezone',
      'created_at',
      'updated_at',
    ],
    decorateCustomFields: { entityIds: [E.booking.booking_availability_rule_set] },
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      const ids = parseIds(query.ids)
      if (ids.length) {
        filters.id = { $in: ids }
      }
      if (query.search) {
        const term = query.search.trim()
        if (term.length) {
          const like = `%${escapeLikePattern(term)}%`
          filters.name = { $ilike: like }
        }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'booking.availability-rule-sets.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingAvailabilityRuleSetCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.ruleSetId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.availability-rule-sets.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingAvailabilityRuleSetUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.availability-rule-sets.delete',
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

const availabilityRuleSetListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createBookingCrudOpenApi({
  resourceName: 'Availability rule set',
  pluralName: 'Availability rule sets',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(availabilityRuleSetListItemSchema),
  create: {
    schema: bookingAvailabilityRuleSetCreateSchema,
    description: 'Creates a reusable availability rule set.',
  },
  update: {
    schema: bookingAvailabilityRuleSetUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an availability rule set by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an availability rule set by id.',
  },
})
