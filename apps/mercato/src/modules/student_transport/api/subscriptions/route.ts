import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  SUBSCRIPTION_ACCOUNT_TYPES,
  SUBSCRIPTION_DIRECTIONS,
  SUBSCRIPTION_DURATIONS,
  SUBSCRIPTION_STATUSES,
  StudentSubscription,
} from '../../data/entities'
import { createSubscriptionSchema, updateSubscriptionSchema } from '../../data/validators'
import { withOrConditions } from '../../lib/crudFilters'
import { createPagedListResponseSchema, createStudentCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { STUDENT_SUBSCRIPTION_ENTITY_ID } from '../../commands/entities'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    status: z.enum(SUBSCRIPTION_STATUSES).optional(),
    accountType: z.enum(SUBSCRIPTION_ACCOUNT_TYPES).optional(),
    direction: z.enum(SUBSCRIPTION_DIRECTIONS).optional(),
    duration: z.enum(SUBSCRIPTION_DURATIONS).optional(),
    customerId: z.string().uuid().optional(),
    schoolCustomerId: z.string().uuid().optional(),
    planId: z.string().uuid().optional(),
    routeId: z.string().uuid().optional(),
    search: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['student_transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['student_transport.subscriptions.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['student_transport.subscriptions.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['student_transport.subscriptions.manage'] },
}
export const metadata = { path: '/student_transport/subscriptions', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: StudentSubscription, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: STUDENT_SUBSCRIPTION_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: STUDENT_SUBSCRIPTION_ENTITY_ID,
    fields: [
      'id', 'organization_id', 'tenant_id', 'subscription_number', 'status', 'account_type', 'direction',
      'duration', 'plan_id', 'plan_snapshot', 'customer_id', 'customer_snapshot', 'school_customer_id',
      'school_snapshot', 'student_name', 'student_grade', 'guardian_name', 'guardian_phone', 'pickup_point',
      'dropoff_point', 'transport_route_id', 'route_snapshot', 'vehicle_id', 'vehicle_snapshot', 'driver_id',
      'driver_snapshot', 'start_date', 'end_date', 'period_price', 'currency_code', 'tax_rate', 'sales_order_id',
      'sales_invoice_id', 'last_invoiced_period_from', 'last_invoiced_period_to', 'notes',
      'created_at', 'updated_at',
    ],
    sortFieldMap: {
      subscriptionNumber: 'subscription_number',
      studentName: 'student_name',
      startDate: 'start_date',
      status: 'status',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) =>
      withOrConditions(
        {
          ...(query.id ? { id: { $eq: query.id } } : {}),
          ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
          ...(query.status ? { status: { $eq: query.status } } : {}),
          ...(query.accountType ? { account_type: { $eq: query.accountType } } : {}),
          ...(query.direction ? { direction: { $eq: query.direction } } : {}),
          ...(query.duration ? { duration: { $eq: query.duration } } : {}),
          ...(query.customerId ? { customer_id: { $eq: query.customerId } } : {}),
          ...(query.schoolCustomerId ? { school_customer_id: { $eq: query.schoolCustomerId } } : {}),
          ...(query.planId ? { plan_id: { $eq: query.planId } } : {}),
          ...(query.routeId ? { transport_route_id: { $eq: query.routeId } } : {}),
        },
        query.search
          ? [
              {
                $or: [
                  { subscription_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { student_name: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                  { guardian_phone: { $ilike: `%${escapeLikePattern(query.search)}%` } },
                ],
              },
            ]
          : [],
      ),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'student_transport.subscriptions.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createSubscriptionSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'student_transport.subscriptions.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateSubscriptionSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'student_transport.subscriptions.delete',
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

const subscriptionItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  subscription_number: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  account_type: z.enum(SUBSCRIPTION_ACCOUNT_TYPES),
  direction: z.enum(SUBSCRIPTION_DIRECTIONS),
  duration: z.enum(SUBSCRIPTION_DURATIONS),
  plan_id: z.string().uuid().nullable().optional(),
  plan_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  customer_id: z.string().uuid(),
  customer_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  school_customer_id: z.string().uuid().nullable().optional(),
  school_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  student_name: z.string(),
  student_grade: z.string().nullable().optional(),
  guardian_name: z.string().nullable().optional(),
  guardian_phone: z.string().nullable().optional(),
  pickup_point: z.string().nullable().optional(),
  dropoff_point: z.string().nullable().optional(),
  transport_route_id: z.string().uuid().nullable().optional(),
  route_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  vehicle_id: z.string().uuid().nullable().optional(),
  vehicle_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  driver_id: z.string().uuid().nullable().optional(),
  driver_snapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  period_price: z.string(),
  currency_code: z.string(),
  tax_rate: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createStudentCrudOpenApi({
  resourceName: 'StudentSubscription',
  pluralName: 'Student Subscriptions',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(subscriptionItemSchema),
  create: { schema: createSubscriptionSchema, description: 'Creates a student subscription (draft) and allocates its number.' },
  update: { schema: updateSubscriptionSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a subscription; a plan change re-snapshots the price.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a draft subscription without attendance.' },
})
