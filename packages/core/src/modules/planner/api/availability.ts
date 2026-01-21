import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { PlannerAvailabilityRule } from '../data/entities'
import { plannerAvailabilityRuleCreateSchema, plannerAvailabilityRuleUpdateSchema } from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createPlannerCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'

// Field constants for PlannerAvailabilityRule entity
const F = {
  id: "id",
  tenant_id: "tenant_id",
  organization_id: "organization_id",
  subject_type: "subject_type",
  subject_id: "subject_id",
  timezone: "timezone",
  rrule: "rrule",
  exdates: "exdates",
  kind: "kind",
  note: "note",
  created_at: "created_at",
  updated_at: "updated_at",
  deleted_at: "deleted_at",
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['planner.view'] },
  POST: { requireAuth: true, requireFeatures: ['planner.manage_availability'] },
  PUT: { requireAuth: true, requireFeatures: ['planner.manage_availability'] },
  DELETE: { requireAuth: true, requireFeatures: ['planner.manage_availability'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    subjectType: z.enum(['member', 'resource', 'ruleset']).optional(),
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
    entity: PlannerAvailabilityRule,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.planner.planner_availability_rule },
  list: {
    schema: listSchema,
    entityId: E.planner.planner_availability_rule,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.subject_type,
      F.subject_id,
      F.timezone,
      F.rrule,
      F.exdates,
      F.kind,
      F.note,
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
      commandId: 'planner.availability.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(plannerAvailabilityRuleCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.ruleId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'planner.availability.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(plannerAvailabilityRuleUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'planner.availability.delete',
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

const availabilityRuleListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  subject_type: z.string().nullable().optional(),
  subject_id: z.string().uuid().nullable().optional(),
  timezone: z.string().nullable().optional(),
  rrule: z.string().nullable().optional(),
  exdates: z.array(z.string()).nullable().optional(),
  kind: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createPlannerCrudOpenApi({
  resourceName: 'Availability rule',
  pluralName: 'Availability rules',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(availabilityRuleListItemSchema),
  create: {
    schema: plannerAvailabilityRuleCreateSchema,
    description: 'Creates an availability rule for the selected subject.',
  },
  update: {
    schema: plannerAvailabilityRuleUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates an availability rule by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an availability rule by id.',
  },
})
