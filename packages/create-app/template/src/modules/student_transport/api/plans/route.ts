import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SUBSCRIPTION_ACCOUNT_TYPES, SUBSCRIPTION_DURATIONS, SubscriptionPlan } from '../../data/entities'
import { createPlanSchema, updatePlanSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createStudentCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { STUDENT_PLAN_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    accountType: z.enum(SUBSCRIPTION_ACCOUNT_TYPES).optional(),
    duration: z.enum(SUBSCRIPTION_DURATIONS).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['student_transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['student_transport.plans.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['student_transport.plans.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['student_transport.plans.manage'] },
}
export const metadata = { path: '/student_transport/plans', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: SubscriptionPlan, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: STUDENT_PLAN_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: STUDENT_PLAN_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'name', 'code', 'account_type', 'duration',
      'price_two_way', 'price_one_way', 'currency_code', 'tax_rate', 'is_active', 'notes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.accountType ? { account_type: { $eq: query.accountType } } : {}),
          ...(query.duration ? { duration: { $eq: query.duration } } : {}),
          ...(query.isActive ? { is_active: { $eq: query.isActive === 'true' } } : {}),
        },
        query.search
          ? [{ $or: [
              { name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
              { code: { $ilike: `%${escapeLikePattern(query.search)}%` } },
            ] }]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'student_transport.plans.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createPlanSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'student_transport.plans.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updatePlanSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'student_transport.plans.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const planItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable().optional(),
  account_type: z.enum(SUBSCRIPTION_ACCOUNT_TYPES),
  duration: z.enum(SUBSCRIPTION_DURATIONS),
  price_two_way: z.string(),
  price_one_way: z.string(),
  currency_code: z.string(),
  tax_rate: z.string(),
  is_active: z.boolean(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createStudentCrudOpenApi({
  resourceName: 'SubscriptionPlan',
  pluralName: 'Subscription Plans',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(planItemSchema),
  create: { schema: createPlanSchema, description: 'Creates a priced subscription plan.' },
  update: { schema: updatePlanSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a subscription plan.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a subscription plan.' },
})
