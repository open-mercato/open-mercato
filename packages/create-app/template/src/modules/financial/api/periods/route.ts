import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { GlPeriod, PERIOD_STATUSES } from '../../data/entities'
import { createPeriodSchema, updatePeriodSchema } from '../../data/validators'
import { createPagedListResponseSchema, createFinancialCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FINANCIAL_PERIOD_ENTITY_ID } from '../../commands/ledger'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    status: z.enum(PERIOD_STATUSES).optional(),
    fiscalYear: z.coerce.number().int().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.write'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.write'] },
}

export const metadata = { path: '/financial/periods', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: GlPeriod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
  },
  indexer: { entityType: FINANCIAL_PERIOD_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FINANCIAL_PERIOD_ENTITY_ID,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'fiscal_year',
      'period_number',
      'period_name',
      'start_date',
      'end_date',
      'status',
      'closed_at',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      fiscalYear: 'fiscal_year',
      periodNumber: 'period_number',
      periodName: 'period_name',
      startDate: 'start_date',
      endDate: 'end_date',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => {
      const base: Record<string, unknown> = {
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids
          ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } }
          : {}),
        ...(query.status ? { status: { $eq: query.status } } : {}),
        ...(query.fiscalYear === undefined ? {} : { fiscal_year: { $eq: query.fiscalYear } }),
      }
      if (!query.search) return base
      return { ...base, period_name: { $ilike: `%${escapeLikePattern(query.search)}%` } }
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.periods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createPeriodSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.periods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updatePeriodSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT

const periodListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  fiscal_year: z.number(),
  period_number: z.number(),
  period_name: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  status: z.enum(PERIOD_STATUSES),
  closed_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Period',
  pluralName: 'Periods',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(periodListItemSchema),
  create: { schema: createPeriodSchema, description: 'Creates an accounting period.' },
  update: { schema: updatePeriodSchema, responseSchema: defaultOkResponseSchema, description: 'Updates an accounting period.' },
})
