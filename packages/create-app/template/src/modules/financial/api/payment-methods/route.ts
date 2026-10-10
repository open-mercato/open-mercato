import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import { GlPaymentMethod, PAYMENT_METHOD_KINDS } from '../../data/entities'
import { createPaymentMethodSchema, updatePaymentMethodSchema } from '../../data/validators'
import { createPagedListResponseSchema, createFinancialCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { FINANCIAL_PAYMENT_METHOD_ENTITY_ID } from '../../commands/money'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    search: z.string().optional(),
    kind: z.enum(PAYMENT_METHOD_KINDS).optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.payments.view'] },
  POST: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['financial.payments.manage'] },
}

export const metadata = { path: '/financial/payment-methods', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: GlPaymentMethod,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: FINANCIAL_PAYMENT_METHOD_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FINANCIAL_PAYMENT_METHOD_ENTITY_ID,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'code',
      'name',
      'kind',
      'account_id',
      'is_active',
      'is_default',
      'requires_reference',
      'sort_order',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      name: 'name',
      kind: 'kind',
      sortOrder: 'sort_order',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: (query) => {
      const isActive = parseBooleanToken(query.isActive)
      const base: Record<string, unknown> = {
        ...(query.id ? { id: { $eq: query.id } } : {}),
        ...(query.ids ? { id: { $in: parseCommaSeparatedList(query.ids) } } : {}),
        ...(query.kind ? { kind: { $eq: query.kind } } : {}),
        ...(isActive === null ? {} : { is_active: { $eq: isActive } }),
      }
      if (!query.search) return base
      const needle = `%${escapeLikePattern(query.search)}%`
      return {
        ...base,
        $or: [{ code: { $ilike: needle } }, { name: { $ilike: needle } }],
      }
    },
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.payment_methods.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createPaymentMethodSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.payment_methods.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updatePaymentMethodSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.payment_methods.delete',
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

const paymentMethodListItemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(PAYMENT_METHOD_KINDS),
  account_id: z.string().uuid(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  requires_reference: z.boolean(),
  sort_order: z.number(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'PaymentMethod',
  pluralName: 'PaymentMethods',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(paymentMethodListItemSchema),
  create: { schema: createPaymentMethodSchema, description: 'Creates a payment method.' },
  update: { schema: updatePaymentMethodSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a payment method.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Archives a payment method.' },
})
