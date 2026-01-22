import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveCrudRecordId, parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { PlannerAvailabilityRule } from '../data/entities'
import { plannerAvailabilityRuleCreateSchema, plannerAvailabilityRuleUpdateSchema } from '../data/validators'
import { E } from '#generated/entities.ids.generated'
import { createPlannerCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from './openapi'
import { assertAvailabilityWriteAccess } from './access'

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
  unavailability_reason_entry_id: "unavailability_reason_entry_id",
  unavailability_reason_value: "unavailability_reason_value",
  created_at: "created_at",
  updated_at: "updated_at",
  deleted_at: "deleted_at",
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['planner.view'] },
  POST: { requireAuth: true },
  PUT: { requireAuth: true },
  DELETE: { requireAuth: true },
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
      F.unavailability_reason_entry_id,
      F.unavailability_reason_value,
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
        const input = parseScopedCommandInput(plannerAvailabilityRuleCreateSchema, raw ?? {}, ctx, translate)
        await assertAvailabilityWriteAccess(
          ctx,
          {
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            requiresUnavailability: input.kind === 'unavailability',
          },
          translate,
        )
        return input
      },
      response: ({ result }) => ({ id: result?.ruleId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'planner.availability.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const parsed = parseScopedCommandInput(plannerAvailabilityRuleUpdateSchema, raw ?? {}, ctx, translate)
        const tenantId = ctx.auth?.tenantId ?? null
        const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        const em = ctx.container.resolve('em') as EntityManager
        const recordScope: Record<string, unknown> = { id: parsed.id, deletedAt: null }
        if (tenantId) recordScope.tenantId = tenantId
        if (organizationId) recordScope.organizationId = organizationId
        const record = await findOneWithDecryption(
          em,
          PlannerAvailabilityRule,
          recordScope,
          undefined,
          { tenantId, organizationId },
        )
        const subjectType = record?.subjectType ?? parsed.subjectType
        const subjectId = record?.subjectId ?? parsed.subjectId
        if (record && subjectType && subjectId) {
          const requiresUnavailability = record.kind === 'unavailability' || parsed.kind === 'unavailability'
          const access = await assertAvailabilityWriteAccess(
            ctx,
            { subjectType, subjectId, requiresUnavailability },
            translate,
          )
          if (!access.canManageAll) {
            if (parsed.subjectType && parsed.subjectType !== record.subjectType) {
              throw new CrudHttpError(403, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
            }
            if (parsed.subjectId && parsed.subjectId !== record.subjectId) {
              throw new CrudHttpError(403, { error: translate('planner.availability.errors.unauthorized', 'Unauthorized') })
            }
          }
        } else if (subjectType && subjectId) {
          const nextKind = parsed.kind ?? 'availability'
          await assertAvailabilityWriteAccess(
            ctx,
            { subjectType, subjectId, requiresUnavailability: nextKind === 'unavailability' },
            translate,
          )
        }
        return parsed
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'planner.availability.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        const tenantId = ctx.auth?.tenantId ?? null
        const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
        const em = ctx.container.resolve('em') as EntityManager
        const recordScope: Record<string, unknown> = { id, deletedAt: null }
        if (tenantId) recordScope.tenantId = tenantId
        if (organizationId) recordScope.organizationId = organizationId
        const record = await findOneWithDecryption(
          em,
          PlannerAvailabilityRule,
          recordScope,
          undefined,
          { tenantId, organizationId },
        )
        if (record) {
          await assertAvailabilityWriteAccess(
            ctx,
            { subjectType: record.subjectType, subjectId: record.subjectId, requiresUnavailability: record.kind === 'unavailability' },
            translate,
          )
        }
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
  unavailability_reason_entry_id: z.string().uuid().nullable().optional(),
  unavailability_reason_value: z.string().nullable().optional(),
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
