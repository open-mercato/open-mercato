import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { BookingAvailabilityRule } from '../data/entities'
import { bookingAvailabilityRuleCreateSchema, bookingAvailabilityRuleUpdateSchema } from '../data/validators'
import { E } from '@/generated/entities.ids.generated'
import * as F from '@/generated/entities/booking_availability_rule'

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
    subjectType: z.enum(['member', 'resource']).optional(),
    subjectIds: z.string().optional(),
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
    entity: BookingAvailabilityRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.booking.booking_availability_rule },
  list: {
    schema: listSchema,
    entityId: E.booking.booking_availability_rule,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.subject_type,
      F.subject_id,
      F.timezone,
      F.rrule,
      F.exdates,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.subjectType) {
        filters[F.subject_type] = query.subjectType
      }
      const subjectIds = parseIds(query.subjectIds)
      if (subjectIds.length) {
        filters[F.subject_id] = { $in: subjectIds }
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'booking.availability.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingAvailabilityRuleCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.ruleId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'booking.availability.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(bookingAvailabilityRuleUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'booking.availability.delete',
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
